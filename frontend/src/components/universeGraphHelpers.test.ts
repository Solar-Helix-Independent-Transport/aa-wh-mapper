import { describe, expect, it } from "vitest";
import type {
  MapSystemOut,
  RegionGraphLandmarkOut,
  RouteDetail,
  RouteLegOut,
  SolarSystemOut,
  WormholeConnectionOut,
} from "../api/types";
import {
  collapseHopNumbers,
  compressPositions,
  landmarkColumnPositions,
  mapWormholeTouchesAndLinks,
  resolveGraphNodeId,
  resolveLandmark,
  routeHopNumbersByNodeId,
  routeWormholeTouchesAndLinks,
  touchedRegionNames,
  usedEdgeKeys,
} from "./universeGraphHelpers";

function solarSystem(
  id: number,
  regionName: string | null,
  overrides: Partial<SolarSystemOut> = {},
): SolarSystemOut {
  return {
    id,
    name: `System ${id}`,
    security_status: 0.5,
    wormhole_class_id: null,
    visual_effect: null,
    constellation_name: null,
    region_name: regionName,
    space_type: "High Sec",
    owner: null,
    ...overrides,
  } as SolarSystemOut;
}

function mapSystem(id: number, regionName: string | null): MapSystemOut {
  return {
    id: id * 10,
    solar_system: solarSystem(id, regionName),
  } as MapSystemOut;
}

function connection(
  topSolarSystemId: number,
  bottomSolarSystemId: number,
): WormholeConnectionOut {
  return {
    top_system_solar_system_id: topSolarSystemId,
    bottom_system_solar_system_id: bottomSolarSystemId,
  } as WormholeConnectionOut;
}

function landmark(
  id: number,
  kind: RegionGraphLandmarkOut["kind"],
  name = `Landmark ${id}`,
): RegionGraphLandmarkOut {
  return { id, name, kind };
}

function routeLeg(
  connectionType: RouteLegOut["connection_type"],
  overrides: Partial<RouteLegOut> = {},
): RouteLegOut {
  return {
    connection_type: connectionType,
    life_status: null,
    mass_status: null,
    map_id: null,
    connection_id: null,
    connection: null,
    ...overrides,
  };
}

function route(systems: SolarSystemOut[], legs: RouteLegOut[]): RouteDetail {
  return { systems, legs, contributors: [] };
}

describe("touchedRegionNames", () => {
  it("collects the region of both connection ends", () => {
    const systems = [mapSystem(1, "Region A"), mapSystem(2, "Region B")];
    const connections = [connection(1, 2)];

    expect(touchedRegionNames(systems, connections)).toEqual(
      new Set(["Region A", "Region B"]),
    );
  });

  it("ignores a connection end whose system isn't in the map", () => {
    const systems = [mapSystem(1, "Region A")];
    const connections = [connection(1, 999)];

    expect(touchedRegionNames(systems, connections)).toEqual(
      new Set(["Region A"]),
    );
  });

  it("ignores a system with no region name (e.g. J-space)", () => {
    const systems = [mapSystem(1, null), mapSystem(2, "Region B")];
    const connections = [connection(1, 2)];

    expect(touchedRegionNames(systems, connections)).toEqual(
      new Set(["Region B"]),
    );
  });

  it("returns an empty set with no connections", () => {
    expect(touchedRegionNames([mapSystem(1, "Region A")], [])).toEqual(
      new Set(),
    );
  });
});

describe("resolveLandmark", () => {
  const landmarks = [landmark(31000005, "thera"), landmark(30002086, "turnur")];

  it("finds a landmark by solar system id", () => {
    expect(resolveLandmark(31000005, landmarks)).toEqual(
      landmark(31000005, "thera"),
    );
  });

  it("returns null when no landmark matches", () => {
    expect(resolveLandmark(1, landmarks)).toBeNull();
  });
});

