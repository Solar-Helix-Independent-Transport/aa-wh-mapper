import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { searchSolarSystems } from "../api/maps";
import { getRoute, shareRoute } from "../api/route";
import type { RouteOut, SolarSystemOut } from "../api/types";
import {
  ROUTE_SIDEBAR_DEFAULT_WIDTH,
  ROUTE_SIDEBAR_HIDDEN_STORAGE_KEY,
  ROUTE_SIDEBAR_MAX_WIDTH,
  ROUTE_SIDEBAR_MIN_WIDTH,
  ROUTE_SIDEBAR_WIDTH_STORAGE_KEY,
} from "../constants";
import { useResizablePanel } from "../hooks/useResizablePanel";
import { useSearch } from "../hooks/useSearch";
import { FleetPanel } from "./FleetPanel";
import { ResizableSidePanel } from "./ResizableSidePanel";
import { RouteAlternateBanner } from "./RouteAlternateBanner";
import { RouteContributors } from "./RouteContributors";
import { RouteDiagram } from "./RouteDiagram";
import { RouteItinerary } from "./RouteItinerary";
import { SearchResultRow } from "./SearchResultRow";

/** On-demand, stateless route lookup - see the wayfinder map's tickets
 * 02/04/06/07. Not persisted; "Share this route" (ticket 08/09) promotes a
 * found result into a live-updating Route on its own page. Full-width,
 * two-pane layout (toolbar + sidebar + diagram) matching MapView's own
 * shape, so the diagram gets the same amount of room the map canvas does. */
export function RouteFinder() {
  const navigate = useNavigate();
  const [start, setStart] = useState<SolarSystemOut | null>(null);
  const [end, setEnd] = useState<SolarSystemOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RouteOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [selectedSystemId, setSelectedSystemId] = useState<number | null>(null);
  const [showingAlternate, setShowingAlternate] = useState(false);
  const [showFleetPanel, setShowFleetPanel] = useState(false);

  const searchSystems = useCallback(
    (value: string) =>
      searchSolarSystems(value).then((found) =>
        found.slice().sort((a, b) => a.name.localeCompare(b.name)),
      ),
    [],
  );
  const startSearch = useSearch<SolarSystemOut>(searchSystems, setError);
  const endSearch = useSearch<SolarSystemOut>(searchSystems, setError);
  const sidebarPanel = useResizablePanel({
    defaultWidth: ROUTE_SIDEBAR_DEFAULT_WIDTH,
    minWidth: ROUTE_SIDEBAR_MIN_WIDTH,
    maxWidth: ROUTE_SIDEBAR_MAX_WIDTH,
    widthStorageKey: ROUTE_SIDEBAR_WIDTH_STORAGE_KEY,
    hiddenStorageKey: ROUTE_SIDEBAR_HIDDEN_STORAGE_KEY,
  });

  const findRoute = async () => {
    if (!start || !end) {
      return;
    }
    setLoading(true);
    setError(null);
    setShowingAlternate(false);
    try {
      setResult(await getRoute(start.id, end.id));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    if (!start || !end) {
      return;
    }
    setSharing(true);
    try {
      const shared = await shareRoute(start.id, end.id);
      navigate(`/route/shared/${shared.id}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setSharing(false);
    }
  };

  const displayedRoute =
    showingAlternate && result?.alternate ? result.alternate : result?.route;

  return (
    <div className="route-view">
      <div className="route-toolbar">
        <h2 className="route-toolbar-title">Navigate</h2>

        <div className="route-finder-picker">
          <label>Start</label>
          {start ? (
            <div className="route-finder-selected">
              {start.name}
              <button type="button" onClick={() => setStart(null)}>
                change
              </button>
            </div>
          ) : (
            <>
              <input
                autoFocus
                type="text"
                placeholder="Search solar system…"
                value={startSearch.query}
                onChange={(event) => startSearch.setQuery(event.target.value)}
              />
              {startSearch.results.length > 0 && (
                <ul className="search-results">
                  {startSearch.results.map((system) => (
                    <SearchResultRow
                      key={system.id}
                      onSelect={() => {
                        setStart(system);
                        startSearch.reset();
                      }}
                    >
                      {system.name}
                    </SearchResultRow>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="route-finder-picker">
          <label>End</label>
          {end ? (
            <div className="route-finder-selected">
              {end.name}
              <button type="button" onClick={() => setEnd(null)}>
                change
              </button>
            </div>
          ) : (
            <>
              <input
                type="text"
                placeholder="Search solar system…"
                value={endSearch.query}
                onChange={(event) => endSearch.setQuery(event.target.value)}
              />
              {endSearch.results.length > 0 && (
                <ul className="search-results">
                  {endSearch.results.map((system) => (
                    <SearchResultRow
                      key={system.id}
                      onSelect={() => {
                        setEnd(system);
                        endSearch.reset();
                      }}
                    >
                      {system.name}
                    </SearchResultRow>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <button
          type="button"
          disabled={!start || !end || loading}
          onClick={findRoute}
        >
          {loading ? "Finding…" : "Find route"}
        </button>

        <button
          type="button"
          className="fleet-panel-toggle"
          onClick={() => setShowFleetPanel((current) => !current)}
        >
          {showFleetPanel ? "Hide fleet tracking" : "Fleet tracking"}
        </button>
      </div>

      {error && <p className="error route-toolbar-error">{error}</p>}

      {showFleetPanel && <FleetPanel />}

      {result?.found && result.alternate && (
        <RouteAlternateBanner
          showingAlternate={showingAlternate}
          onToggle={() => setShowingAlternate((current) => !current)}
        />
      )}

      <div className="route-view-body">
        <div className="route-diagram-pane">
          {displayedRoute ? (
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
            {result && !result.found && (
              <p className="route-finder-empty">{result.message}</p>
            )}

            {result?.found && displayedRoute && (
              <>
                <RouteItinerary
                  systems={displayedRoute.systems}
                  legs={displayedRoute.legs}
                  selectedSystemId={selectedSystemId}
                />
                <RouteContributors contributors={displayedRoute.contributors} />
                <button
                  type="button"
                  className="route-share-button"
                  disabled={sharing}
                  onClick={handleShare}
                >
                  {sharing ? "Sharing…" : "Share this route"}
                </button>
              </>
            )}

            {!result && (
              <p className="route-finder-empty">
                Pick a start and end system to find a route.
              </p>
            )}
          </div>
        </ResizableSidePanel>
      </div>
    </div>
  );
}
