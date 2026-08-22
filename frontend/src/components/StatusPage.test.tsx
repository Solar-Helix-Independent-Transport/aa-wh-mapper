import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { getAppStatus } from "../api/status";
import type { AppStatusOut } from "../api/types";
import { StatusPage } from "./StatusPage";

vi.mock("../api/status", () => ({
  getAppStatus: vi.fn(),
}));

function status(overrides: Partial<AppStatusOut> = {}): AppStatusOut {
  return {
    sde: {
      build_number: 12345,
      release_date: "2026-01-01T00:00:00Z",
      last_check_date: "2026-01-01T12:00:00Z",
      total_solar_systems: 8000,
      total_jspace_systems: 2500,
      jspace_with_raw_wormhole_class: 250,
    },
    tasks: [],
    usage: {
      total_maps: 10,
      private_maps: 7,
      shared_maps: 3,
      active_tracked_characters: 4,
      live_map_presences: 2,
    },
    wormhole_types: {
      total: 500,
      with_leads_to_class: 400,
      with_max_mass: 300,
      with_max_jump_mass: 300,
      with_max_stable_time: 500,
    },
    maps: [],
    routes: [],
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function renderPage() {
  return render(<StatusPage />, { wrapper: MemoryRouter });
}

describe("StatusPage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    vi.mocked(getAppStatus).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a loading state before the status arrives", () => {
    vi.mocked(getAppStatus).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText("Loading status…")).toBeInTheDocument();
  });

  it("shows a permission-denied message for a 403", async () => {
    vi.mocked(getAppStatus).mockRejectedValue(new ApiError(403, "Forbidden"));
    renderPage();
    await flush();
    expect(
      screen.getByText("You don't have permission to view this page."),
    ).toBeInTheDocument();
  });

  it("shows the raw error for any other failure", async () => {
    vi.mocked(getAppStatus).mockRejectedValue(new Error("network down"));
    renderPage();
    await flush();
    expect(screen.getByText(/network down/)).toBeInTheDocument();
  });

  it("renders SDE, usage, and wormhole-type coverage stats once loaded", async () => {
    vi.mocked(getAppStatus).mockResolvedValue(status());
    renderPage();
    await flush();

    expect(screen.getByText("12345")).toBeInTheDocument();
    expect(screen.getByText("8,000")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getAllByText("500")).toHaveLength(2);
  });

  it("computes the j-space wormhole-class coverage percentage", async () => {
    vi.mocked(getAppStatus).mockResolvedValue(
      status({
        sde: {
          build_number: 1,
          release_date: null,
          last_check_date: null,
          total_solar_systems: 100,
          total_jspace_systems: 2000,
          jspace_with_raw_wormhole_class: 500,
        },
      }),
    );
    renderPage();
    await flush();

    expect(screen.getByText(/\(25%\)/)).toBeInTheDocument();
  });

  it("shows 0% when there are no j-space systems at all (avoids divide-by-zero)", async () => {
    vi.mocked(getAppStatus).mockResolvedValue(
      status({
        sde: {
          build_number: 1,
          release_date: null,
          last_check_date: null,
          total_solar_systems: 100,
          total_jspace_systems: 0,
          jspace_with_raw_wormhole_class: 0,
        },
      }),
    );
    renderPage();
    await flush();

    expect(screen.getByText(/\(0%\)/)).toBeInTheDocument();
  });

  it("shows 'never imported' and dashes when the SDE has no build/release/check dates", async () => {
    vi.mocked(getAppStatus).mockResolvedValue(
      status({
        sde: {
          build_number: null,
          release_date: null,
          last_check_date: null,
          total_solar_systems: 0,
          total_jspace_systems: 0,
          jspace_with_raw_wormhole_class: 0,
        },
      }),
    );
    renderPage();
    await flush();

    expect(screen.getByText("never imported")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("marks a healthy task with the ok status dot and shows its last run time", async () => {
    vi.mocked(getAppStatus).mockResolvedValue(
      status({
        tasks: [
          {
            task_name: "sync_eve_scout_thera_turnur",
            expected_interval_seconds: 300,
            last_run_at: "2026-01-01T23:00:00Z",
            last_success: true,
            last_error: "",
            stale: false,
          },
        ],
      }),
    );
    const { container } = renderPage();
    await flush();

    expect(screen.getByText("sync_eve_scout_thera_turnur")).toBeInTheDocument();
    expect(screen.getByText("1h ago")).toBeInTheDocument();
    expect(container.querySelector(".status-dot-ok")).toBeInTheDocument();
  });

  it("marks a stale or failed task with the bad status dot, and flags a failure inline", async () => {
    vi.mocked(getAppStatus).mockResolvedValue(
      status({
        tasks: [
          {
            task_name: "refresh_system_sovereignty",
            expected_interval_seconds: 3600,
            last_run_at: "2026-01-01T00:00:00Z",
            last_success: false,
            last_error: "boom",
            stale: true,
          },
        ],
      }),
    );
    const { container } = renderPage();
    await flush();

    expect(screen.getByText(/\(failed\)/)).toBeInTheDocument();
    expect(container.querySelector(".status-dot-bad")).toBeInTheDocument();
    expect(screen.getByTitle("boom")).toBeInTheDocument();
  });

  it("shows 'never run' for a task with no last_run_at", async () => {
    vi.mocked(getAppStatus).mockResolvedValue(
      status({
        tasks: [
          {
            task_name: "brand_new_task",
            expected_interval_seconds: 60,
            last_run_at: null,
            last_success: null,
            last_error: "",
            stale: true,
          },
        ],
      }),
    );
    renderPage();
    await flush();

    expect(screen.getByText("never run")).toBeInTheDocument();
  });

  it("renders the maps and routes tables with their counts in the title", async () => {
    vi.mocked(getAppStatus).mockResolvedValue(
      status({
        maps: [
          {
            id: 1,
            name: "My Map",
            owner_name: "Alice",
            visibility: "private",
            created_at: "2026-01-01T00:00:00Z",
            last_updated: "2026-01-01T00:00:00Z",
            system_count: 5,
            active_users: 1,
          },
        ],
        routes: [
          {
            id: 1,
            owner_name: "Bob",
            start_system_name: "Jita",
            end_system_name: "Amarr",
            visibility: "shared",
            found: true,
            last_viewed_at: "2026-01-01T00:00:00Z",
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );
    renderPage();
    await flush();

    expect(
      screen.getByRole("heading", { name: "Maps (1)" }),
    ).toBeInTheDocument();
    expect(screen.getByText("My Map")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Routes (1)" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Jita → Amarr")).toBeInTheDocument();
    expect(screen.getByText("yes")).toBeInTheDocument();
  });
});
