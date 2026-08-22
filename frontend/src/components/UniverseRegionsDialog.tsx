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
  RegionGraphOut,
  RouteDetail,
  WormholeConnectionOut,
} from "../api/types";
import { Dialog } from "./Dialog";
import { LoadingState } from "./LoadingState";
import {
  collapseHopNumbers,
  compressPositions,
  landmarkColumnPositions,
  mapWormholeTouchesAndLinks,
  routeHopNumbersByNodeId,
  routeWormholeTouchesAndLinks,
  touchedRegionNames,
  usedEdgeKeys,
  type WormholeLink,
} from "./universeGraphHelpers";

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
                          Thera / Drifter region / Turnur
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
                            : "Region-to-region wormhole link (incl. Thera/a Drifter region/Turnur)"}
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
