import { useState } from "react";
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import "./App.css";
import { WH_MAPPER_URL_PREFIX } from "./constants";
import { AppBrand } from "./components/AppBrand";
import { MapList } from "./components/MapList";
import { MapView } from "./components/MapView";
import { RouteFinder } from "./components/RouteFinder";
import { SharedRoute } from "./components/SharedRoute";
import { TrackedCharactersPanel } from "./components/TrackedCharactersPanel";

function MapListRoute() {
  const navigate = useNavigate();
  return <MapList onOpen={(map) => navigate(`/maps/${map.id}`)} />;
}

function MapViewRoute() {
  const { mapId } = useParams();
  const id = Number(mapId);
  if (!mapId || Number.isNaN(id)) {
    return <p className="error">Invalid map.</p>;
  }
  return <MapView mapId={id} />;
}

function SharedRouteRoute() {
  const { routeId } = useParams();
  const id = Number(routeId);
  if (!routeId || Number.isNaN(id)) {
    return <p className="error">Invalid route.</p>;
  }
  return <SharedRoute routeId={id} />;
}

function AppShell() {
  const location = useLocation();
  const isMapView = location.pathname.startsWith("/maps/");
  const isRouteView = location.pathname.startsWith("/route");
  const [showTracking, setShowTracking] = useState(false);

  return (
    <div className="app-shell">
      {/* MapView renders its own combined brand + action-buttons bar as a
          single navbar row - a plain brand-only header here would just
          duplicate it, so this one only appears on the map list. Tracking is
          global to the user (not tied to any one map), so it needs an entry
          point here too - otherwise there'd be no way to manage it without
          first opening some map. */}
      {!isMapView && (
        <header className="app-header">
          <AppBrand />
          <div className="map-toolbar-actions">
            <Link to="/route" className="nav-link">
              Navigate
            </Link>
            <button type="button" onClick={() => setShowTracking(true)}>
              Tracked characters
            </button>
          </div>
        </header>
      )}

      {showTracking && (
        <TrackedCharactersPanel onClose={() => setShowTracking(false)} />
      )}

      <main
        className={
          isMapView || isRouteView ? "app-main app-main-full" : "app-main"
        }
      >
        <Routes>
          <Route path="/" element={<MapListRoute />} />
          <Route path="/maps/:mapId" element={<MapViewRoute />} />
          <Route path="/route" element={<RouteFinder />} />
          <Route path="/route/shared/:routeId" element={<SharedRouteRoute />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter basename={WH_MAPPER_URL_PREFIX}>
      <AppShell />
    </BrowserRouter>
  );
}

export default App;