describe("resolveGraphNodeId", () => {
  const landmarks = [landmark(31000005, "thera")];
  const nodeIdByName = new Map([["Region A", 100]]);

  it("prefers a landmark match even when the region name would also resolve", () => {
    expect(
      resolveGraphNodeId(31000005, "Region A", landmarks, nodeIdByName),
    ).toEqual({
      nodeId: "landmark-31000005",
      landmark: landmark(31000005, "thera"),
    });
  });

  it("falls back to the region node id when there's no landmark match", () => {
    expect(resolveGraphNodeId(1, "Region A", landmarks, nodeIdByName)).toEqual({
      nodeId: "100",
      landmark: null,
    });
  });

  it("returns null when neither a landmark nor a known region matches", () => {
    expect(
      resolveGraphNodeId(1, "Unknown Region", landmarks, nodeIdByName),
    ).toBeNull();
  });

  it("returns null with a null region name and no landmark match", () => {
    expect(resolveGraphNodeId(1, null, landmarks, nodeIdByName)).toBeNull();
  });
});

describe("mapWormholeTouchesAndLinks", () => {
  const nodeIdByName = new Map([
    ["Region A", 100],
    ["Region B", 200],
  ]);

  it("links two different real regions", () => {
    const systems = [mapSystem(1, "Region A"), mapSystem(2, "Region B")];
    const result = mapWormholeTouchesAndLinks(
      systems,
      [connection(1, 2)],
      [],
      nodeIdByName,
    );

    expect(result.links).toEqual([
      { sourceNodeId: "100", targetNodeId: "200" },
    ]);
    expect(result.touchedLandmarkIds).toEqual(new Set());
  });

  it("marks a landmark touched and links it to the other region", () => {
    const thera = landmark(31000005, "thera");
    const systems = [mapSystem(31000005, null), mapSystem(2, "Region B")];
    const result = mapWormholeTouchesAndLinks(
      systems,
      [connection(31000005, 2)],
      [thera],
      nodeIdByName,
    );

    expect(result.touchedLandmarkIds).toEqual(new Set([31000005]));
    expect(result.links).toEqual([
      { sourceNodeId: "landmark-31000005", targetNodeId: "200" },
    ]);
  });

  it("marks a landmark touched even when the other end can't resolve at all", () => {
    const thera = landmark(31000005, "thera");
    const systems = [mapSystem(31000005, null)];
    const result = mapWormholeTouchesAndLinks(
      systems,
      [connection(31000005, 999)],
      [thera],
      nodeIdByName,
    );

    expect(result.touchedLandmarkIds).toEqual(new Set([31000005]));
    expect(result.links).toEqual([]);
  });

  it("produces no link when both ends resolve to the same node", () => {
    const systems = [mapSystem(1, "Region A"), mapSystem(2, "Region A")];
    const result = mapWormholeTouchesAndLinks(
      systems,
      [connection(1, 2)],
      [],
      nodeIdByName,
    );

    expect(result.links).toEqual([]);
  });

  it("dedupes multiple connections between the same node pair into one link", () => {
    const systems = [mapSystem(1, "Region A"), mapSystem(2, "Region B")];
    const connections = [connection(1, 2), connection(2, 1)];
    const result = mapWormholeTouchesAndLinks(
      systems,
      connections,
      [],
      nodeIdByName,
    );

    expect(result.links).toHaveLength(1);
  });
});

