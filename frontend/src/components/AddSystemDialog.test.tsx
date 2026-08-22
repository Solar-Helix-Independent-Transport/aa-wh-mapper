import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addSystem, searchSolarSystems } from "../api/maps";
import type { SolarSystemOut } from "../api/types";
import { SEARCH_DEBOUNCE_MS } from "../constants";
import { AddSystemDialog } from "./AddSystemDialog";

vi.mock("../api/maps", () => ({
  addSystem: vi.fn(),
  searchSolarSystems: vi.fn(),
}));

function solarSystem(id: number, name: string): SolarSystemOut {
  return {
    id,
    name,
    security_status: 0.5,
    wormhole_class_id: null,
    visual_effect: null,
    constellation_name: null,
    region_name: null,
    space_type: "High Sec",
    owner: null,
    statics: [],
  };
}

async function search(query: string) {
  fireEvent.change(screen.getByPlaceholderText("Search solar system…"), {
    target: { value: query },
  });
  await act(async () => {
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    await Promise.resolve();
  });
}

describe("AddSystemDialog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(addSystem).mockReset();
    vi.mocked(searchSolarSystems).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("searches and lists results sorted by name", async () => {
    vi.mocked(searchSolarSystems).mockResolvedValue([
      solarSystem(2, "Zarzakh"),
      solarSystem(1, "Amarr"),
    ]);
    render(
      <AddSystemDialog
        mapId={1}
        existingSystems={[]}
        onClose={vi.fn()}
        onAdded={vi.fn()}
      />,
    );

    await search("ar");

    const rows = screen.getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual([
      "Amarr",
      "Zarzakh",
      "Cancel",
    ]);
  });

  it("adds the selected system at an explicit position and closes", async () => {
    vi.mocked(searchSolarSystems).mockResolvedValue([solarSystem(1, "Jita")]);
    vi.mocked(addSystem).mockResolvedValue({
      id: 1,
      map_id: 1,
      solar_system: solarSystem(1, "Jita"),
      label: "",
      x: 100,
      y: 200,
      pinned: false,
      added_by_id: null,
      added_at: "2026-01-01T00:00:00Z",
    });
    const onAdded = vi.fn();
    const onClose = vi.fn();
    render(
      <AddSystemDialog
        mapId={1}
        existingSystems={[]}
        position={{ x: 100, y: 200 }}
        onClose={onClose}
        onAdded={onAdded}
      />,
    );

    await search("jita");
    fireEvent.click(screen.getByRole("button", { name: "Jita" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(addSystem).toHaveBeenCalledWith(1, {
      solar_system_id: 1,
      x: 100,
      y: 200,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("falls back to nextPosition when no explicit position is given", async () => {
    vi.mocked(searchSolarSystems).mockResolvedValue([solarSystem(1, "Jita")]);
    vi.mocked(addSystem).mockResolvedValue({
      id: 1,
      map_id: 1,
      solar_system: solarSystem(1, "Jita"),
      label: "",
      x: 0,
      y: 0,
      pinned: false,
      added_by_id: null,
      added_at: "2026-01-01T00:00:00Z",
    });
    render(
      <AddSystemDialog
        mapId={1}
        existingSystems={[{ x: 500, y: 0 }]}
        onClose={vi.fn()}
        onAdded={vi.fn()}
      />,
    );

    await search("jita");
    fireEvent.click(screen.getByRole("button", { name: "Jita" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(addSystem).toHaveBeenCalled();
    const [, payload] = vi.mocked(addSystem).mock.calls[0];
    expect(payload.solar_system_id).toBe(1);
    expect(payload.x).toBeGreaterThan(500);
  });

  it("shows an error and stays open when adding fails", async () => {
    vi.mocked(searchSolarSystems).mockResolvedValue([solarSystem(1, "Jita")]);
    vi.mocked(addSystem).mockRejectedValue(new Error("already on map"));
    const onClose = vi.fn();
    render(
      <AddSystemDialog
        mapId={1}
        existingSystems={[]}
        onClose={onClose}
        onAdded={vi.fn()}
      />,
    );

    await search("jita");
    fireEvent.click(screen.getByRole("button", { name: "Jita" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(/already on map/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows a search error from a failed lookup", async () => {
    vi.mocked(searchSolarSystems).mockRejectedValue(new Error("search down"));
    render(
      <AddSystemDialog
        mapId={1}
        existingSystems={[]}
        onClose={vi.fn()}
        onAdded={vi.fn()}
      />,
    );

    await search("jita");

    expect(screen.getByText(/search down/)).toBeInTheDocument();
  });

  it("calls onClose on Cancel", () => {
    const onClose = vi.fn();
    render(
      <AddSystemDialog
        mapId={1}
        existingSystems={[]}
        onClose={onClose}
        onAdded={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
