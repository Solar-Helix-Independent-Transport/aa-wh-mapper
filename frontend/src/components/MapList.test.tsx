import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMap, deleteMap, listMaps, updateMap } from "../api/maps";
import { deleteSharedRoute, listMyRoutes } from "../api/route";
import type { MapOut, RouteSummaryOut } from "../api/types";
import { MapList } from "./MapList";

vi.mock("../api/maps", () => ({
  createMap: vi.fn(),
  deleteMap: vi.fn(),
  listMaps: vi.fn(),
  updateMap: vi.fn(),
}));
vi.mock("../api/route", () => ({
  deleteSharedRoute: vi.fn(),
  listMyRoutes: vi.fn(),
}));
vi.mock("./UniverseRegionsDialog", () => ({
  UniverseRegionsDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="universe-dialog">
      <button type="button" onClick={onClose}>
        close universe
      </button>
    </div>
  ),
}));

function mapOut(overrides: Partial<MapOut> = {}): MapOut {
  return {
    id: 1,
    name: "My Map",
    owner_id: 1,
    owner_name: "Alice",
    visibility: "private",
    read_only: false,
    can_write: true,
    created_at: "2026-01-01T00:00:00Z",
    last_updated: "2026-01-01T00:00:00Z",
    is_owner: true,
    can_edit_sharing: true,
    active_users: 0,
    ...overrides,
  };
}

