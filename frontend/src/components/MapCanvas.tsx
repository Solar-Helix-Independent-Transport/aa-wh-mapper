import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  ReactFlow,
  useReactFlow,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeMouseHandler,
  type OnBeforeDelete,
  type OnConnect,
  type OnEdgesChange,
  type OnEdgesDelete,
  type OnNodeDrag,
  type OnNodesChange,
  type OnNodesDelete,
  type SelectionDragHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { MapStateOut } from "../api/types";
import {
  FIXED_CONNECTION_STYLE,
  LIFE_STATUS_CHECK_INTERVAL_MS,
  LIFE_STATUS_LABEL,
  LIFE_STATUSES,
  MASS_STATUSES,
  SHIP_SIZE_LABEL,
  SHIP_SIZE_LIMITS,
  SNAP_GRID,
  TIME_STATUS_COLOR,
} from "../constants";
import { useNow } from "../hooks/useNow";
import {
  SelectedSystemProvider,
  SystemNode,
  type SystemNodeData,
} from "./SystemNode";
import { FloatingEdge } from "./FloatingEdge";
import { FloatingConnectionLine } from "./FloatingConnectionLine";
import { MapLegend } from "./MapLegend";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import {
  connectionWormholeType,
  effectiveLifeStatus,
  shipSizeForJumpMass,
} from "./wormholeClass";
import {
  addConnection,
  removeConnection,
  removeSystem,
  updateConnection,
  updateSystem,
} from "../api/maps";

const nodeTypes = { system: SystemNode };
const edgeTypes = { floating: FloatingEdge };

// Manually settable connection types for the right-click menu - stargate
// connections are derived from known k-space adjacency, not something a
// player assigns by hand, so only these two show up there (the signature
// panel's plain <select> still lists all three as a fallback).
const CONNECTION_TYPE_MENU_OPTIONS: {
  value: "wormhole" | "ansiblex";
  label: string;
}[] = [
  { value: "wormhole", label: "Wormhole" },
  { value: "ansiblex", label: "Jump bridge" },
];

interface Props {
  mapId: number;
  state: MapStateOut;
  selectedSystemId: number | null;
  onSelectSystem: (systemId: number | null) => void;
  onAddSystemAt: (position: { x: number; y: number }) => void;
  // Called whenever a mutation the canvas fired optimistically (move/pin/
  // delete a system, add/edit/remove a connection) fails server-side - the
  // parent surfaces the message and resyncs from the server, since the
  // optimistic UI change already applied here has nothing else to undo it.
  onMutationError: (message: string) => void;
}

