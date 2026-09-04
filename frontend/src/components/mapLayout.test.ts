import { describe, expect, it } from "vitest";
import type { MapSystemOut, WormholeConnectionOut } from "../api/types";
import { SNAP_GRID } from "../constants";
import { computeAutoLayout } from "./mapLayout";

function mapSystem(overrides: Partial<MapSystemOut> = {}): MapSystemOut {
  return {
    id: 1,
    map_id: 1,
    label: "",
    x: 0,
    y: 0,
    pinned: false,
    added_by_id: null,
    added_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as MapSystemOut;
}

function connection(
  overrides: Partial<WormholeConnectionOut> = {},
): WormholeConnectionOut {
  return {
    id: 1,
    map_id: 1,
    connection_type: "wormhole",
    top_system_id: 1,
    bottom_system_id: 2,
    top_system_solar_system_id: 100,
    bottom_system_solar_system_id: 200,
    top_signature_id: null,
    bottom_signature_id: null,
    life_status: "stable",
    life_status_marked_at: null,
    mass_status: "unknown",
    ship_size_limit: "unknown",
    time_status: "unknown",
    created_by_id: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  } as WormholeConnectionOut;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("computeAutoLayout", () => {
  it("returns nothing for an empty map", () => {
    expect(computeAutoLayout([], [])).toEqual([]);
  });

  it("ignores a connection referencing a system not on the map", () => {
    const systems = [mapSystem({ id: 1, x: 0, y: 0 })];
    const connections = [
      connection({ top_system_id: 1, bottom_system_id: 999 }),
    ];

    expect(() => computeAutoLayout(systems, connections)).not.toThrow();
  });

  it("excludes a pinned system from the result and roots its component on it", () => {
    const systems = [
      mapSystem({ id: 1, x: 500, y: 500, pinned: true }),
      mapSystem({ id: 2 }),
    ];
    const connections = [connection({ top_system_id: 1, bottom_system_id: 2 })];

    const result = computeAutoLayout(systems, connections);

    expect(result.map((p) => p.id)).toEqual([2]);
    // A direct neighbor of the pinned root sits one hop away from its real
    // position - not on top of it, and not off at some unrelated distance.
    const neighbor = result[0];
    expect(distance(neighbor, { x: 500, y: 500 })).toBeGreaterThan(50);
    expect(distance(neighbor, { x: 500, y: 500 })).toBeLessThan(500);
  });

  it("places a two-hop neighbor farther from the pinned root than a one-hop neighbor", () => {
    const systems = [
      mapSystem({ id: 1, x: 0, y: 0, pinned: true }),
      mapSystem({ id: 2 }),
      mapSystem({ id: 3 }),
    ];
    const connections = [
      connection({ id: 1, top_system_id: 1, bottom_system_id: 2 }),
      connection({ id: 2, top_system_id: 2, bottom_system_id: 3 }),
    ];

    const result = computeAutoLayout(systems, connections);

    const twoHops = result.find((p) => p.id === 2)!;
    const threeHops = result.find((p) => p.id === 3)!;
    const root = { x: 0, y: 0 };
    expect(distance(threeHops, root)).toBeGreaterThan(distance(twoHops, root));
  });

  it("spreads sibling branches off a pinned root along the cross axis, at the same depth", () => {
    const systems = [
      mapSystem({ id: 1, x: 0, y: 0, pinned: true }),
      mapSystem({ id: 2 }),
      mapSystem({ id: 3 }),
    ];
    const connections = [
      connection({ id: 1, top_system_id: 1, bottom_system_id: 2 }),
      connection({ id: 2, top_system_id: 1, bottom_system_id: 3 }),
    ];

    const result = computeAutoLayout(systems, connections);

    const a = result.find((p) => p.id === 2)!;
    const b = result.find((p) => p.id === 3)!;
    // Same hop distance from the root -> same position along the chain's
    // growth axis - but pushed apart from each other along the cross axis
    // so they don't land on top of one another.
    expect(a.x).toBe(b.x);
    expect(a.y).not.toBe(b.y);
  });

  it("packs a component with no pinned system of its own separately, without overlapping an anchored one", () => {
    const systems = [
      mapSystem({ id: 1, x: 0, y: 0, pinned: true }),
      mapSystem({ id: 2 }),
      mapSystem({ id: 3 }),
      mapSystem({ id: 4 }),
    ];
    const connections = [
      connection({ id: 1, top_system_id: 1, bottom_system_id: 2 }),
      // A second, unrelated component - not connected to the pinned one.
      connection({ id: 2, top_system_id: 3, bottom_system_id: 4 }),
    ];

    const result = computeAutoLayout(systems, connections);

    const anchoredNeighbor = result.find((p) => p.id === 2)!;
    const freeComponent = result.filter((p) => p.id === 3 || p.id === 4);
    // The free component is stacked below everything already placed - its
    // whole vertical extent sits below the anchored component's.
    for (const point of freeComponent) {
      expect(point.y).toBeGreaterThan(anchoredNeighbor.y);
    }
  });

  it("separates two fully isolated systems instead of stacking them on each other", () => {
    const systems = [
      mapSystem({ id: 1, x: 0, y: 0 }),
      mapSystem({ id: 2, x: 0, y: 0 }),
    ];

    const result = computeAutoLayout(systems, []);

    const [a, b] = result;
    expect(distance(a, b)).toBeGreaterThan(0);
  });

  it("snaps every returned position to the canvas grid", () => {
    const systems = [
      mapSystem({ id: 1, x: 13, y: 47 }),
      mapSystem({ id: 2, x: -8, y: 91 }),
    ];
    const connections = [connection({ top_system_id: 1, bottom_system_id: 2 })];

    const result = computeAutoLayout(systems, connections);

    const [gridX, gridY] = SNAP_GRID;
    for (const position of result) {
      // `|| 0` folds a -0 remainder (still an exact grid multiple) to plain
      // 0 - toBe(0) alone treats -0 and 0 as distinct via Object.is.
      expect(position.x % gridX || 0).toBe(0);
      expect(position.y % gridY || 0).toBe(0);
    }
  });
});
