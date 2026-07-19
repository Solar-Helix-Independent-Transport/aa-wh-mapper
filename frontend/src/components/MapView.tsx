import { useCallback, useEffect, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { getMapState } from "../api/maps";
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
import { AppBrand } from "./AppBrand";
import { IdentifyJumpSignatureDialog } from "./IdentifyJumpSignatureDialog";
import { LoadingState } from "./LoadingState";
import { MapCanvas } from "./MapCanvas";
import { SignaturePanel } from "./SignaturePanel";
import { AddSystemDialog } from "./AddSystemDialog";
import { ImportRegionDialog } from "./ImportRegionDialog";
import { ShareDialog } from "./ShareDialog";
import { TrackedCharactersPanel } from "./TrackedCharactersPanel";
import { applyMapEvent } from "./mapEvents";

function initialPanelWidth(): number {
  const stored = Number(
    localStorage.getItem(SIGNATURE_PANEL_WIDTH_STORAGE_KEY),
  );
  return stored >= SIGNATURE_PANEL_MIN_WIDTH &&
    stored <= SIGNATURE_PANEL_MAX_WIDTH
    ? stored
    : SIGNATURE_PANEL_DEFAULT_WIDTH;
}

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
  const [showShare, setShowShare] = useState(false);
  const [showTracking, setShowTracking] = useState(false);
  // A queue, not a single slot: several tracked characters (or the same one,
  // jumping several wormholes back to back) can each generate a prompt
  // before the viewer answers the first one - overwriting a single slot
  // would silently drop everything but the most recent jump.
  const [jumpQueue, setJumpQueue] = useState<JumpNeedsSignaturePrompt[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState<number>(initialPanelWidth);
  const [panelHidden, setPanelHidden] = useState<boolean>(
    () => localStorage.getItem(SIGNATURE_PANEL_HIDDEN_STORAGE_KEY) === "true",
  );
  const isResizingPanelRef = useRef(false);
  // Holds the active drag's own listener-removal function while a resize is
  // in progress, so the unmount effect below can tear it down if the
  // component unmounts mid-drag (e.g. navigating away while the resize
  // handle is held down) instead of leaking `document`-level listeners.
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    localStorage.setItem(SIGNATURE_PANEL_WIDTH_STORAGE_KEY, String(panelWidth));
  }, [panelWidth]);

  useEffect(() => {
    localStorage.setItem(
      SIGNATURE_PANEL_HIDDEN_STORAGE_KEY,
      String(panelHidden),
    );
  }, [panelHidden]);

  const handlePanelResizeStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      isResizingPanelRef.current = true;
      const startX = event.clientX;
      const startWidth = panelWidth;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizingPanelRef.current) {
          return;
        }
        // The panel sits on the right edge of the screen, so dragging left
        // (a negative clientX delta) should grow it.
        const next = startWidth + (startX - moveEvent.clientX);
        setPanelWidth(
          Math.min(
            Math.max(next, SIGNATURE_PANEL_MIN_WIDTH),
            SIGNATURE_PANEL_MAX_WIDTH,
          ),
        );
      };
      const stopResizing = () => {
        isResizingPanelRef.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", stopResizing);
        resizeCleanupRef.current = null;
      };
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", stopResizing);
      resizeCleanupRef.current = stopResizing;
    },
    [panelWidth],
  );

  useEffect(() => {
    return () => resizeCleanupRef.current?.();
  }, []);

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
          setState(pendingEventsRef.current.reduce(applyMapEvent, fetched));
        })
        .catch((err) => setError(String(err)))
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
  useMapSocket(mapId, handleEvent, refresh);

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

  if (error) {
    return <p className="error">Failed to load map: {error}</p>;
  }

  if (!state) {
    return <LoadingState label="Loading map…" />;
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

  return (
    <div className="map-view">
      <div className="app-header map-toolbar">
        <AppBrand />
        <h2 className="map-title">{state.map.name}</h2>
        <div className="map-toolbar-actions">
          <button type="button" onClick={() => openAddSystem()}>
            + Add system
          </button>
          {state.systems.length === 0 && (
            <button type="button" onClick={() => setShowImportRegion(true)}>
              Import region
            </button>
          )}
          <button type="button" onClick={() => setShowShare(true)}>
            Share
          </button>
          <button type="button" onClick={() => setShowTracking(true)}>
            Tracked characters ({state.tracked_characters.length})
          </button>
          {pendingConnections.length > 0 && (
            <button
              type="button"
              onClick={reopenPendingSignatures}
              title="Reopen the 'which signature was that' prompt for any wormhole connection still missing one"
            >
              Pending signatures ({pendingConnections.length})
            </button>
          )}
        </div>
      </div>

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
            />
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

          {panelHidden ? (
            <button
              type="button"
              className="signature-panel-show-button"
              onClick={() => setPanelHidden(false)}
              aria-label="Show signature panel"
              title="Show signature panel"
            >
              <i className="fas fa-chevron-left" aria-hidden="true" />
            </button>
          ) : (
            <div
              className="signature-panel-wrapper"
              style={{ width: panelWidth }}
            >
              <div
                className="signature-panel-resize-handle"
                onMouseDown={handlePanelResizeStart}
              />
              <button
                type="button"
                className="signature-panel-hide-button"
                onClick={() => setPanelHidden(true)}
                aria-label="Hide signature panel"
                title="Hide signature panel"
              >
                <i className="fas fa-chevron-right" aria-hidden="true" />
              </button>
              <SignaturePanel
                mapId={mapId}
                state={state}
                systemId={selectedSystemId}
                onClose={() => setSelectedSystemId(null)}
                onSelectSystem={setSelectedSystemId}
                onSystemCreated={handleSystemCreated}
              />
            </div>
          )}
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

      {showShare && (
        <ShareDialog
          map={state.map}
          onClose={() => setShowShare(false)}
          onMapUpdated={refresh}
        />
      )}

      {showTracking && (
        <TrackedCharactersPanel onClose={() => setShowTracking(false)} />
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
