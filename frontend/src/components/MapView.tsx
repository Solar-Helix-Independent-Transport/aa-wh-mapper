import { useCallback, useEffect, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { autoLayoutSystems, getMapState } from "../api/maps";
import type {
  JumpNeedsSignaturePrompt,
  MapStateOut,
  MapSystemOut,
} from "../api/types";
import {
  SIGNATURE_PANEL_DEFAULT_WIDTH,
  SIGNATURE_PANEL_HIDDEN_STORAGE_KEY,
  SIGNATURE_PANEL_MAX_WIDTH,
  SIGNATURE_PANEL_MIN_WIDTH,
  SIGNATURE_PANEL_WIDTH_STORAGE_KEY,
} from "../constants";
import { useMapSocket } from "../hooks/useMapSocket";
import { useResizablePanel } from "../hooks/useResizablePanel";
import { AppHeader } from "./AppHeader";
import { ConnectionFlagsPanel } from "./ConnectionFlagsPanel";
import { ConnectionStatusBanner } from "./ConnectionStatusBanner";
import type { ContextMenuItem } from "./ContextMenu";
import { IdentifyJumpSignatureDialog } from "./IdentifyJumpSignatureDialog";
import { LoadingState } from "./LoadingState";
import { MapCanvas } from "./MapCanvas";
import { ResizableSidePanel } from "./ResizableSidePanel";
import { SignaturePanel } from "./SignaturePanel";
import { AddSystemDialog } from "./AddSystemDialog";
import { ImportFromMapDialog } from "./ImportFromMapDialog";
import { ImportRegionDialog } from "./ImportRegionDialog";
import { ShareDialog } from "./ShareDialog";
import { UniverseRegionsDialog } from "./UniverseRegionsDialog";
import { applyMapEvent } from "./mapEvents";
import { computeAutoLayout } from "./mapLayout";

interface Props {
  mapId: number;
}

export function MapView({ mapId }: Props) {
  const [state, setState] = useState<MapStateOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSystemId, setSelectedSystemId] = useState<number | null>(null);
  const [showAddSystem, setShowAddSystem] = useState(false);
  const [addSystemPosition, setAddSystemPosition] = useState<
    { x: number; y: number } | undefined
  >(undefined);
  const [showImportRegion, setShowImportRegion] = useState(false);
  const [showImportFromMap, setShowImportFromMap] = useState(false);
  const [showFlags, setShowFlags] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showUniverse, setShowUniverse] = useState(false);
  // A queue, not a single slot: several tracked characters (or the same one,
  // jumping several wormholes back to back) can each generate a prompt
  // before the viewer answers the first one - overwriting a single slot
  // would silently drop everything but the most recent jump.
  const [jumpQueue, setJumpQueue] = useState<JumpNeedsSignaturePrompt[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const {
    width: panelWidth,
    hidden: panelHidden,
    setHidden: setPanelHidden,
    handleResizeStart: handlePanelResizeStart,
  } = useResizablePanel({
    defaultWidth: SIGNATURE_PANEL_DEFAULT_WIDTH,
    minWidth: SIGNATURE_PANEL_MIN_WIDTH,
    maxWidth: SIGNATURE_PANEL_MAX_WIDTH,
    widthStorageKey: SIGNATURE_PANEL_WIDTH_STORAGE_KEY,
    hiddenStorageKey: SIGNATURE_PANEL_HIDDEN_STORAGE_KEY,
  });

  // Guards against refresh()'s GET racing a live delta: if a websocket event
  // arrives while a refresh is in flight, the fetched snapshot it eventually
  // resolves to might have been computed server-side just *before* that
  // event's mutation - overwriting state with it as-is would silently
  // revert an already-applied delta until the next broadcast. Buffering
  // events received mid-flight and replaying them on top of the snapshot
  // once it lands closes that gap - applyMapEvent's upsert/remove-by-id is
  // idempotent, so replaying one already reflected in the snapshot is a
  // harmless no-op.
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const pendingEventsRef = useRef<Parameters<typeof applyMapEvent>[1][]>([]);

  // Tracks whether the map has ever loaded successfully, so a refresh
  // failure after that point (a live-socket-triggered resync, or a mutation
  // error's own follow-up refresh - see handleMutationError) can be shown as
  // a dismissible toast over the still-visible map instead of blanking the
  // whole page the way a true first-load failure does. A ref rather than
  // deriving from `state` directly - `refresh` is memoized once per mapId,
  // so a plain closure over `state` would stay stuck on whatever it was the
  // first time `refresh` was created.
  const hasLoadedRef = useRef(false);

  const refresh = useCallback(() => {
    // A named function declaration (rather than calling the outer `refresh`
    // const itself) so the re-run-once-queued case below can recurse
    // without referencing `refresh` before its own assignment completes.
    function runRefresh() {
      if (refreshInFlightRef.current) {
        // Already fetching - once it lands, run another pass rather than
        // firing an overlapping request (which would need its own buffer).
        refreshQueuedRef.current = true;
        return;
      }
      refreshInFlightRef.current = true;
      pendingEventsRef.current = [];
      getMapState(mapId)
        .then((fetched) => {
          hasLoadedRef.current = true;
          setError(null);
          setState(pendingEventsRef.current.reduce(applyMapEvent, fetched));
        })
        .catch((err) => {
          if (hasLoadedRef.current) {
            setActionError(`Failed to refresh map: ${err}`);
          } else {
            setError(String(err));
          }
        })
        .finally(() => {
          refreshInFlightRef.current = false;
          pendingEventsRef.current = [];
          if (refreshQueuedRef.current) {
            refreshQueuedRef.current = false;
            runRefresh();
          }
        });
    }
    runRefresh();
  }, [mapId]);

  useEffect(refresh, [refresh]);

  const handleEvent = useCallback(
    (event: Parameters<typeof applyMapEvent>[1]) => {
      // A bulk change (e.g. importing a whole region) broadcasts one of
      // these instead of one event per row, to avoid flooding the channel
      // layer - just refetch the full state instead of trying to apply it
      // as a delta.
      if (event.event === "map.resync") {
        refresh();
        return;
      }
      if (event.event === "character.jump_needs_signature") {
        const prompt = event.data as JumpNeedsSignaturePrompt;
        setJumpQueue((current) =>
          current.some((p) => p.connection_id === prompt.connection_id)
            ? current
            : [...current, prompt],
        );
        return;
      }
      if (refreshInFlightRef.current) {
        pendingEventsRef.current.push(event);
      }
      setState((current) =>
        current ? applyMapEvent(current, event) : current,
      );
    },
    [refresh],
  );

  // Resync via the state endpoint whenever the socket (re)connects, since it
  // only carries deltas from the moment it opens.
  const socketStatus = useMapSocket(mapId, handleEvent, refresh);

  // A canvas mutation (move/pin/delete a system, add/edit/remove a
  // connection) already applied its change optimistically before the
  // request failed - there's nothing else to roll it back, so surface the
  // failure and pull the real state back from the server.
  const handleMutationError = useCallback(
    (message: string) => {
      setActionError(message);
      refresh();
    },
    [refresh],
  );

  // Optimistically merges a system created via ConnectSignatureDialog into
  // local state immediately, rather than waiting on the system.added
  // websocket round-trip - see that dialog's handleConnectNew for why.
  // Idempotent with the real broadcast once it arrives (applyMapEvent
  // upserts by id either way).
  const handleSystemCreated = useCallback((system: MapSystemOut) => {
    setState((current) =>
      current
        ? applyMapEvent(current, { event: "system.added", data: system })
        : current,
    );
  }, []);

  // Only blocks the whole page while there's genuinely nothing to show yet -
  // once a map has loaded once, a later refresh failure surfaces as a toast
  // over the still-visible map instead (see refresh's hasLoadedRef check).
  if (!state) {
    return (
      <>
        <AppHeader />
        {error ? (
          <p className="error">Failed to load map: {error}</p>
        ) : (
          <LoadingState label="Loading map…" />
        )}
      </>
    );
  }

  const dismissJumpPrompt = (connectionId: number) =>
    setJumpQueue((current) =>
      current.filter((p) => p.connection_id !== connectionId),
    );

  // Wormhole connections with no signature linked on either end - independent
  // of jumpQueue (which only holds prompts seen live over the socket this
  // session, and loses them on skip/refresh), so this stays accurate even
  // after a reload or a dismissed prompt.
  const pendingConnections = state.connections.filter(
    (c) =>
      c.connection_type === "wormhole" &&
      c.top_signature_id === null &&
      c.bottom_signature_id === null,
  );

  // Re-adds a prompt (with no character_name, since these weren't just seen
  // live) for any pending connection that isn't already queued - lets the
  // viewer get back to a connection they skipped, or one from before their
  // last refresh.
  const reopenPendingSignatures = () => {
    setJumpQueue((current) => {
      const queuedIds = new Set(current.map((p) => p.connection_id));
      const restored = pendingConnections
        .filter((c) => !queuedIds.has(c.id))
        .map((c) => ({
          connection_id: c.id,
          character_name: null,
          old_map_system_id: c.top_system_id,
          new_map_system_id: c.bottom_system_id,
        }));
      return restored.length > 0 ? [...current, ...restored] : current;
    });
  };

  // Computed client-side (MapCanvas/SystemNode's rendered dimensions are
  // only known here, not on the backend - see mapLayout.ts), then applied
  // in one bulk request so every other viewer gets a single map.resync
  // instead of a broadcast per moved system.
  const handleAutoLayout = async () => {
    const positions = computeAutoLayout(state.systems, state.connections);
    if (positions.length === 0) {
      return;
    }
    const pinnedCount = state.systems.length - positions.length;
    const confirmed = window.confirm(
      `Auto-arrange ${positions.length} system${positions.length === 1 ? "" : "s"}?` +
        (pinnedCount > 0
          ? ` ${pinnedCount} pinned system${pinnedCount === 1 ? "" : "s"} will stay put.`
          : ""),
    );
    if (!confirmed) {
      return;
    }
    try {
      await autoLayoutSystems(mapId, positions);
      refresh();
    } catch (err) {
      setActionError(`Failed to auto-arrange map: ${err}`);
    }
  };

  const openAddSystem = (position?: { x: number; y: number }) => {
    setAddSystemPosition(position);
    setShowAddSystem(true);
  };

  const closeAddSystem = () => {
    setShowAddSystem(false);
    setAddSystemPosition(undefined);
  };

  // Skip past any queued prompt whose connection already got a signature
  // linked some other way (someone else answered it, or linked it directly
  // from the signature panel) while it was waiting its turn.
  const activeJumpPrompt = jumpQueue.find((prompt) => {
    const connection = state.connections.find(
      (c) => c.id === prompt.connection_id,
    );
    return (
      connection &&
      connection.top_signature_id === null &&
      connection.bottom_signature_id === null
    );
  });

  // A read-only reference map (the eve-scout Thera/Turnur maps) - true for
  // everyone except an admin_access user, who still gets the normal
  // editable UI (see wh_mapper.models.Map.read_only's docstring). Every
  // edit affordance below is gated on this, mirroring the backend's own
  // require_writable_map gate on the endpoints those affordances call.
  const canWrite = state.map.can_write;

  // Flags/Import region/Import from reference map/Share/Pending signatures
  // used to sit inline in the toolbar alongside everything else - the thing
  // that actually made the old header impractical. These are all secondary/
  // lower-frequency next to "+ Add system", so they move into AppHeader's
  // overflow menu instead; Import region and Pending signatures only appear
  // in it at all once they're relevant (an empty map, or an unidentified
  // connection) - Flags stays available even on a read-only map (creating a
  // flag needs no edit access by design - see wh_mapper.api.flags), the
  // rest need canWrite.
  const overflowItems: ContextMenuItem[] = [
    { kind: "action", label: "Flags", onClick: () => setShowFlags(true) },
    ...(canWrite && state.systems.length === 0
      ? [
          {
            kind: "action" as const,
            label: "Import region",
            onClick: () => setShowImportRegion(true),
          },
        ]
      : []),
    ...(canWrite
      ? [
          {
            kind: "action" as const,
            label: "Import from reference map…",
            onClick: () => setShowImportFromMap(true),
          },
        ]
      : []),
    ...(canWrite && state.systems.length > 1
      ? [
          {
            kind: "action" as const,
            label: "Auto-arrange",
            onClick: handleAutoLayout,
          },
        ]
      : []),
    ...(canWrite
      ? [
          {
            kind: "action" as const,
            label: "Share",
            onClick: () => setShowShare(true),
          },
        ]
      : []),
    ...(canWrite && pendingConnections.length > 0
      ? [
          {
            kind: "action" as const,
            label: `Pending signatures (${pendingConnections.length})`,
            onClick: reopenPendingSignatures,
          },
        ]
      : []),
  ];

  return (
    <div className="map-view">
      <AppHeader
        title={state.map.name}
        actions={
          <>
            {canWrite && (
              <button type="button" onClick={() => openAddSystem()}>
                + Add system
              </button>
            )}
            <button type="button" onClick={() => setShowUniverse(true)}>
              Universe
            </button>
          </>
        }
        overflowItems={overflowItems}
        trackedCharacterCount={state.tracked_characters.length}
        socketStatus={socketStatus}
      />

      <div className="map-view-body">
        <ReactFlowProvider>
          <div className="map-canvas-wrapper">
            <MapCanvas
              mapId={mapId}
              state={state}
              selectedSystemId={selectedSystemId}
              onSelectSystem={setSelectedSystemId}
              onAddSystemAt={openAddSystem}
              onMutationError={handleMutationError}
              readOnly={!canWrite}
            />
            <ConnectionStatusBanner status={socketStatus} />
            {actionError && (
              <div className="action-error-toast" role="alert">
                <span>{actionError}</span>
                <button
                  type="button"
                  onClick={() => setActionError(null)}
                  aria-label="Dismiss error"
                >
                  ×
                </button>
              </div>
            )}
          </div>

          <ResizableSidePanel
            width={panelWidth}
            hidden={panelHidden}
            onShow={() => setPanelHidden(false)}
            onHide={() => setPanelHidden(true)}
            onResizeStart={handlePanelResizeStart}
            label="signature panel"
          >
            <SignaturePanel
              mapId={mapId}
              state={state}
              systemId={selectedSystemId}
              onClose={() => setSelectedSystemId(null)}
              onSelectSystem={setSelectedSystemId}
              onSystemCreated={handleSystemCreated}
              readOnly={!canWrite}
            />
          </ResizableSidePanel>
        </ReactFlowProvider>
      </div>

      {showAddSystem && (
        <AddSystemDialog
          mapId={mapId}
          existingSystems={state.systems}
          position={addSystemPosition}
          onClose={closeAddSystem}
          onAdded={refresh}
        />
      )}

      {showImportRegion && (
        <ImportRegionDialog
          mapId={mapId}
          onClose={() => setShowImportRegion(false)}
          onImported={refresh}
        />
      )}

      {showImportFromMap && (
        <ImportFromMapDialog
          mapId={mapId}
          onClose={() => setShowImportFromMap(false)}
          onImported={refresh}
        />
      )}

      {showShare && (
        <ShareDialog
          map={state.map}
          onClose={() => setShowShare(false)}
          onMapUpdated={refresh}
        />
      )}

      {showFlags && (
        <ConnectionFlagsPanel
          mapId={mapId}
          systems={state.systems}
          connections={state.connections}
          onClose={() => setShowFlags(false)}
          onChanged={refresh}
          readOnly={!canWrite}
        />
      )}

      {showUniverse && (
        <UniverseRegionsDialog
          mode="map"
          systems={state.systems}
          connections={state.connections}
          onClose={() => setShowUniverse(false)}
        />
      )}

      {activeJumpPrompt && (
        <IdentifyJumpSignatureDialog
          key={activeJumpPrompt.connection_id}
          mapId={mapId}
          state={state}
          prompt={activeJumpPrompt}
          queueLength={jumpQueue.length}
          onClose={() => dismissJumpPrompt(activeJumpPrompt.connection_id)}
        />
      )}
    </div>
  );
}