describe("routeWormholeTouchesAndLinks", () => {
  const nodeIdByName = new Map([
    ["Region A", 100],
    ["Region B", 200],
  ]);

  it("returns everything empty for a null route", () => {
    expect(routeWormholeTouchesAndLinks(null, [], nodeIdByName)).toEqual({
      touchedLandmarkIds: new Set(),
      touchedRegionNames: new Set(),
      links: [],
    });
  });

  it("skips stargate legs entirely", () => {
    const r = route(
      [solarSystem(1, "Region A"), solarSystem(2, "Region B")],
      [routeLeg("stargate")],
    );

    const result = routeWormholeTouchesAndLinks(r, [], nodeIdByName);

    expect(result.links).toEqual([]);
    expect(result.touchedRegionNames).toEqual(new Set());
  });

  it("records the region touched by a wormhole leg between two real regions", () => {
    const r = route(
      [solarSystem(1, "Region A"), solarSystem(2, "Region B")],
      [routeLeg("wormhole")],
    );

    const result = routeWormholeTouchesAndLinks(r, [], nodeIdByName);

    expect(result.touchedRegionNames).toEqual(
      new Set(["Region A", "Region B"]),
    );
    expect(result.links).toEqual([
      { sourceNodeId: "100", targetNodeId: "200" },
    ]);
  });

  it("records a landmark touch (not a region touch) for a leg landing on one", () => {
    const thera = landmark(31000005, "thera");
    const r = route(
      [solarSystem(31000005, null), solarSystem(2, "Region B")],
      [routeLeg("wormhole")],
    );

    const result = routeWormholeTouchesAndLinks(r, [thera], nodeIdByName);

    expect(result.touchedLandmarkIds).toEqual(new Set([31000005]));
    expect(result.touchedRegionNames).toEqual(new Set(["Region B"]));
  });

  it("counts an ansiblex leg the same way as a wormhole leg", () => {
    const r = route(
      [solarSystem(1, "Region A"), solarSystem(2, "Region B")],
      [routeLeg("ansiblex")],
    );

    const result = routeWormholeTouchesAndLinks(r, [], nodeIdByName);

    expect(result.links).toEqual([
      { sourceNodeId: "100", targetNodeId: "200" },
    ]);
  });

  it("dedupes repeated links between the same node pair", () => {
    const r = route(
      [
        solarSystem(1, "Region A"),
        solarSystem(2, "Region B"),
        solarSystem(3, "Region A"),
      ],
      [routeLeg("wormhole"), routeLeg("wormhole")],
    );

    const result = routeWormholeTouchesAndLinks(r, [], nodeIdByName);

    expect(result.links).toHaveLength(1);
  });
});

describe("routeHopNumbersByNodeId", () => {
  const nodeIdByName = new Map([
    ["Region A", 100],
    ["Region B", 200],
  ]);

  it("returns an empty map for a null route", () => {
    expect(routeHopNumbersByNodeId(null, [], nodeIdByName)).toEqual(new Map());
  });

  it("numbers hops 1-indexed in visiting order", () => {
    const r = route(
      [solarSystem(1, "Region A"), solarSystem(2, "Region B")],
      [routeLeg("wormhole")],
    );

    const result = routeHopNumbersByNodeId(r, [], nodeIdByName);

    expect(result.get("100")).toEqual([1]);
    expect(result.get("200")).toEqual([2]);
  });

  it("accumulates every visit when a route revisits the same node out of order", () => {
    const r = route(
      [
        solarSystem(1, "Region A"),
        solarSystem(2, "Region B"),
        solarSystem(3, "Region A"),
      ],
      [routeLeg("wormhole"), routeLeg("wormhole")],
    );

    const result = routeHopNumbersByNodeId(r, [], nodeIdByName);

    expect(result.get("100")).toEqual([1, 3]);
  });

  it("skips a system that resolves to nothing (unknown region, no landmark)", () => {
    const r = route(
      [solarSystem(1, "Unknown"), solarSystem(2, "Region B")],
      [routeLeg("wormhole")],
    );

    const result = routeHopNumbersByNodeId(r, [], nodeIdByName);

    expect(result.has("Unknown")).toBe(false);
    expect(result.get("200")).toEqual([2]);
  });
});