function routeSummaryOut(
  overrides: Partial<RouteSummaryOut> = {},
): RouteSummaryOut {
  return {
    id: 1,
    owner_name: "Alice",
    start_system_name: "Jita",
    end_system_name: "Amarr",
    visibility: "shared",
    found: true,
    last_viewed_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function renderMapList(onOpen = vi.fn(), onOpenRoute = vi.fn()) {
  return render(<MapList onOpen={onOpen} onOpenRoute={onOpenRoute} />, {
    wrapper: MemoryRouter,
  });
}

describe("MapList", () => {
  beforeEach(() => {
    vi.mocked(createMap).mockReset();
    vi.mocked(deleteMap).mockReset();
    vi.mocked(listMaps).mockReset();
    vi.mocked(updateMap).mockReset();
    vi.mocked(deleteSharedRoute).mockReset();
    vi.mocked(listMyRoutes).mockReset();
    // Default to no shared routes so existing map-focused tests (which
    // don't stub this themselves) don't hang on an unresolved promise or
    // pick up a stray "Delete" button from the routes panel.
    vi.mocked(listMyRoutes).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a loading state before maps arrive", () => {
    vi.mocked(listMaps).mockReturnValue(new Promise(() => {}));
    renderMapList();
    expect(screen.getByText("Loading maps…")).toBeInTheDocument();
  });

  it("shows an error message when fetching fails", async () => {
    vi.mocked(listMaps).mockRejectedValue(new Error("network down"));
    renderMapList();
    await flush();
    expect(screen.getByText(/network down/)).toBeInTheDocument();
  });

  it("splits maps into owned and shared-with-you sections", async () => {
    vi.mocked(listMaps).mockResolvedValue([
      mapOut({ id: 1, name: "Mine", is_owner: true }),
      mapOut({ id: 2, name: "Shared", is_owner: false, owner_name: "Bob" }),
    ]);
    renderMapList();
    await flush();

    expect(screen.getByText("Your maps")).toBeInTheDocument();
    expect(screen.getByText("Shared with you")).toBeInTheDocument();
    expect(screen.getByText("Mine")).toBeInTheDocument();
    expect(screen.getByText("Shared")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("disables Create map until a name is entered", async () => {
    vi.mocked(listMaps).mockResolvedValue([]);
    renderMapList();
    await flush();

    expect(screen.getByRole("button", { name: "Create map" })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("New map name"), {
      target: { value: "New Map" },
    });
    expect(
      screen.getByRole("button", { name: "Create map" }),
    ).not.toBeDisabled();
  });

  it("creates a map, opens it, and clears the input", async () => {
    vi.mocked(listMaps).mockResolvedValue([]);
    vi.mocked(createMap).mockResolvedValue(mapOut({ id: 5, name: "New Map" }));
    const onOpen = vi.fn();
    renderMapList(onOpen);
    await flush();

    fireEvent.change(screen.getByPlaceholderText("New map name"), {
      target: { value: "  New Map  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create map" }));
    await flush();

    expect(createMap).toHaveBeenCalledWith("New Map");
    expect(onOpen).toHaveBeenCalledWith(mapOut({ id: 5, name: "New Map" }));
    expect(screen.getByPlaceholderText("New map name")).toHaveValue("");
  });

  it("opens a row's map on click", async () => {
    vi.mocked(listMaps).mockResolvedValue([mapOut({ id: 1, name: "Mine" })]);
    const onOpen = vi.fn();
    renderMapList(onOpen);
    await flush();

    fireEvent.click(screen.getByText("Mine"));
    expect(onOpen).toHaveBeenCalledWith(mapOut({ id: 1, name: "Mine" }));
  });

  it("renames a map on Enter (blur-to-save) and refreshes", async () => {
    vi.mocked(listMaps)
      .mockResolvedValueOnce([mapOut({ id: 1, name: "Old Name" })])
      .mockResolvedValueOnce([mapOut({ id: 1, name: "New Name" })]);
    vi.mocked(updateMap).mockResolvedValue(mapOut({ id: 1, name: "New Name" }));
    renderMapList();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByDisplayValue("Old Name");
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    await flush();

    expect(updateMap).toHaveBeenCalledWith(1, { name: "New Name" });
  });

  it("keeps the same input element across keystrokes (regression: RenameCell owns its own text so mineColumns doesn't remount it every keystroke)", async () => {
    vi.mocked(listMaps).mockResolvedValue([
      mapOut({ id: 1, name: "Old Name" }),
    ]);
    renderMapList();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByDisplayValue("Old Name");
    fireEvent.change(input, { target: { value: "New Name" } });

    expect(screen.getByDisplayValue("New Name")).toBe(input);
  });

  it("cancels a rename on Escape without saving", async () => {
    vi.mocked(listMaps).mockResolvedValue([
      mapOut({ id: 1, name: "Old Name" }),
    ]);
    renderMapList();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByDisplayValue("Old Name");
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.getByText("Old Name")).toBeInTheDocument();
    expect(updateMap).not.toHaveBeenCalled();
  });

  it("does not call updateMap when the name is unchanged on blur", async () => {
    vi.mocked(listMaps).mockResolvedValue([mapOut({ id: 1, name: "Same" })]);
    renderMapList();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.blur(screen.getByDisplayValue("Same"));
    await flush();

    expect(updateMap).not.toHaveBeenCalled();
  });

  it("deletes a map after confirmation and refreshes", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(listMaps)
      .mockResolvedValueOnce([mapOut({ id: 1, name: "Doomed" })])
      .mockResolvedValueOnce([]);
    vi.mocked(deleteMap).mockResolvedValue(undefined);
    renderMapList();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await flush();

    expect(deleteMap).toHaveBeenCalledWith(1);
    expect(
      screen.getByText("No maps yet — create one above."),
    ).toBeInTheDocument();
  });

  it("does not delete when the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.mocked(listMaps).mockResolvedValue([mapOut({ id: 1, name: "Safe" })]);
    renderMapList();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await flush();

    expect(deleteMap).not.toHaveBeenCalled();
  });

  it("opens the universe dialog for all maps", async () => {
    vi.mocked(listMaps).mockResolvedValue([]);
    renderMapList();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Universe" }));
    expect(screen.getByTestId("universe-dialog")).toBeInTheDocument();
  });

  it("lists the current user's shared routes, not anyone else's", async () => {
    vi.mocked(listMaps).mockResolvedValue([]);
    vi.mocked(listMyRoutes).mockResolvedValue([
      routeSummaryOut({
        id: 7,
        start_system_name: "Jita",
        end_system_name: "Amarr",
      }),
    ]);
    renderMapList();
    await flush();

    expect(screen.getByText("My shared routes")).toBeInTheDocument();
    expect(screen.getByText("Jita → Amarr")).toBeInTheDocument();
  });

  it("opens a shared route on click", async () => {
    vi.mocked(listMaps).mockResolvedValue([]);
    vi.mocked(listMyRoutes).mockResolvedValue([routeSummaryOut({ id: 7 })]);
    const onOpenRoute = vi.fn();
    renderMapList(vi.fn(), onOpenRoute);
    await flush();

    fireEvent.click(screen.getByText("Jita → Amarr"));
    expect(onOpenRoute).toHaveBeenCalledWith(routeSummaryOut({ id: 7 }));
  });

  it("deletes a shared route after confirmation and refreshes", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(listMaps).mockResolvedValue([]);
    vi.mocked(listMyRoutes)
      .mockResolvedValueOnce([routeSummaryOut({ id: 7 })])
      .mockResolvedValueOnce([]);
    vi.mocked(deleteSharedRoute).mockResolvedValue(undefined);
    renderMapList();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await flush();

    expect(deleteSharedRoute).toHaveBeenCalledWith(7);
    expect(
      screen.getByText("You haven't shared any routes yet."),
    ).toBeInTheDocument();
  });

  it("does not delete a route when the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.mocked(listMaps).mockResolvedValue([]);
    vi.mocked(listMyRoutes).mockResolvedValue([routeSummaryOut({ id: 7 })]);
    renderMapList();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await flush();

    expect(deleteSharedRoute).not.toHaveBeenCalled();
  });
});
