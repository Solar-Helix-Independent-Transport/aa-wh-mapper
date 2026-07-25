import { useCallback, useMemo } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { MapSystemOut, RouteDetail } from "../api/types";
import {
  routeLegEdgeStyle,
  routeLegLabel,
  routeLegOrientedSignatures,
} from "../lib/routeLegStyle";
import { FloatingEdge } from "./FloatingEdge";
import { MapLegend } from "./MapLegend";
import {
  SelectedSystemProvider,
  SystemNode,
  type SystemNodeData,
} from "./SystemNode";

const NODE_SPACING_X = 260;
const NODE_SPACING_Y = 160;
const GRID_WIDTH = 3;

// Snakes left-to-right, then right-to-left on the next row, and so on
// (boustrophedon) - keeps consecutive systems adjacent instead of jumping
// back across the grid at each row break, which a plain row-major wrap
// would do.
function snakePosition(index: number): { x: number; y: number } {
  const row = Math.floor(index / GRID_WIDTH);
  const colInRow = index % GRID_WIDTH;
  const col = row % 2 === 0 ? colInRow : GRID_WIDTH - 1 - colInRow;
  return { x: col * NODE_SPACING_X, y: row * NODE_SPACING_Y };
}

type RouteNodeData = SystemNodeData & {
  routeIndex: number;
};

// SystemNode plus a numbered badge (1-indexed hop order) - lets a node in
// the diagram be matched back to its row in RouteItinerary at a glance,
// which the plain map has no need for (its own systems aren't an ordered
// sequence) - a wrapper here rather than changing SystemNode itself.
function RouteSystemNode(props: NodeProps & { data: RouteNodeData }) {
  return (
    <div className="route-node-wrapper">
      <span className="route-node-index">{props.data.routeIndex}</span>
      <SystemNode {...props} />
    </div>
  );
}

const nodeTypes = { system: RouteSystemNode };
const edgeTypes = { floating: FloatingEdge };

/** The route's node-chain diagram - reuses the same SystemNode/FloatingEdge
 * visuals as the per-map chain canvas (MapCanvas), per the wayfinder map's
 * ticket 06, so a route reads as the same visual language as the rest of
 * the app. Layout is an ordered snake grid (6 columns wide, index order),
 * not real-space positioned - the backend's RouteDetail carries no
 * position data (see ticket 07), so the frontend owns layout here. */
interface Props {
  route: RouteDetail;
  selectedSystemId: number | null;
  onSelectSystem: (systemId: number | null) => void;
}

export function RouteDiagram({
  route,
  selectedSystemId,
  onSelectSystem,
}: Props) {
  const nodes = useMemo<Node<RouteNodeData>[]>(
    () =>
      route.systems.map((system, index) => {
        const position = snakePosition(index);
        const fakeMapSystem: MapSystemOut = {
          id: system.id,
          map_id: 0,
          solar_system: system,
          label: "",
          x: position.x,
          y: position.y,
          pinned: false,
          added_by_id: null,
          added_at: "",
        };
        return {
          id: String(system.id),
          type: "system",
          position,
          data: {
            system: fakeMapSystem,
            signatureCount: 0,
            characters: [],
            routeIndex: index + 1,
          },
        };
      }),
    [route.systems],
  );

  const edges = useMemo<Edge[]>(
    () =>
      route.legs.map((leg, index) => {
        const sourceId = route.systems[index].id;
        const oriented = routeLegOrientedSignatures(leg, sourceId);

        return {
          id: `leg-${index}`,
          source: String(sourceId),
          target: String(route.systems[index + 1].id),
          type: "floating" as const,
          data: {
            label: routeLegLabel(leg),
            critical: leg.life_status === "lt_1h",
            sourceSignatureId: oriented.source?.signature_id,
            targetSignatureId: oriented.target?.signature_id,
          },
          style: routeLegEdgeStyle(leg),
        };
      }),
    [route.legs, route.systems],
  );

  const handleNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => onSelectSystem(Number(node.id)),
    [onSelectSystem],
  );

  const handlePaneClick = useCallback(
    () => onSelectSystem(null),
    [onSelectSystem],
  );

  return (
    <div className="route-diagram">
      <SelectedSystemProvider selectedSystemId={selectedSystemId}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          colorMode="dark"
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
          <MapLegend />
        </ReactFlow>
      </SelectedSystemProvider>
    </div>
  );
}
