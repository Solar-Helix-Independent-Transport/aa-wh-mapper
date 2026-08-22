import type {
  MapSystemOut,
  RegionGraphLandmarkKind,
  RegionGraphLandmarkOut,
  RouteDetail,
  WormholeConnectionOut,
} from "../api/types";

// Pure graph-derivation logic behind UniverseRegionsDialog, kept in its own
// non-component module rather than exported from the dialog file itself -
// same reasoning as wormholeClass.ts/dataTableFeatures.ts's own docstrings:
// exporting anything non-component from a component file breaks Fast
// Refresh. This also makes the logic directly unit-testable without
// mounting the (xyflow-heavy) dialog itself.

/** Names of every flat region touched by at least one connected k-space
 * system in this map - see the wayfinder map's Destination. A region name
 * that isn't a real flat region (e.g. a J-space system's own region) never
 * matches a graph node, so it's harmlessly ignored downstream. */
export function touchedRegionNames(
  systems: MapSystemOut[],
  connections: WormholeConnectionOut[],
): Set<string> {
  const regionBySolarSystemId = new Map<number, string>();
  for (const system of systems) {
    if (system.solar_system.region_name) {
      regionBySolarSystemId.set(
        system.solar_system.id,
        system.solar_system.region_name,
      );
    }
  }

  const touched = new Set<string>();
  for (const connection of connections) {
    const topRegion = regionBySolarSystemId.get(
      connection.top_system_solar_system_id,
    );
    const bottomRegion = regionBySolarSystemId.get(
      connection.bottom_system_solar_system_id,
    );
    if (topRegion) {
      touched.add(topRegion);
    }
    if (bottomRegion) {
      touched.add(bottomRegion);
    }
  }
  return touched;
}

// Thera, each Drifter system, and Turnur are all identified by their own
// solar_system_id - RegionGraphLandmarkOut.id *is* that system's id for
// every landmark kind.
export function resolveLandmark(
  solarSystemId: number,
  landmarks: RegionGraphLandmarkOut[],
): RegionGraphLandmarkOut | null {
  return landmarks.find((landmark) => landmark.id === solarSystemId) ?? null;
}

// A connection end resolves to either a landmark (Thera/a Drifter
// region/Turnur) or, failing that, an ordinary flat-region graph node -
// whichever this end's underlying solar system actually belongs to.
// Returns the xyflow node id to draw an edge to/from, already in whichever
// of the two id spaces (`landmark-<id>` vs plain region id) that node
// lives in.
export function resolveGraphNodeId(
  solarSystemId: number,
  regionName: string | null,
  landmarks: RegionGraphLandmarkOut[],
  nodeIdByName: Map<string, number>,
): { nodeId: string; landmark: RegionGraphLandmarkOut | null } | null {
  const landmark = resolveLandmark(solarSystemId, landmarks);
  if (landmark) {
    return { nodeId: `landmark-${landmark.id}`, landmark };
  }
  if (regionName) {
    const regionNodeId = nodeIdByName.get(regionName);
    if (regionNodeId !== undefined) {
      return { nodeId: String(regionNodeId), landmark: null };
    }
  }
  return null;
}

export type WormholeLink = { sourceNodeId: string; targetNodeId: string };

/** Every region-to-region (and region-to-landmark) wormhole link this
 * map's own connections reveal, plus which landmarks they touch - unlike
 * the static Stargate-derived edges, these are only ever known from the
 * currently open map. Covers any connection spanning two different flat
 * regions, not just ones touching Thera/a Drifter region/Turnur - a plain
 * region-to-region wormhole gets a link exactly the same way. */
export function mapWormholeTouchesAndLinks(
  systems: MapSystemOut[],
  connections: WormholeConnectionOut[],
  landmarks: RegionGraphLandmarkOut[],
  nodeIdByName: Map<string, number>,
): { touchedLandmarkIds: Set<number>; links: WormholeLink[] } {
  const regionBySolarSystemId = new Map<number, string>();
  for (const system of systems) {
    if (system.solar_system.region_name) {
      regionBySolarSystemId.set(
        system.solar_system.id,
        system.solar_system.region_name,
      );
    }
  }

  const touchedLandmarkIds = new Set<number>();
  const seenLinkKeys = new Set<string>();
  const links: WormholeLink[] = [];

  for (const connection of connections) {
    const topRegion =
      regionBySolarSystemId.get(connection.top_system_solar_system_id) ?? null;
    const bottomRegion =
      regionBySolarSystemId.get(connection.bottom_system_solar_system_id) ??
      null;
    const topResolved = resolveGraphNodeId(
      connection.top_system_solar_system_id,
      topRegion,
      landmarks,
      nodeIdByName,
    );
    const bottomResolved = resolveGraphNodeId(
      connection.bottom_system_solar_system_id,
      bottomRegion,
      landmarks,
      nodeIdByName,
    );

    if (topResolved?.landmark) {
      touchedLandmarkIds.add(topResolved.landmark.id);
    }
    if (bottomResolved?.landmark) {
      touchedLandmarkIds.add(bottomResolved.landmark.id);
    }

    if (
      !topResolved ||
      !bottomResolved ||
      topResolved.nodeId === bottomResolved.nodeId
    ) {
      continue;
    }
    const key = [topResolved.nodeId, bottomResolved.nodeId].sort().join("|");
    if (seenLinkKeys.has(key)) {
      continue;
    }
    seenLinkKeys.add(key);
    links.push({
      sourceNodeId: topResolved.nodeId,
      targetNodeId: bottomResolved.nodeId,
    });
  }

  return { touchedLandmarkIds, links };
}

