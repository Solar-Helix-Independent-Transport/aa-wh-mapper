import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteSharedRoute, getSharedRoute } from "../api/route";
import type { SharedRouteOut } from "../api/types";
import {
  ROUTE_SIDEBAR_DEFAULT_WIDTH,
  ROUTE_SIDEBAR_HIDDEN_STORAGE_KEY,
  ROUTE_SIDEBAR_MAX_WIDTH,
  ROUTE_SIDEBAR_MIN_WIDTH,
  ROUTE_SIDEBAR_WIDTH_STORAGE_KEY,
} from "../constants";
import { useResizablePanel } from "../hooks/useResizablePanel";
import { useRouteSocket } from "../hooks/useRouteSocket";
import { AppHeader } from "./AppHeader";
import { ConnectionStatusBanner } from "./ConnectionStatusBanner";
import { LoadingState } from "./LoadingState";
import { SocketStatusBadge } from "./SocketStatusBadge";
import { ResizableSidePanel } from "./ResizableSidePanel";
import { RouteAlternateBanner } from "./RouteAlternateBanner";
import { RouteContributors } from "./RouteContributors";
import { RouteDiagram } from "./RouteDiagram";
import { RouteItinerary } from "./RouteItinerary";

/** A persisted, live-updating Route's own page - "Share this route"
 * (RouteFinder) navigates here, including for the owner, so there's one
 * live source of truth rather than the owner watching a separate, non-live
 * copy of what they just shared. Start/end are fixed - see the wayfinder
 * map's ticket 09. Same full-width toolbar/sidebar/diagram shape as
 * RouteFinder (and MapView). */
export function SharedRoute({ routeId }: { routeId: number }) {
  const navigate = useNavigate();
  const [route, setRoute] = useState<SharedRouteOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedSystemId, setSelectedSystemId] = useState<number | null>(null);
  const [showingAlternate, setShowingAlternate] = useState(false);
  const sidebarPanel = useResizablePanel({
    defaultWidth: ROUTE_SIDEBAR_DEFAULT_WIDTH,
    minWidth: ROUTE_SIDEBAR_MIN_WIDTH,
    maxWidth: ROUTE_SIDEBAR_MAX_WIDTH,
    widthStorageKey: ROUTE_SIDEBAR_WIDTH_STORAGE_KEY,
    hiddenStorageKey: ROUTE_SIDEBAR_HIDDEN_STORAGE_KEY,
  });

  const refresh = useCallback(() => {
    getSharedRoute(routeId)
      .then(setRoute)
      .catch((err) => setError(String(err)));
  }, [routeId]);

  useEffect(refresh, [refresh]);

  const socketStatus = useRouteSocket(routeId, () => {
    // The socket only signals "this route changed" - resync via the GET
    // endpoint rather than trusting the payload, same convention as
    // useMapSocket's callers.
    refresh();
  });

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = async () => {
    if (!route) {
      return;
    }
    await deleteSharedRoute(route.id);
    navigate("/route");
  };

  if (error) {
    return (
      <>
        <AppHeader />
        <p className="error">{error}</p>
      </>
    );
  }

  if (!route) {
    return (
      <>
        <AppHeader />
        <LoadingState label="Loading route…" />
      </>
    );
  }

  const displayedRoute =
    showingAlternate && route.alternate
      ? route.alternate
      : {
          systems: route.systems,
          legs: route.legs,
          contributors: route.contributors,
        };

  return (
    <div className="route-view">
      <AppHeader />
      <div className="route-toolbar">
        <h2 className="route-toolbar-title">
          {route.start_system.name} → {route.end_system.name}
        </h2>
        <SocketStatusBadge status={socketStatus} />
        <div className="route-toolbar-actions">
          <button type="button" onClick={handleCopyLink}>
            {copied ? "Copied!" : "Copy link"}
          </button>
          {route.is_owner && (
            <button type="button" onClick={handleDelete}>
              Delete
            </button>
          )}
        </div>
      </div>

      {route.found && route.alternate && (
        <RouteAlternateBanner
          showingAlternate={showingAlternate}
          onToggle={() => setShowingAlternate((current) => !current)}
        />
      )}

      <div className="route-view-body">
        <div className="route-diagram-pane">
          <ConnectionStatusBanner status={socketStatus} />
          {route.found ? (
            <RouteDiagram
              route={displayedRoute}
              selectedSystemId={selectedSystemId}
              onSelectSystem={setSelectedSystemId}
            />
          ) : (
            <div className="route-diagram-placeholder" />
          )}
        </div>

        <ResizableSidePanel
          width={sidebarPanel.width}
          hidden={sidebarPanel.hidden}
          onShow={() => sidebarPanel.setHidden(false)}
          onHide={() => sidebarPanel.setHidden(true)}
          onResizeStart={sidebarPanel.handleResizeStart}
          label="route itinerary"
        >
          <div className="route-sidebar">
            {!route.found && (
              <p className="route-finder-empty">
                No route found between {route.start_system.name} and{" "}
                {route.end_system.name}
              </p>
            )}

            {route.found && (
              <RouteItinerary
                systems={displayedRoute.systems}
                legs={displayedRoute.legs}
                selectedSystemId={selectedSystemId}
              />
            )}

            {route.found && (
              <RouteContributors contributors={displayedRoute.contributors} />
            )}
          </div>
        </ResizableSidePanel>
      </div>
    </div>
  );
}