export function MapCanvas({
  mapId,
  state,
  selectedSystemId,
  onSelectSystem,
  onAddSystemAt,
  onMutationError,
}: Props) {
  const { screenToFlowPosition } = useReactFlow();
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);
  const now = useNow(LIFE_STATUS_CHECK_INTERVAL_MS);

  // Deliberately excludes selectedSystemId - which system is panel-selected
  // is read via SelectedSystemProvider's context instead (see SystemNode),
  // so clicking between systems doesn't hand every *other* system's data
  // object a new reference (and force every SystemNode to re-render) just
  // because one system's selection state changed.
  const computedNodes: Node<SystemNodeData>[] = useMemo(
    () =>
      state.systems.map((system) => ({
        id: String(system.id),
        type: "system",
        position: { x: system.x, y: system.y },
        data: {
          system,
          signatureCount: state.signatures.filter(
            (s) => s.map_system_id === system.id,
          ).length,
          // The server already only sends currently-online tracked
          // characters here (see get_map_state), so no client-side
          // staleness check is needed - just match on current system.
          characters: state.tracked_characters
            .filter((tc) => tc.last_solar_system?.id === system.solar_system.id)
            .map((tc) => ({
              name: tc.character_name,
              isOwn: tc.added_by_id === state.current_user_id,
            })),
        },
      })),
    [
      state.systems,
      state.signatures,
      state.tracked_characters,
      state.current_user_id,
    ],
  );

  // xyflow needs to own `selected` (for box-select/ctrl-click
  // multi-selection, used for bulk delete) between renders - a fully
  // server-derived `nodes` array recomputed fresh every time would
  // otherwise silently drop an in-progress multi-selection the moment any
  // unrelated state changes (e.g. a character moving). Position is
  // different: it should track the server's value (so other users' drags
  // show up live) *except* while this client is actively dragging a node,
  // or has a drag-stop PATCH for it in flight but not yet confirmed -
  // otherwise a fresh `computedNodes` recompute mid-drag or before the
  // PATCH resolves would fight the drag or snap back to a stale position.
  // pendingMoveIdsRef tracks that in-flight window; see persistNodePositions.
  const pendingMoveIdsRef = useRef<Set<string>>(new Set());
  const [nodes, setNodes] = useState<Node<SystemNodeData>[]>(computedNodes);
  const [prevComputedNodes, setPrevComputedNodes] = useState(computedNodes);

  if (computedNodes !== prevComputedNodes) {
    setPrevComputedNodes(computedNodes);
    setNodes((current) => {
      const currentById = new Map(current.map((node) => [node.id, node]));
      return computedNodes.map((node) => {
        const existing = currentById.get(node.id);
        if (!existing) {
          return node;
        }
        const keepLocalPosition =
          existing.dragging || pendingMoveIdsRef.current.has(node.id);
        return {
          ...node,
          position: keepLocalPosition ? existing.position : node.position,
          selected: existing.selected,
        };
      });
    });
  }

  const handleNodesChange = useCallback<OnNodesChange<Node<SystemNodeData>>>(
    (changes) => setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );

  // Split from computedEdges below so the O(connections x signatures)
  // signature lookups only re-run when connections/signatures actually
  // change, not on every LIFE_STATUS_CHECK_INTERVAL_MS clock tick - only
  // `critical` (computed from `now`) needs to recompute that often.
  const baseEdges = useMemo(() => {
    // Multiple wormholes can connect the same pair of systems - group by
    // unordered pair so FloatingEdge can fan overlapping edges apart
    // instead of rendering them on top of each other (a lone edge between
    // a pair gets parallelCount 1, i.e. no offset).
    const pairCounts = new Map<string, number>();
    for (const connection of state.connections) {
      const key = [connection.top_system_id, connection.bottom_system_id]
        .sort((a, b) => a - b)
        .join("-");
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }
    const pairIndices = new Map<string, number>();

    return state.connections.map((connection) => {
      const pairKey = [connection.top_system_id, connection.bottom_system_id]
        .sort((a, b) => a - b)
        .join("-");
      const parallelIndex = pairIndices.get(pairKey) ?? 0;
      pairIndices.set(pairKey, parallelIndex + 1);
      const parallelCount = pairCounts.get(pairKey) ?? 1;

      const topSignature = state.signatures.find(
        (s) => s.id === connection.top_signature_id,
      );
      const bottomSignature = state.signatures.find(
        (s) => s.id === connection.bottom_signature_id,
      );
      // Once either end's signature has an identified wormhole type, its
      // max jump mass tells us the ship size definitively - that computed
      // value takes priority over the connection's manually-set
      // ship_size_limit, which only exists as a fallback for the period
      // before the type is known.
      const wormholeType = connectionWormholeType(connection, state.signatures);
      const shipSize =
        (wormholeType && shipSizeForJumpMass(wormholeType.max_jump_mass)) ??
        connection.ship_size_limit;

      return {
        id: String(connection.id),
        source: String(connection.top_system_id),
        target: String(connection.bottom_system_id),
        type: "floating" as const,
        label: SHIP_SIZE_LABEL[shipSize],
        // The source/target ends of the xyflow edge line up with
        // top/bottom respectively (see source/target above), so these
        // render at the end of the line nearest each signature's own
        // system.
        sourceSignatureId: topSignature?.signature_id,
        targetSignatureId: bottomSignature?.signature_id,
        parallelIndex,
        parallelCount,
        wormholeType,
        lifeStatus: connection.life_status,
        lifeStatusMarkedAt: connection.life_status_marked_at,
        createdAt: connection.created_at,
        style: FIXED_CONNECTION_STYLE[connection.connection_type] ?? {
          stroke:
            TIME_STATUS_COLOR[connection.time_status] ??
            TIME_STATUS_COLOR.unknown,
          strokeWidth: 2,
          // Dashing is mass-based (nearly depleted), not time-based -
          // color already carries the time/life-left signal above, so
          // this is a second, independent axis rather than doubling up
          // on the same one.
          strokeDasharray:
            connection.mass_status === "critical" ? "6 4" : undefined,
        },
      };
    });
  }, [state.connections, state.signatures]);

  const computedEdges: Edge[] = useMemo(
    () =>
      baseEdges.map((edge) => {
        const status = effectiveLifeStatus(
          edge.lifeStatus,
          edge.lifeStatusMarkedAt,
          edge.wormholeType,
          edge.createdAt,
          now,
        );

        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: edge.type,
          data: {
            label: edge.label,
            sourceSignatureId: edge.sourceSignatureId,
            targetSignatureId: edge.targetSignatureId,
            parallelIndex: edge.parallelIndex,
            parallelCount: edge.parallelCount,
            critical: status === "lt_1h",
          },
          style: edge.style,
        };
      }),
    [baseEdges, now],
  );

  // Same rationale as nodes above: without locally-owned state, an edge's
  // `selected` flag (set by xyflow on click/box-select) would be discarded
  // every time computedEdges gets a new reference - which happens at least
  // every LIFE_STATUS_CHECK_INTERVAL_MS tick regardless of any real change -
  // silently clearing a multi-selection moments after making it.
  const [edges, setEdges] = useState<Edge[]>(computedEdges);
  const [prevComputedEdges, setPrevComputedEdges] = useState(computedEdges);

  if (computedEdges !== prevComputedEdges) {
    setPrevComputedEdges(computedEdges);
    setEdges((current) => {
      const currentById = new Map(current.map((edge) => [edge.id, edge]));
      return computedEdges.map((edge) => {
        const existing = currentById.get(edge.id);
        return existing ? { ...edge, selected: existing.selected } : edge;
      });
    });
  }

  const handleEdgesChange = useCallback<OnEdgesChange>(
    (changes) => setEdges((current) => applyEdgeChanges(changes, current)),
    [],
  );

  // Persists every node that actually moved - dragging a multi-selection
  // moves every selected node together, but only fires one drag-stop event,
  // not one per node, so the full list (xyflow's third callback arg / the
  // whole selection) has to be handled here rather than just the single
  // node passed as the second arg.
  const persistNodePositions = useCallback(
    (movedNodes: Node<SystemNodeData>[]) => {
      for (const node of movedNodes) {
        // The local/server merge above keeps a node's local position while
        // it's in pendingMoveIdsRef (that's what makes dragging feel smooth
        // and avoids a snap-back before the PATCH round-trips), so a failed
        // PATCH here can't be fixed by just refreshing state - the stale
        // position has to be rolled back explicitly, to the last position
        // the server actually confirmed.
        const serverSystem = state.systems.find(
          (s) => s.id === Number(node.id),
        );
        const rollbackPosition = serverSystem
          ? { x: serverSystem.x, y: serverSystem.y }
          : node.position;

        pendingMoveIdsRef.current.add(node.id);
        updateSystem(mapId, Number(node.id), {
          x: node.position.x,
          y: node.position.y,
        })
          .then(() => {
            pendingMoveIdsRef.current.delete(node.id);
          })
          .catch((err) => {
            pendingMoveIdsRef.current.delete(node.id);
            setNodes((current) =>
              current.map((n) =>
                n.id === node.id ? { ...n, position: rollbackPosition } : n,
              ),
            );
            onMutationError(String(err));
          });
      }
    },
    [mapId, state.systems, onMutationError],
  );

  const handleNodeDragStop = useCallback<OnNodeDrag<Node<SystemNodeData>>>(
    (_event, _node, nodes) => persistNodePositions(nodes),
    [persistNodePositions],
  );

  // Dragging a multi-selection by grabbing xyflow's own selection-box
  // overlay (rather than one of the selected nodes directly) fires this
  // instead of onNodeDragStop - same split as onSelectionContextMenu vs.
  // onNodeContextMenu above.
  const handleSelectionDragStop = useCallback<
    SelectionDragHandler<Node<SystemNodeData>>
  >((_event, nodes) => persistNodePositions(nodes), [persistNodePositions]);

  const handleNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      setMenu(null);
      onSelectSystem(Number(node.id));
    },
    [onSelectSystem],
  );

  const handlePaneClick = useCallback(() => {
    setMenu(null);
    onSelectSystem(null);
  }, [onSelectSystem]);

  const handlePaneContextMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent) => {
      event.preventDefault();
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      setMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          {
            kind: "action",
            label: "Add system…",
            onClick: () => onAddSystemAt(position),
          },
        ],
      });
    },
    [screenToFlowPosition, onAddSystemAt],
  );

  // Deletes an arbitrary set of nodes/edges - shared by the "Delete N
  // selected" context-menu action below and (indirectly) by keyboard
  // delete, which goes through handleNodesDelete/handleEdgesDelete instead
  // since xyflow supplies its own already-filtered list there.
  const handleDeleteSelection = useCallback(
    (selectedNodes: Node<SystemNodeData>[], selectedEdges: Edge[]) => {
      // Pinned systems are locked against removal - see
      // wh_mapper.api.systems.remove_system.
      const deletableNodes = selectedNodes.filter((n) => !n.data.system.pinned);
      const deletedSystemIds = new Set(deletableNodes.map((n) => n.id));
      for (const node of deletableNodes) {
        const systemId = Number(node.id);
        removeSystem(mapId, systemId).catch((err) =>
          onMutationError(String(err)),
        );
        if (selectedSystemId === systemId) {
          onSelectSystem(null);
        }
      }
      for (const edge of selectedEdges) {
        // A connection whose system is also in this batch is cascade-
        // removed server-side by that system's delete (see
        // wh_mapper.api.systems.remove_system) - explicitly deleting it too
        // would just 404 against an already-gone row.
        if (
          deletedSystemIds.has(edge.source) ||
          deletedSystemIds.has(edge.target)
        ) {
          continue;
        }
        removeConnection(mapId, Number(edge.id)).catch((err) =>
          onMutationError(String(err)),
        );
      }
    },
    [mapId, selectedSystemId, onSelectSystem, onMutationError],
  );

  // Shared by handleNodeContextMenu/handleEdgeContextMenu/
  // handleSelectionContextMenu below - each right-click entry point needs
  // the same "what's currently selected" snapshot to decide whether to
  // offer the bulk "Delete N selected" action.
  const getSelection = useCallback(
    (selectedNodesOverride?: Node<SystemNodeData>[]) => {
      const selectedNodes =
        selectedNodesOverride ?? nodes.filter((n) => n.selected);
      const selectedEdges = edges.filter((e) => e.selected);
      return {
        selectedNodes,
        selectedEdges,
        selectionCount: selectedNodes.length + selectedEdges.length,
      };
    },
    [nodes, edges],
  );

  const handleNodeContextMenu = useCallback<NodeMouseHandler>(
    (event, node) => {
      event.preventDefault();

      // Right-clicking a node that's part of a larger box-select/ctrl-click
      // multi-selection offers to delete the whole selection instead of the
      // usual single-system menu - otherwise there was no way to bulk-delete
      // except the Backspace/Delete key, which isn't very discoverable.
      const { selectedNodes, selectedEdges, selectionCount } = getSelection();
      if (node.selected && selectionCount > 1) {
        setMenu({
          x: event.clientX,
          y: event.clientY,
          items: [
            {
              kind: "action",
              label: `Delete ${selectionCount} selected`,
              danger: true,
              onClick: () =>
                handleDeleteSelection(selectedNodes, selectedEdges),
            },
          ],
        });
        return;
      }

      const systemId = Number(node.id);
      const system = state.systems.find((s) => s.id === systemId);
      const pinned = system?.pinned ?? false;
      setMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          {
            kind: "action",
            label: pinned ? "Unlock system" : "Lock system (home base)",
            onClick: () => {
              updateSystem(mapId, systemId, { pinned: !pinned }).catch((err) =>
                onMutationError(String(err)),
              );
            },
          },
          {
            kind: "action",
            label: "Delete system",
            danger: true,
            // Pinned systems are locked against removal - see
            // wh_mapper.api.systems.remove_system - so disable this instead
            // of letting the request fail after the fact.
            disabled: pinned,
            onClick: () => {
              removeSystem(mapId, systemId).catch((err) =>
                onMutationError(String(err)),
              );
              if (selectedSystemId === systemId) {
                onSelectSystem(null);
              }
            },
          },
        ],
      });
    },
    [
      mapId,
      state.systems,
      selectedSystemId,
      onSelectSystem,
      getSelection,
      handleDeleteSelection,
      onMutationError,
    ],
  );

  const handleEdgeContextMenu = useCallback<EdgeMouseHandler>(
    (event, edge) => {
      event.preventDefault();

      // Same "delete the whole selection" shortcut as handleNodeContextMenu.
      const { selectedNodes, selectedEdges, selectionCount } = getSelection();
      if (edge.selected && selectionCount > 1) {
        setMenu({
          x: event.clientX,
          y: event.clientY,
          items: [
            {
              kind: "action",
              label: `Delete ${selectionCount} selected`,
              danger: true,
              onClick: () =>
                handleDeleteSelection(selectedNodes, selectedEdges),
            },
          ],
        });
        return;
      }

      const connection = state.connections.find(
        (c) => String(c.id) === edge.id,
      );
      if (!connection) {
        return;
      }
      const connectionId = connection.id;

      const items: ContextMenuItem[] = [
        {
          kind: "submenu",
          label: "Type",
          items: CONNECTION_TYPE_MENU_OPTIONS.map(({ value, label }) => ({
            kind: "action",
            label,
            disabled: connection.connection_type === value,
            onClick: () => {
              updateConnection(mapId, connectionId, {
                connection_type: value,
              }).catch((err) => onMutationError(String(err)));
            },
          })),
        },
      ];

      if (connection.connection_type === "wormhole") {
        items.push({
          kind: "submenu",
          label: "Mass status",
          items: MASS_STATUSES.map((status) => ({
            kind: "action",
            label: status,
            disabled: connection.mass_status === status,
            onClick: () =>
              updateConnection(mapId, connectionId, {
                mass_status: status,
              }).catch((err) => onMutationError(String(err))),
          })),
        });

        // Once the wormhole type is known, life status (from its real
        // max_stable_time) and ship size (from its max_jump_mass) are both
        // fully computed - manually setting either then would just be
        // redundant (or misleading, if it disagreed), so these submenus
        // only appear while the type is still unidentified.
        const wormholeType = connectionWormholeType(
          connection,
          state.signatures,
        );
        if (!wormholeType) {
          items.push(
            {
              kind: "submenu",
              label: "Life status",
              items: LIFE_STATUSES.map((status) => ({
                kind: "action",
                label: LIFE_STATUS_LABEL[status] ?? status,
                disabled: connection.life_status === status,
                onClick: () =>
                  updateConnection(mapId, connectionId, {
                    life_status: status,
                  }).catch((err) => onMutationError(String(err))),
              })),
            },
            {
              kind: "submenu",
              label: "Ship size",
              items: SHIP_SIZE_LIMITS.map((size) => ({
                kind: "action",
                label: SHIP_SIZE_LABEL[size]
                  ? `${SHIP_SIZE_LABEL[size]} - ${size}`
                  : size,
                disabled: connection.ship_size_limit === size,
                onClick: () =>
                  updateConnection(mapId, connectionId, {
                    ship_size_limit: size,
                  }).catch((err) => onMutationError(String(err))),
              })),
            },
          );
        }
      }

      items.push(
        { kind: "separator" },
        {
          kind: "action",
          label: "Detach",
          danger: true,
          onClick: () =>
            removeConnection(mapId, connectionId).catch((err) =>
              onMutationError(String(err)),
            ),
        },
      );

      setMenu({ x: event.clientX, y: event.clientY, items });
    },
    [
      mapId,
      state.connections,
      state.signatures,
      getSelection,
      handleDeleteSelection,
      onMutationError,
    ],
  );

  // Right-clicking a *box-selected* group of nodes lands on xyflow's own
  // "selection" overlay (rendered on top of the nodes so the whole group
  // can be dragged as one) rather than on any individual node/edge - so
  // handleNodeContextMenu/handleEdgeContextMenu's own multi-selection check
  // never even runs in that case. This is the dedicated prop for it.
  const handleSelectionContextMenu = useCallback(
    (
      event: ReactMouseEvent,
      selectedNodesFromEvent: Node<SystemNodeData>[],
    ) => {
      event.preventDefault();
      const { selectedNodes, selectedEdges, selectionCount } = getSelection(
        selectedNodesFromEvent,
      );
      setMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          {
            kind: "action",
            label: `Delete ${selectionCount} selected`,
            danger: true,
            onClick: () => handleDeleteSelection(selectedNodes, selectedEdges),
          },
        ],
      });
    },
    [getSelection, handleDeleteSelection],
  );

  const handleConnect = useCallback<OnConnect>(
    (connection) => {
      if (!connection.source || !connection.target) {
        return;
      }
      addConnection(mapId, {
        top_system_id: Number(connection.source),
        bottom_system_id: Number(connection.target),
      }).catch((err) => onMutationError(String(err)));
    },
    [mapId, onMutationError],
  );

  // Multi-select (box-select via Shift+drag, or ctrl/cmd-click) + Backspace/
  // Delete removes everything selected in one go. Pinned systems are locked
  // against removal (see wh_mapper.api.systems.remove_system) - filtering
  // them out here, before xyflow applies the change, keeps them from
  // visually vanishing only to get silently re-added on the next refresh.
  const handleBeforeDelete = useCallback<
    OnBeforeDelete<Node<SystemNodeData>, Edge>
  >(async ({ nodes: toDelete, edges: edgesToDelete }) => {
    const deletableNodes = toDelete.filter((node) => !node.data.system.pinned);
    if (deletableNodes.length === 0 && edgesToDelete.length === 0) {
      return false;
    }
    return { nodes: deletableNodes, edges: edgesToDelete };
  }, []);

  const handleNodesDelete = useCallback<OnNodesDelete<Node<SystemNodeData>>>(
    (deleted) => {
      for (const node of deleted) {
        const systemId = Number(node.id);
        removeSystem(mapId, systemId).catch((err) =>
          onMutationError(String(err)),
        );
        if (selectedSystemId === systemId) {
          onSelectSystem(null);
        }
      }
    },
    [mapId, selectedSystemId, onSelectSystem, onMutationError],
  );

  const handleEdgesDelete = useCallback<OnEdgesDelete>(
    (deleted) => {
      for (const edge of deleted) {
        removeConnection(mapId, Number(edge.id)).catch((err) =>
          onMutationError(String(err)),
        );
      }
    },
    [mapId, onMutationError],
  );

  return (
    <SelectedSystemProvider selectedSystemId={selectedSystemId}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionLineComponent={FloatingConnectionLine}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onNodeDragStop={handleNodeDragStop}
        onSelectionDragStop={handleSelectionDragStop}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onConnect={handleConnect}
        onPaneContextMenu={handlePaneContextMenu}
        onNodeContextMenu={handleNodeContextMenu}
        onEdgeContextMenu={handleEdgeContextMenu}
        onSelectionContextMenu={handleSelectionContextMenu}
        onBeforeDelete={handleBeforeDelete}
        onNodesDelete={handleNodesDelete}
        onEdgesDelete={handleEdgesDelete}
        deleteKeyCode={["Backspace", "Delete"]}
        snapToGrid
        snapGrid={SNAP_GRID}
        colorMode="dark"
        fitView
      >
        <Background color="#262a3a" gap={SNAP_GRID[0]} />
        <Controls />
        <MapLegend />
      </ReactFlow>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}
    </SelectedSystemProvider>
  );
}
