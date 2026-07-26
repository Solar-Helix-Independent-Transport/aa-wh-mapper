import { useCallback, useMemo, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  MapSystemOut,
  RouteDetail,
  RouteLegOut,
  SignatureOut,
  SolarSystemOut,
} from "../api/types";
import {
  routeLegEdgeStyle,
  routeLegLabel,
  routeLegOrientedSignatures,
} from "../lib/routeLegStyle";
import { ConnectionDetailsDialog } from "./ConnectionDetailsDialog";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { FloatingEdge } from "./FloatingEdge";
import { MapLegend } from "./MapLegend";
import { RouteSystemDetailsDialog } from "./RouteSystemDetailsDialog";
import {
  SelectedSystemProvider,
  SystemNode,
  type SystemNodeData,
} from "./SystemNode";

const NODE_SPACING_X = 260;
const NODE_SPACING_Y = NODE_SPACING_X / 2;
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
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);
  const [detailsLeg, setDetailsLeg] = useState<{
    leg: RouteLegOut;
    topSystemName: string;
    bottomSystemName: string;
  } | null>(null);
  const [detailsSystem, setDetailsSystem] = useState<{
    system: SolarSystemOut;
    adjacentLegs: { leg: RouteLegOut; otherSystemName: string }[];
  } | null>(null);

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

  // Read-only "Details" only - unlike MapCanvas's edge menu, this never
  // offers the mutating Type/Mass/Life/Ship-size submenus. Those call
  // updateConnection/removeConnection directly with no fallback, but a
  // route leg's underlying map isn't necessarily one the viewer can edit
  // (or even see - a shared Route can show a leg from a map the viewer
  // has no access to, see wh_mapper.models.Route's docstring); mutating
  // that safely already goes through RouteLegRow's flag-or-direct-edit
  // logic in the sidebar instead. Details itself is read-only and simply
  // shows an error in the dialog if the viewer turns out not to have
  // access to the underlying map.
  const handleEdgeContextMenu = useCallback<EdgeMouseHandler>(
    (event, edge) => {
      event.preventDefault();

      const index = Number(edge.id.replace("leg-", ""));
      const leg = route.legs[index];
      if (!leg || leg.connection_type === "stargate" || !leg.connection) {
        return;
      }

      // route.systems[index]/[index + 1] are the route's traversal order
      // (source -> target), which doesn't necessarily match the
      // connection's own top/bottom (an internal pairing fixed once at
      // creation, independent of which direction any given route happens
      // to cross it - see routeLegOrientedSignatures for the same
      // reorientation, done there for signatures instead of names).
      // ConnectionDetailsDialog pairs top_signature with topSystemName, so
      // these have to resolve by matching the connection's own ids, not by
      // assuming traversal order lines up with them.
      const [nodeA, nodeB] = [route.systems[index], route.systems[index + 1]];
      const topSystemName =
        nodeA.id === leg.connection.top_system_solar_system_id
          ? nodeA.name
          : nodeB.name;
      const bottomSystemName =
        nodeA.id === leg.connection.bottom_system_solar_system_id
          ? nodeA.name
          : nodeB.name;

      const items: ContextMenuItem[] = [
        {
          kind: "action",
          label: "Details",
          onClick: () =>
            setDetailsLeg({
              leg,
              topSystemName,
              bottomSystemName,
            }),
        },
      ];
      setMenu({ x: event.clientX, y: event.clientY, items });
    },
    [route.legs, route.systems],
  );

  const handleNodeContextMenu = useCallback<NodeMouseHandler>(
    (event, node) => {
      event.preventDefault();

      const index = route.systems.findIndex((s) => String(s.id) === node.id);
      if (index === -1) {
        return;
      }
      const system = route.systems[index];

      // At most two: the hop this route arrived by, and the hop it leaves
      // by - a route is a linear chain, not a general graph, so a system
      // never has more than these two adjacent legs *within this route*
      // (it may have others on the underlying map, which don't apply here).
      const adjacentLegs: { leg: RouteLegOut; otherSystemName: string }[] = [];
      const prevLeg = route.legs[index - 1];
      if (prevLeg) {
        adjacentLegs.push({
          leg: prevLeg,
          otherSystemName: route.systems[index - 1].name,
        });
      }
      const nextLeg = route.legs[index];
      if (nextLeg) {
        adjacentLegs.push({
          leg: nextLeg,
          otherSystemName: route.systems[index + 1].name,
        });
      }

      const items: ContextMenuItem[] = [
        {
          kind: "action",
          label: "Details",
          onClick: () => setDetailsSystem({ system, adjacentLegs }),
        },
      ];
      setMenu({ x: event.clientX, y: event.clientY, items });
    },
    [route.systems, route.legs],
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
          onNodeContextMenu={handleNodeContextMenu}
          onEdgeContextMenu={handleEdgeContextMenu}
          colorMode="dark"
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
          <MapLegend />
        </ReactFlow>
      </SelectedSystemProvider>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}
      {detailsLeg &&
        detailsLeg.leg.connection &&
        detailsLeg.leg.map_id !== null && (
          <ConnectionDetailsDialog
            mapId={detailsLeg.leg.map_id}
            connection={detailsLeg.leg.connection}
            topSystemName={detailsLeg.topSystemName}
            bottomSystemName={detailsLeg.bottomSystemName}
            signatures={[
              detailsLeg.leg.connection.top_signature,
              detailsLeg.leg.connection.bottom_signature,
            ].filter((s): s is SignatureOut => s != null)}
            onClose={() => setDetailsLeg(null)}
          />
        )}
      {detailsSystem && (
        <RouteSystemDetailsDialog
          system={detailsSystem.system}
          adjacentLegs={detailsSystem.adjacentLegs}
          onClose={() => setDetailsSystem(null)}
        />
      )}
    </div>
  );
}
