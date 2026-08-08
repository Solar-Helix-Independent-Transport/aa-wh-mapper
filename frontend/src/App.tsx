import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import "./App.css";
import { WH_MAPPER_URL_PREFIX } from "./constants";
import { AppHeader } from "./components/AppHeader";
import { MapList } from "./components/MapList";
import { MapView } from "./components/MapView";
import { RouteFinder } from "./components/RouteFinder";
import { SharedRoute } from "./components/SharedRoute";
import { StatusPage } from "./components/StatusPage";

function MapListRoute() {
  const navigate = useNavigate();
  return <MapList onOpen={(map) => navigate(`/maps/${map.id}`)} />;
}

function MapViewRoute() {
  const { mapId } = useParams();
  const id = Number(mapId);
  if (!mapId || Number.isNaN(id)) {
    return (
      <>
        <AppHeader />
        <p className="error">Invalid map.</p>
      </>
    );
  }
  return <MapView mapId={id} />;
}

function SharedRouteRoute() {
  const { routeId } = useParams();
  const id = Number(routeId);
  if (!routeId || Number.isNaN(id)) {
    return (
      <>
        <AppHeader />
        <p className="error">Invalid route.</p>
      </>
    );
  }
  return <SharedRoute routeId={id} />;
}

function AppShell() {
  const location = useLocation();
  const isMapView = location.pathname.startsWith("/maps/");
  const isRouteView = location.pathname.startsWith("/route");

  // Every page now renders its own <AppHeader/> (see that component) rather
  // than this shell owning one conditionally - that's what makes Status/
  // Navigate/Maps reachable from inside a map and keeps every page's header
  // built from the same two-zone component instead of each page (or
  // MapView specifically) hand-rolling its own bar.
  return (
    <div className="app-shell">
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
          <Route path="/status" element={<StatusPage />} />
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
