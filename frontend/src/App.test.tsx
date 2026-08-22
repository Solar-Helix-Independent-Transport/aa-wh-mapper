import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { WH_MAPPER_URL_PREFIX } from "./constants";

vi.mock("./components/MapList", () => ({
  MapList: () => <div data-testid="map-list" />,
}));
vi.mock("./components/MapView", () => ({
  MapView: ({ mapId }: { mapId: number }) => (
    <div data-testid="map-view">{mapId}</div>
  ),
}));
vi.mock("./components/RouteFinder", () => ({
  RouteFinder: () => <div data-testid="route-finder" />,
}));
vi.mock("./components/SharedRoute", () => ({
  SharedRoute: ({ routeId }: { routeId: number }) => (
    <div data-testid="shared-route">{routeId}</div>
  ),
}));
vi.mock("./components/StatusPage", () => ({
  StatusPage: () => <div data-testid="status-page" />,
}));

function navigateTo(path: string) {
  window.history.pushState({}, "", `${WH_MAPPER_URL_PREFIX}${path}`);
}

describe("App routing", () => {
  afterEach(() => {
    window.history.pushState({}, "", WH_MAPPER_URL_PREFIX);
  });

  it("renders MapList at the root", () => {
    navigateTo("/");
    render(<App />);
    expect(screen.getByTestId("map-list")).toBeInTheDocument();
  });

  it("renders MapView for a valid numeric map id", () => {
    navigateTo("/maps/5");
    render(<App />);
    expect(screen.getByTestId("map-view")).toHaveTextContent("5");
  });

  it("shows an error for a non-numeric map id", () => {
    navigateTo("/maps/not-a-number");
    render(<App />);
    expect(screen.getByText("Invalid map.")).toBeInTheDocument();
    expect(screen.queryByTestId("map-view")).not.toBeInTheDocument();
  });

  it("renders RouteFinder at /route", () => {
    navigateTo("/route");
    render(<App />);
    expect(screen.getByTestId("route-finder")).toBeInTheDocument();
  });

  it("renders SharedRoute for a valid numeric route id", () => {
    navigateTo("/route/shared/9");
    render(<App />);
    expect(screen.getByTestId("shared-route")).toHaveTextContent("9");
  });

  it("shows an error for a non-numeric shared route id", () => {
    navigateTo("/route/shared/not-a-number");
    render(<App />);
    expect(screen.getByText("Invalid route.")).toBeInTheDocument();
    expect(screen.queryByTestId("shared-route")).not.toBeInTheDocument();
  });

  it("renders StatusPage at /status", () => {
    navigateTo("/status");
    render(<App />);
    expect(screen.getByTestId("status-page")).toBeInTheDocument();
  });

  it("uses the full-width main layout for map and route views, not the map list", () => {
    navigateTo("/");
    const { container, unmount } = render(<App />);
    expect(container.querySelector(".app-main")).not.toHaveClass(
      "app-main-full",
    );
    unmount();

    navigateTo("/maps/5");
    const { container: mapContainer } = render(<App />);
    expect(mapContainer.querySelector(".app-main")).toHaveClass(
      "app-main-full",
    );
  });
});