describe("collapseHopNumbers", () => {
  it("collapses a consecutive run into a range", () => {
    expect(collapseHopNumbers([4, 5, 6, 7])).toBe("4-7");
  });

  it("keeps a lone number as a singleton", () => {
    expect(collapseHopNumbers([9])).toBe("9");
  });

  it("sorts unsorted input before collapsing", () => {
    expect(collapseHopNumbers([4, 5, 6, 7, 9, 2])).toBe("2, 4-7, 9");
  });

  it("keeps consecutive singletons separate when not adjacent", () => {
    expect(collapseHopNumbers([1, 3, 5])).toBe("1, 3, 5");
  });
});

describe("usedEdgeKeys", () => {
  const nodeIdByName = new Map([
    ["Region A", 100],
    ["Region B", 200],
  ]);

  it("returns an empty set for a null route", () => {
    expect(usedEdgeKeys(null, nodeIdByName)).toEqual(new Set());
  });

  it("keys a stargate leg crossing two regions, sorted low-high", () => {
    const r = route(
      [solarSystem(1, "Region B"), solarSystem(2, "Region A")],
      [routeLeg("stargate")],
    );

    expect(usedEdgeKeys(r, nodeIdByName)).toEqual(new Set(["100-200"]));
  });

  it("ignores non-stargate legs", () => {
    const r = route(
      [solarSystem(1, "Region A"), solarSystem(2, "Region B")],
      [routeLeg("wormhole")],
    );

    expect(usedEdgeKeys(r, nodeIdByName)).toEqual(new Set());
  });

  it("produces no key for a stargate leg within the same region", () => {
    const r = route(
      [solarSystem(1, "Region A"), solarSystem(2, "Region A")],
      [routeLeg("stargate")],
    );

    expect(usedEdgeKeys(r, nodeIdByName)).toEqual(new Set());
  });

  it("skips a stargate leg touching a region with no known graph node", () => {
    const r = route(
      [solarSystem(1, "Region A"), solarSystem(2, "Unmapped Region")],
      [routeLeg("stargate")],
    );

    expect(usedEdgeKeys(r, nodeIdByName)).toEqual(new Set());
  });
});

describe("landmarkColumnPositions", () => {
  it("returns an empty map with no landmarks", () => {
    expect(landmarkColumnPositions([], [{ x: 0, y: 0 }])).toEqual(new Map());
  });

  it("centers a lone landmark at the midpoint of the region cluster's y range", () => {
    const result = landmarkColumnPositions(
      [landmark(1, "thera")],
      [
        { x: 0, y: 0 },
        { x: 100, y: 200 },
      ],
    );

    expect(result.get(1)).toEqual({ x: 0 - 400, y: 100 });
  });

  it("orders multiple landmarks thera, then drifter, then turnur regardless of input order", () => {
    const result = landmarkColumnPositions(
      [landmark(3, "turnur"), landmark(1, "thera"), landmark(2, "drifter")],
      [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
      ],
    );

    expect(result.get(1)?.y).toBe(0); // thera first
    expect(result.get(2)?.y).toBe(50); // drifter in the middle
    expect(result.get(3)?.y).toBe(100); // turnur last
  });

  it("doesn't produce NaN positions when there are no positioned regions at all", () => {
    const result = landmarkColumnPositions([landmark(1, "thera")], []);
    expect(result.get(1)).toEqual({ x: -400, y: 0 });
  });
});

describe("compressPositions", () => {
  it("returns an empty map for no nodes", () => {
    expect(compressPositions([])).toEqual(new Map());
  });

  it("leaves a lone node exactly where it is (it's already the centroid)", () => {
    const result = compressPositions([{ id: 1, x: 50, y: 50 }]);
    expect(result.get(1)).toEqual({ x: 50, y: 50 });
  });

  it("scales every node toward the shared centroid by the compression factor", () => {
    const result = compressPositions([
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 100, y: 0 },
    ]);

    // Centroid is (50, 0); each node moves to 55% of its distance from it.
    expect(result.get(1)).toEqual({ x: 50 - 50 * 0.55, y: 0 });
    expect(result.get(2)).toEqual({ x: 50 + 50 * 0.55, y: 0 });
  });
});
