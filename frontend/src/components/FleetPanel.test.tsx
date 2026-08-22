import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getFleetSession,
  listAvailableFleetCharacters,
  listFleetSessions,
  startFleetSession,
  stopFleetSession,
  stopWatchingFleetSession,
} from "../api/fleet";
import type { AvailableFleetCharacterOut, FleetSessionOut } from "../api/types";
import { installFakeWebSocket } from "../testUtils/fakeWebSocket";
import { FleetPanel } from "./FleetPanel";

vi.mock("../api/fleet", () => ({
  getFleetSession: vi.fn(),
  listAvailableFleetCharacters: vi.fn(),
  listFleetSessions: vi.fn(),
  startFleetSession: vi.fn(),
  stopFleetSession: vi.fn(),
  stopWatchingFleetSession: vi.fn(),
}));

function availableCharacter(
  overrides: Partial<AvailableFleetCharacterOut> = {},
): AvailableFleetCharacterOut {
  return {
    character_id: 1,
    character_name: "Alice",
    owner_name: "Alice",
    has_active_session: false,
    ...overrides,
  };
}

function session(overrides: Partial<FleetSessionOut> = {}): FleetSessionOut {
  return {
    id: 1,
    fc_character_id: 1,
    fc_character_name: "Alice",
    fleet_id: 1,
    started_by_id: 1,
    started_at: "2026-01-01T00:00:00Z",
    is_watcher: false,
    is_starter: true,
    members: [],
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("FleetPanel", () => {
  beforeEach(() => {
    installFakeWebSocket();
    vi.mocked(getFleetSession).mockReset();
    vi.mocked(listAvailableFleetCharacters).mockReset().mockResolvedValue([]);
    vi.mocked(listFleetSessions).mockReset().mockResolvedValue([]);
    vi.mocked(startFleetSession).mockReset();
    vi.mocked(stopFleetSession).mockReset();
    vi.mocked(stopWatchingFleetSession).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a message when no characters have fleet access granted", async () => {
    render(<FleetPanel />);
    await flush();
    expect(
      screen.getByText("No characters with fleet-read ESI access granted yet."),
    ).toBeInTheDocument();
  });

  it("lists available characters and labels the button Start when not already active", async () => {
    vi.mocked(listAvailableFleetCharacters).mockResolvedValue([
      availableCharacter({ has_active_session: false }),
    ]);
    render(<FleetPanel />);
    await flush();

    expect(screen.getByText("Alice (Alice)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("labels the button Watch for a character with an already-active session", async () => {
    vi.mocked(listAvailableFleetCharacters).mockResolvedValue([
      availableCharacter({ has_active_session: true }),
    ]);
    render(<FleetPanel />);
    await flush();

    expect(screen.getByRole("button", { name: "Watch" })).toBeInTheDocument();
  });

  it("starts a fleet session and shows the overlay", async () => {
    vi.mocked(listAvailableFleetCharacters).mockResolvedValue([
      availableCharacter(),
    ]);
    vi.mocked(startFleetSession).mockResolvedValue(session());
    render(<FleetPanel />);
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await flush();

    expect(startFleetSession).toHaveBeenCalledWith(1);
    expect(
      screen.getByRole("heading", { name: "Alice's fleet" }),
    ).toBeInTheDocument();
  });

  it("lists active sessions to watch when none is selected", async () => {
    vi.mocked(listFleetSessions).mockResolvedValue([
      session({
        id: 2,
        fc_character_name: "Bob",
        members: [{ character_id: 9 } as never],
      }),
    ]);
    render(<FleetPanel />);
    await flush();

    expect(screen.getByText(/Bob's fleet/)).toBeInTheDocument();
    expect(screen.getByText(/1 tracked/)).toBeInTheDocument();
  });

  it("selecting an active session fetches and shows its detail", async () => {
    vi.mocked(listFleetSessions).mockResolvedValue([
      session({ id: 2, fc_character_name: "Bob" }),
    ]);
    vi.mocked(getFleetSession).mockResolvedValue(
      session({
        id: 2,
        fc_character_name: "Bob",
        is_starter: false,
        is_watcher: true,
      }),
    );
    render(<FleetPanel />);
    await flush();

    fireEvent.click(screen.getByText(/Bob's fleet/));
    await flush();

    expect(getFleetSession).toHaveBeenCalledWith(2);
    expect(
      screen.getByRole("heading", { name: "Bob's fleet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Stop watching" }),
    ).toBeInTheDocument();
  });

  it("shows Stop tracking for the fleet's own starter", async () => {
    vi.mocked(listAvailableFleetCharacters).mockResolvedValue([
      availableCharacter(),
    ]);
    vi.mocked(startFleetSession).mockResolvedValue(
      session({ is_starter: true, is_watcher: false }),
    );
    render(<FleetPanel />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await flush();

    expect(
      screen.getByRole("button", { name: "Stop tracking" }),
    ).toBeInTheDocument();
  });

  it("stops tracking and returns to the picker", async () => {
    vi.mocked(listAvailableFleetCharacters).mockResolvedValue([
      availableCharacter(),
    ]);
    vi.mocked(startFleetSession).mockResolvedValue(session());
    vi.mocked(stopFleetSession).mockResolvedValue(undefined);
    render(<FleetPanel />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Stop tracking" }));
    await flush();

    expect(stopFleetSession).toHaveBeenCalledWith(1);
    expect(
      screen.queryByRole("heading", { name: "Alice's fleet" }),
    ).not.toBeInTheDocument();
  });

  it("stops watching without stopping the underlying session", async () => {
    vi.mocked(listFleetSessions).mockResolvedValue([session({ id: 2 })]);
    vi.mocked(getFleetSession).mockResolvedValue(
      session({ id: 2, is_starter: false, is_watcher: true }),
    );
    vi.mocked(stopWatchingFleetSession).mockResolvedValue(undefined);
    render(<FleetPanel />);
    await flush();
    fireEvent.click(screen.getByText(/Alice's fleet/));
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Stop watching" }));
    await flush();

    expect(stopWatchingFleetSession).toHaveBeenCalledWith(2);
    expect(stopFleetSession).not.toHaveBeenCalled();
  });

  it("goes Back to the picker without stopping anything", async () => {
    vi.mocked(listAvailableFleetCharacters).mockResolvedValue([
      availableCharacter(),
    ]);
    vi.mocked(startFleetSession).mockResolvedValue(session());
    render(<FleetPanel />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(stopFleetSession).not.toHaveBeenCalled();
    expect(stopWatchingFleetSession).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("heading", { name: "Alice's fleet" }),
    ).not.toBeInTheDocument();
  });

  it("shows an error message when starting a session fails", async () => {
    vi.mocked(listAvailableFleetCharacters).mockResolvedValue([
      availableCharacter(),
    ]);
    vi.mocked(startFleetSession).mockRejectedValue(
      new Error("fleet not found"),
    );
    render(<FleetPanel />);
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await flush();

    expect(screen.getByText(/fleet not found/)).toBeInTheDocument();
  });
});