/** The wormhole/ansiblex side of a route's own region footprint - mirrors
 * mapWormholeTouchesAndLinks, but walking route legs/systems instead of a
 * map's WormholeConnections. Stargate legs are skipped here (those already
 * get a solid accent-bright highlight on the static backbone edge itself -
 * see usedEdgeKeys below); a wormhole or ansiblex leg absolutely can cross
 * a real region boundary (or touch Thera/a Drifter region/Turnur), so
 * without this a route that's entirely wormhole hops would show nothing
 * highlighted at all. */
export function routeWormholeTouchesAndLinks(
  route: RouteDetail | null,
  landmarks: RegionGraphLandmarkOut[],
  nodeIdByName: Map<string, number>,
): {
  touchedLandmarkIds: Set<number>;
  touchedRegionNames: Set<string>;
  links: WormholeLink[];
} {
  const touchedLandmarkIds = new Set<number>();
  const touchedRegionNames = new Set<string>();
  const seenLinkKeys = new Set<string>();
  const links: WormholeLink[] = [];
  if (!route) {
    return { touchedLandmarkIds, touchedRegionNames, links };
  }

  route.legs.forEach((leg, index) => {
    if (leg.connection_type === "stargate") {
      return;
    }
    const fromSystem = route.systems[index];
    const toSystem = route.systems[index + 1];
    if (!fromSystem || !toSystem) {
      return;
    }
    const fromResolved = resolveGraphNodeId(
      fromSystem.id,
      fromSystem.region_name,
      landmarks,
      nodeIdByName,
    );
    const toResolved = resolveGraphNodeId(
      toSystem.id,
      toSystem.region_name,
      landmarks,
      nodeIdByName,
    );

    if (fromResolved?.landmark) {
      touchedLandmarkIds.add(fromResolved.landmark.id);
    } else if (fromResolved && fromSystem.region_name) {
      touchedRegionNames.add(fromSystem.region_name);
    }
    if (toResolved?.landmark) {
      touchedLandmarkIds.add(toResolved.landmark.id);
    } else if (toResolved && toSystem.region_name) {
      touchedRegionNames.add(toSystem.region_name);
    }

    if (
      !fromResolved ||
      !toResolved ||
      fromResolved.nodeId === toResolved.nodeId
    ) {
      return;
    }
    const key = [fromResolved.nodeId, toResolved.nodeId].sort().join("|");
    if (seenLinkKeys.has(key)) {
      return;
    }
    seenLinkKeys.add(key);
    links.push({
      sourceNodeId: fromResolved.nodeId,
      targetNodeId: toResolved.nodeId,
    });
  });

  return { touchedLandmarkIds, touchedRegionNames, links };
}

/** Every 1-indexed route hop number that lands in each graph node (region
 * or landmark) - e.g. a route whose hops 4-7 all pass through the same
 * region map to that region's node id -> [4, 5, 6, 7]. Numbers stay in the
 * route's own visiting order (not necessarily sorted - a route can leave a
 * region and come back later), matching RouteDiagram/RouteItinerary's own
 * 1-indexed hop numbering. */
export function routeHopNumbersByNodeId(
  route: RouteDetail | null,
  landmarks: RegionGraphLandmarkOut[],
  nodeIdByName: Map<string, number>,
): Map<string, number[]> {
  const hopsByNodeId = new Map<string, number[]>();
  if (!route) {
    return hopsByNodeId;
  }
  route.systems.forEach((system, index) => {
    const resolved = resolveGraphNodeId(
      system.id,
      system.region_name,
      landmarks,
      nodeIdByName,
    );
    if (!resolved) {
      return;
    }
    const hopNumber = index + 1;
    const existing = hopsByNodeId.get(resolved.nodeId);
    if (existing) {
      existing.push(hopNumber);
    } else {
      hopsByNodeId.set(resolved.nodeId, [hopNumber]);
    }
  });
  return hopsByNodeId;
}

