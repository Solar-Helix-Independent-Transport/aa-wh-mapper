import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { getMapState, getUniverseRegionsGraph } from "../api/maps";
import type {
  MapOut,
  MapSystemOut,
  RegionGraphLandmarkKind,
  RegionGraphLandmarkOut,
  RegionGraphOut,
  RouteDetail,
  WormholeConnectionOut,
} from "../api/types";
import { Dialog } from "./Dialog";
import { LoadingState } from "./LoadingState";

type Props =
  | {
      mode: "map";
      systems: MapSystemOut[];
      connections: WormholeConnectionOut[];
      onClose: () => void;
    }
  | {
      mode: "route";
      route: RouteDetail | null;
      onClose: () => void;
    }
  | {
      mode: "all-maps";
      maps: MapOut[];
      onClose: () => void;
    };

/** Names of every flat region touched by at least one connected k-space
 * system in this map - see the wayfinder map's Destination. A region name
 * that isn't a real flat region (e.g. a J-space system's own region) never
 * matches a graph node, so it's harmlessly ignored downstream. */
function touchedRegionNames(
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

// Thera/each Drifter system is identified by its own solar_system_id
// (RegionGraphLandmarkOut.id *is* that system's id for those two kinds);
// Pochven has no single system id worth matching against, so it's
// identified by region name instead, like any other flat region.
function resolveLandmark(
  solarSystemId: number,
  regionName: string | null,
  landmarks: RegionGraphLandmarkOut[],
): RegionGraphLandmarkOut | null {
  const bySystemId = landmarks.find(
    (landmark) => landmark.kind !== "pochven" && landmark.id === solarSystemId,
  );
  if (bySystemId) {
    return bySystemId;
  }
  const pochven = landmarks.find((landmark) => landmark.kind === "pochven");
  if (pochven && regionName === pochven.name) {
    return pochven;
  }
  return null;
}

// A connection end resolves to either a landmark (Thera/a Drifter
// region/Pochven) or, failing that, an ordinary flat-region graph node -
// whichever this end's underlying solar system actually belongs to.
// Returns the xyflow node id to draw an edge to/from, already in whichever
// of the two id spaces (`landmark-<id>` vs plain region id) that node
// lives in.
function resolveGraphNodeId(
  solarSystemId: number,
  regionName: string | null,
  landmarks: RegionGraphLandmarkOut[],
  nodeIdByName: Map<string, number>,
): { nodeId: string; landmark: RegionGraphLandmarkOut | null } | null {
  const landmark = resolveLandmark(solarSystemId, regionName, landmarks);
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

type WormholeLink = { sourceNodeId: string; targetNodeId: string };

/** Every region-to-region (and region-to-landmark) wormhole link this
 * map's own connections reveal, plus which landmarks they touch - unlike
 * the static Stargate-derived edges, these are only ever known from the
 * currently open map. Covers any connection spanning two different flat
 * regions, not just ones touching Thera/a Drifter region/Pochven - a plain
 * region-to-region wormhole gets a link exactly the same way. */
function mapWormholeTouchesAndLinks(
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
 * a real region boundary (or touch Thera/a Drifter region/Pochven), so
 * without this a route that's entirely wormhole hops would show nothing
 * highlighted at all. */
function routeWormholeTouchesAndLinks(
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
function routeHopNumbersByNodeId(
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
function collapseHopNumbers(hopNumbers: number[]): string {
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
function usedEdgeKeys(
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

type RegionNodeData = {
  name: string;
  touched: boolean;
  selected: boolean;
  // 1-indexed route hop number(s) landing in this region, collapsed into
  // "4-7"-style ranges (see collapseHopNumbers) - route mode only.
  hopLabel?: string;
};

// Handles are pinned to the dot's own center (see .universe-*-node-handle
// in App.css) rather than left at xyflow's default Top/Bottom placement,
// which anchors to the whole node box - dot plus label below it - and so
// would draw every edge into the label instead of the dot.
function RegionGraphNode({ data }: NodeProps & { data: RegionNodeData }) {
  return (
    <div className="universe-region-node">
      <Handle
        type="target"
        position={Position.Top}
        className="universe-node-handle"
      />
      {data.hopLabel && (
        <span className="universe-node-hop-badge">{data.hopLabel}</span>
      )}
      <div
        className={`universe-region-node-dot${
          data.touched ? " universe-region-node-dot-touched" : ""
        }${data.selected ? " universe-node-dot-selected" : ""}`}
      />
      <span
        className={`universe-region-node-label${
          data.touched ? " universe-region-node-label-touched" : ""
        }`}
      >
        {data.name}
      </span>
      <Handle
        type="source"
        position={Position.Bottom}
        className="universe-node-handle"
      />
    </div>
  );
}

type LandmarkNodeData = {
  name: string;
  kind: RegionGraphLandmarkKind;
  touched: boolean;
  selected: boolean;
  hopLabel?: string;
};

// Square marker (vs. RegionGraphNode's circle) so a landmark reads as its
// own category at a glance, independent of touched state. Needs both a
// target *and* a source handle - a WormholeConnection's top/bottom order
// is arbitrary, so a landmark can end up as either end of a derived edge
// (see mapWormholeTouchesAndLinks); with only a source handle, any edge
// that landed on this landmark as its *target* silently failed to render
// (React Flow error #008, "Couldn't create edge for target handle id:
// null") instead of just looking the same as every other edge.
function LandmarkGraphNode({ data }: NodeProps & { data: LandmarkNodeData }) {
  return (
    <div className="universe-landmark-node">
      <Handle
        type="target"
        position={Position.Right}
        className="universe-node-handle"
      />
      {data.hopLabel && (
        <span className="universe-node-hop-badge">{data.hopLabel}</span>
      )}
      <div
        className={`universe-landmark-node-dot${
          data.touched ? " universe-landmark-node-dot-touched" : ""
        }${data.selected ? " universe-node-dot-selected" : ""}`}
      />
      <span
        className={`universe-landmark-node-label${
          data.touched ? " universe-landmark-node-label-touched" : ""
        }`}
      >
        {data.name}
      </span>
      <Handle
        type="source"
        position={Position.Right}
        className="universe-node-handle"
      />
    </div>
  );
}

const nodeTypes = { region: RegionGraphNode, landmark: LandmarkGraphNode };

// Thera first, then the five Drifter regions, then Pochven - a fixed
// display order independent of whatever order the API happens to return
// them in.
const LANDMARK_KIND_ORDER: Record<RegionGraphLandmarkKind, number> = {
  thera: 0,
  drifter: 1,
  pochven: 2,
};

// How far left of the main region cluster's bounding box the landmark
// column sits, in the same (compressed) canvas units as the region nodes.
const LANDMARK_COLUMN_MARGIN = 400;

function landmarkColumnPositions(
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

function compressPositions(
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

/** Read-only region-to-region graph popout - see the wayfinder map at
 * .scratch/universe-regions/map.md. Opened from either MapView (mode
 * "map", ring-highlights every real-space region a connected k-space
 * system in this map reaches) or RouteFinder (mode "route", accent-strokes
 * the region-to-region edges the route's stargate legs actually cross). */
export function UniverseRegionsDialog(props: Props) {
  const { onClose } = props;
  const [graph, setGraph] = useState<RegionGraphOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Only populated for mode "all-maps" - every visible map's own systems/
  // connections, fetched up front and merged so the same touched-region/
  // landmark-link logic mode "map" already uses can just run once across
  // all of them instead of duplicating it per map.
  const [aggregated, setAggregated] = useState<{
    systems: MapSystemOut[];
    connections: WormholeConnectionOut[];
  } | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const legendRef = useRef<HTMLDivElement>(null);
  // Clicking a node spotlights it: itself, whatever it's directly linked to
  // (start/end of every connected edge), and those edges - everything else
  // fades. Clicking an edge instead spotlights just that edge and its own
  // start/end nodes. Click the same node/edge again, or the background, to
  // clear it - the two are mutually exclusive (picking one clears the other).
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  useEffect(() => {
    if (!legendOpen) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (
        legendRef.current &&
        !legendRef.current.contains(event.target as globalThis.Node)
      ) {
        setLegendOpen(false);
      }
    };
    // Capture phase, not bubble - see MapLegend's own use of this same
    // pattern: a click on the ReactFlow pane/nodes never reaches a
    // bubble-phase document listener, so this would otherwise never close
    // when clicking anywhere on the canvas itself.
    document.addEventListener("mousedown", handleClickOutside, true);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside, true);
  }, [legendOpen]);

  useEffect(() => {
    getUniverseRegionsGraph()
      .then(setGraph)
      .catch((err) => setError(String(err)));
  }, []);

  useEffect(() => {
    if (props.mode !== "all-maps") {
      return;
    }
    Promise.allSettled(props.maps.map((m) => getMapState(m.id))).then(
      (results) => {
        const systems: MapSystemOut[] = [];
        const connections: WormholeConnectionOut[] = [];
        for (const result of results) {
          if (result.status === "fulfilled") {
            systems.push(...result.value.systems);
            connections.push(...result.value.connections);
          }
        }
        setAggregated({ systems, connections });
      },
    );
    // Fetches once for the maps list this dialog was opened with - mirrors
    // the graph fetch above rather than re-fetching every map's state on
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mode]);

  const nodeIdByName = useMemo(
    () => new Map(graph?.nodes.map((n) => [n.name, n.id]) ?? []),
    [graph],
  );

  const usedEdges = useMemo(
    () =>
      props.mode === "route"
        ? usedEdgeKeys(props.route, nodeIdByName)
        : new Set<string>(),
    [props, nodeIdByName],
  );

  // touched: flat regions to ring-highlight. touchedLandmarkIds/wormholeLinks:
  // the landmark side of that plus every wormhole/ansiblex-derived dashed
  // link - map/all-maps mode derives all three from the map(s)' own
  // WormholeConnections, route mode from the route's own non-stargate legs
  // (its stargate legs get usedEdges' solid highlight on the static edge
  // instead - see routeWormholeTouchesAndLinks).
  const { touched, touchedLandmarkIds, wormholeLinks } = useMemo(() => {
    const empty = {
      touched: new Set<string>(),
      touchedLandmarkIds: new Set<number>(),
      wormholeLinks: [] as WormholeLink[],
    };
    if (!graph) {
      return empty;
    }
    if (props.mode === "map") {
      const { touchedLandmarkIds, links } = mapWormholeTouchesAndLinks(
        props.systems,
        props.connections,
        graph.landmarks,
        nodeIdByName,
      );
      return {
        touched: touchedRegionNames(props.systems, props.connections),
        touchedLandmarkIds,
        wormholeLinks: links,
      };
    }
    if (props.mode === "all-maps" && aggregated) {
      const { touchedLandmarkIds, links } = mapWormholeTouchesAndLinks(
        aggregated.systems,
        aggregated.connections,
        graph.landmarks,
        nodeIdByName,
      );
      return {
        touched: touchedRegionNames(aggregated.systems, aggregated.connections),
        touchedLandmarkIds,
        wormholeLinks: links,
      };
    }
    if (props.mode === "route") {
      const {
        touchedLandmarkIds,
        touchedRegionNames: touched,
        links,
      } = routeWormholeTouchesAndLinks(
        props.route,
        graph.landmarks,
        nodeIdByName,
      );
      return { touched, touchedLandmarkIds, wormholeLinks: links };
    }
    return empty;
  }, [props, graph, nodeIdByName, aggregated]);

  // In mode "all-maps", the region graph can be ready well before every
  // map's state has come back - wait for both before rendering the canvas,
  // otherwise touched/landmark state would flicker in as each map arrives.
  const dataReady =
    graph !== null && (props.mode !== "all-maps" || aggregated !== null);

  const touchedByLabel =
    props.mode === "all-maps"
      ? "in any of your maps"
      : props.mode === "route"
        ? "by this route"
        : "in this map";

  const hopLabelsByNodeId = useMemo(() => {
    if (props.mode !== "route" || !graph) {
      return new Map<string, string>();
    }
    const hopsByNodeId = routeHopNumbersByNodeId(
      props.route,
      graph.landmarks,
      nodeIdByName,
    );
    return new Map(
      [...hopsByNodeId].map(([nodeId, hops]) => [
        nodeId,
        collapseHopNumbers(hops),
      ]),
    );
  }, [props, graph, nodeIdByName]);

  const compressedPositions = useMemo(
    () => compressPositions(graph?.nodes ?? []),
    [graph],
  );

  const landmarkPositions = useMemo(
    () =>
      landmarkColumnPositions(graph?.landmarks ?? [], [
        ...compressedPositions.values(),
      ]),
    [graph, compressedPositions],
  );

  const nodes = useMemo<Node[]>(() => {
    const regionNodes: Node[] =
      graph?.nodes.map((n) => ({
        id: String(n.id),
        type: "region",
        position: compressedPositions.get(n.id) ?? { x: n.x, y: n.y },
        data: {
          name: n.name,
          touched: touched.has(n.name),
          // Overridden in displayNodes once the edge-click case (which
          // needs highlightedNodeIds, computed after this memo) is known.
          selected: false,
          hopLabel: hopLabelsByNodeId.get(String(n.id)),
        },
      })) ?? [];
    const landmarkNodes: Node[] =
      graph?.landmarks.map((l) => ({
        id: `landmark-${l.id}`,
        type: "landmark",
        position: landmarkPositions.get(l.id) ?? { x: 0, y: 0 },
        data: {
          name: l.name,
          kind: l.kind,
          touched: touchedLandmarkIds.has(l.id),
          selected: false,
          hopLabel: hopLabelsByNodeId.get(`landmark-${l.id}`),
        },
      })) ?? [];
    return [...regionNodes, ...landmarkNodes];
  }, [
    graph,
    touched,
    compressedPositions,
    landmarkPositions,
    touchedLandmarkIds,
    hopLabelsByNodeId,
  ]);

  const edges = useMemo<Edge[]>(() => {
    const regionEdges: Edge[] =
      graph?.edges.map((e) => {
        const [a, b] = [e.source, e.target].sort((x, y) => x - y);
        const used = usedEdges.has(`${a}-${b}`);
        return {
          id: `${e.source}-${e.target}`,
          source: String(e.source),
          target: String(e.target),
          type: "straight",
          style: {
            stroke: used ? "var(--accent-bright)" : "var(--border)",
            strokeWidth: used ? 3 : 1,
          },
        };
      }) ?? [];
    const wormholeEdges: Edge[] = wormholeLinks.map((link) => ({
      id: `wh-${link.sourceNodeId}-${link.targetNodeId}`,
      source: link.sourceNodeId,
      target: link.targetNodeId,
      // Bezier ("default"), not "straight" like the static Stargate
      // backbone - reads as a distinct, more dynamic kind of link (matches
      // this map's own wormhole connections, drawn as curves too).
      type: "default",
      style: {
        stroke: "var(--accent)",
        strokeWidth: 2,
        strokeDasharray: "6 4",
      },
    }));
    return [...regionEdges, ...wormholeEdges];
  }, [graph, usedEdges, wormholeLinks]);

  // A selected node spotlights its ego-network: itself, every node directly
  // linked to it (an edge's start/end), and those edges. A selected edge
  // spotlights just that edge and its own two endpoints. Either way,
  // everything else fades via opacity rather than being removed, so the
  // overall layout doesn't jump around.
  const { highlightedNodeIds, highlightedEdgeIds } = useMemo(() => {
    if (selectedNodeId) {
      const nodeIds = new Set<string>([selectedNodeId]);
      const edgeIds = new Set<string>();
      for (const edge of edges) {
        if (edge.source === selectedNodeId || edge.target === selectedNodeId) {
          edgeIds.add(edge.id);
          nodeIds.add(edge.source);
          nodeIds.add(edge.target);
        }
      }
      return { highlightedNodeIds: nodeIds, highlightedEdgeIds: edgeIds };
    }
    if (selectedEdgeId) {
      const edge = edges.find((e) => e.id === selectedEdgeId);
      if (edge) {
        return {
          highlightedNodeIds: new Set([edge.source, edge.target]),
          highlightedEdgeIds: new Set([edge.id]),
        };
      }
    }
    return { highlightedNodeIds: null, highlightedEdgeIds: null };
  }, [selectedNodeId, selectedEdgeId, edges]);

  const displayNodes = useMemo<Node[]>(
    () =>
      nodes.map((node) => {
        // The exact node clicked gets the glow; an edge click has no single
        // "clicked" node, so both its start/end endpoints get it instead.
        const selected =
          node.id === selectedNodeId ||
          (selectedEdgeId !== null &&
            (highlightedNodeIds?.has(node.id) ?? false));
        return {
          ...node,
          data: { ...node.data, selected },
          style: {
            ...node.style,
            opacity:
              highlightedNodeIds && !highlightedNodeIds.has(node.id) ? 0.15 : 1,
          },
        };
      }),
    [nodes, highlightedNodeIds, selectedNodeId, selectedEdgeId],
  );

  const displayEdges = useMemo<Edge[]>(
    () =>
      edges.map((edge) => ({
        ...edge,
        style: {
          ...edge.style,
          opacity:
            highlightedEdgeIds && !highlightedEdgeIds.has(edge.id) ? 0.1 : 1,
        },
      })),
    [edges, highlightedEdgeIds],
  );

  return (
    <Dialog title="Universe — Regions" onClose={onClose} size="large">
      {error && <p className="error">{error}</p>}

      {!error && !dataReady && <LoadingState label="Loading region graph…" />}

      {dataReady && (
        <div className="universe-regions-canvas">
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            colorMode="dark"
            fitView
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_event, node) => {
              setSelectedEdgeId(null);
              setSelectedNodeId((current) =>
                current === node.id ? null : node.id,
              );
            }}
            onEdgeClick={(_event, edge) => {
              setSelectedNodeId(null);
              setSelectedEdgeId((current) =>
                current === edge.id ? null : edge.id,
              );
            }}
            onPaneClick={() => {
              setSelectedNodeId(null);
              setSelectedEdgeId(null);
            }}
          >
            <Background />
            <Controls showInteractive={false} />
            {props.mode === "route" &&
              props.route &&
              usedEdges.size === 0 &&
              wormholeLinks.length === 0 &&
              touchedLandmarkIds.size === 0 && (
                <Panel position="top-center">
                  <div className="universe-no-highlight-hint">
                    This route never crosses a real-space region boundary -
                    every leg stays within one region.
                  </div>
                </Panel>
              )}
            <Panel position="bottom-center">
              <div className="universe-legend" ref={legendRef}>
                <button
                  type="button"
                  onClick={() => setLegendOpen((current) => !current)}
                >
                  Legend
                </button>
                {legendOpen && (
                  <div className="universe-legend-popover">
                    <div className="universe-legend-section">
                      <h5>Nodes</h5>
                      <ul>
                        <li>
                          <span className="universe-region-node-dot" />
                          Region
                        </li>
                        <li>
                          <span className="universe-region-node-dot universe-region-node-dot-touched" />
                          Reached {touchedByLabel}
                        </li>
                        <li>
                          <span className="universe-landmark-node-dot" />
                          Thera / Drifter region / Pochven
                        </li>
                        <li>
                          <span className="universe-landmark-node-dot universe-landmark-node-dot-touched" />
                          Touched {touchedByLabel}
                        </li>
                      </ul>
                    </div>

                    <div className="universe-legend-section">
                      <h5>Edges</h5>
                      <ul>
                        <li>
                          <span
                            className="legend-line"
                            style={{ borderColor: "var(--border)" }}
                          />
                          Cross-region stargate link
                        </li>
                        {props.mode === "route" && (
                          <li>
                            <span
                              className="legend-line"
                              style={{
                                borderColor: "var(--accent-bright)",
                                borderTopWidth: 3,
                              }}
                            />
                            Stargate leg used by this route
                          </li>
                        )}
                        <li>
                          <span
                            className="legend-line legend-line-dashed"
                            style={{ borderColor: "var(--accent)" }}
                          />
                          {props.mode === "route"
                            ? "Wormhole/ansiblex leg used by this route"
                            : "Region-to-region wormhole link (incl. Thera/a Drifter region/Pochven)"}
                        </li>
                      </ul>
                      {props.mode === "route" && !props.route && (
                        <p className="universe-legend-hint">
                          Find a route to see which edges it crosses.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Panel>
          </ReactFlow>
        </div>
      )}
    </Dialog>
  );
}