/** Collapses hop numbers into "4-7"-style ranges for a compact node badge -
 * e.g. [4,5,6,7,9,2] -> "2, 4-7, 9". Sorted first since a route can revisit
 * a region out of order; consecutive runs collapse, singletons don't. */
export function collapseHopNumbers(hopNumbers: number[]): string {
  const sorted = [...hopNumbers].sort((a, b) => a - b);
  const parts: string[] = [];
  let rangeStart = sorted[0];
  let rangeEnd = sorted[0];
  for (const hop of sorted.slice(1)) {
    if (hop === rangeEnd + 1) {
      rangeEnd = hop;
      continue;
    }
    parts.push(
      rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`,
    );
    rangeStart = hop;
    rangeEnd = hop;
  }
  parts.push(
    rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`,
  );
  return parts.join(", ");
}

/** Region-id pairs (sorted, "a-b" keyed) crossed by a stargate leg of this
 * route - see the wayfinder map's Destination. This half stays a solid
 * accent-bright highlight on the static backbone edge itself, distinct
 * from routeWormholeTouchesAndLinks' dashed wormhole links above. */
export function usedEdgeKeys(
  route: RouteDetail | null,
  nodeIdByName: Map<string, number>,
): Set<string> {
  const used = new Set<string>();
  if (!route) {
    return used;
  }
  route.legs.forEach((leg, index) => {
    if (leg.connection_type !== "stargate") {
      return;
    }
    const fromName = route.systems[index]?.region_name;
    const toName = route.systems[index + 1]?.region_name;
    if (!fromName || !toName || fromName === toName) {
      return;
    }
    const fromId = nodeIdByName.get(fromName);
    const toId = nodeIdByName.get(toName);
    if (fromId === undefined || toId === undefined) {
      return;
    }
    const [a, b] = [fromId, toId].sort((x, y) => x - y);
    used.add(`${a}-${b}`);
  });
  return used;
}

// Thera first, then the five Drifter regions, then Turnur - a fixed
// display order independent of whatever order the API happens to return
// them in.
export const LANDMARK_KIND_ORDER: Record<RegionGraphLandmarkKind, number> = {
  thera: 0,
  drifter: 1,
  turnur: 2,
};

// How far left of the main region cluster's bounding box the landmark
// column sits, in the same (compressed) canvas units as the region nodes.
const LANDMARK_COLUMN_MARGIN = 400;

export function landmarkColumnPositions(
  landmarks: RegionGraphLandmarkOut[],
  regionPositions: { x: number; y: number }[],
): Map<number, { x: number; y: number }> {
  const positions = new Map<number, { x: number; y: number }>();
  if (landmarks.length === 0) {
    return positions;
  }

  const xs = regionPositions.map((p) => p.x);
  const ys = regionPositions.map((p) => p.y);
  const minX = xs.length > 0 ? Math.min(...xs) : 0;
  const minY = ys.length > 0 ? Math.min(...ys) : 0;
  const maxY = ys.length > 0 ? Math.max(...ys) : 0;

  const columnX = minX - LANDMARK_COLUMN_MARGIN;
  const ordered = [...landmarks].sort(
    (a, b) => LANDMARK_KIND_ORDER[a.kind] - LANDMARK_KIND_ORDER[b.kind],
  );

  ordered.forEach((landmark, index) => {
    const t = ordered.length > 1 ? index / (ordered.length - 1) : 0.5;
    positions.set(landmark.id, { x: columnX, y: minY + t * (maxY - minY) });
  });
  return positions;
}

// The server's centroid layout spaces regions out proportionally to their
// real in-game distance, which leaves large gaps for a ~70-node overview
// graph - uniformly scaling every position toward the shared centroid by
// this factor tightens the whole layout while preserving its relative
// shape (every pairwise distance shrinks by the same amount).
const LAYOUT_COMPRESSION_FACTOR = 0.55;

export function compressPositions(
  nodes: { id: number; x: number; y: number }[],
): Map<number, { x: number; y: number }> {
  const positions = new Map<number, { x: number; y: number }>();
  if (nodes.length === 0) {
    return positions;
  }
  const centerX = nodes.reduce((sum, n) => sum + n.x, 0) / nodes.length;
  const centerY = nodes.reduce((sum, n) => sum + n.y, 0) / nodes.length;
  for (const n of nodes) {
    positions.set(n.id, {
      x: centerX + (n.x - centerX) * LAYOUT_COMPRESSION_FACTOR,
      y: centerY + (n.y - centerY) * LAYOUT_COMPRESSION_FACTOR,
    });
  }
  return positions;
}
