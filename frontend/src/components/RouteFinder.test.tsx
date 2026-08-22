import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchSolarSystems } from "../api/maps";
import { getRoute, shareRoute } from "../api/route";
import type { RouteDetail, RouteOut, SolarSystemOut } from "../api/types";
import { SEARCH_DEBOUNCE_MS } from "../constants";
import { RouteFinder } from "./RouteFinder";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("../api/maps", () => ({
  searchSolarSystems: vi.fn(),
}));
vi.mock("../api/route", () => ({
  getRoute: vi.fn(),
  shareRoute: vi.fn(),
}));
vi.mock("./RouteDiagram", () => ({
  RouteDiagram: ({ route }: { route: RouteDetail }) => (
    <div data-testid="route-diagram">
      {route.systems.map((s) => s.name).join(",")}
    </div>
  ),
}));
vi.mock("./UniverseRegionsDialog", () => ({
  UniverseRegionsDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="universe-dialog">
      <button type="button" onClick={onClose}>
        close universe
      </button>
    </div>
  ),
}));
vi.mock("./FleetPanel", () => ({
  FleetPanel: () => <div data-testid="fleet-panel" />,
}));

function solarSystem(id: number, name: string): SolarSystemOut {
  return {
    id,
    name,
    security_status: 0.5,
    wormhole_class_id: null,
    visual_effect: null,
    constellation_name: null,
    region_name: null,
    space_type: "High Sec",
    owner: null,
    statics: [],
  };
}

function route(overrides: Partial<RouteOut> = {}): RouteOut {
  return {
    found: true,
    message: null,
    route: {
      systems: [solarSystem(100, "Jita"), solarSystem(200, "Amarr")],
      legs: [],
      contributors: [],
    },
    alternate: null,
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

// Start's and End's pickers each render their own "Search solar system…"
// input independently (neither depends on the other having a value yet),
// so both can be on screen at once - index 0 is always Start's, 1 always
// End's, whichever of the two is currently rendered.
async function search(index: number, query: string) {
  fireEvent.change(
    screen.getAllByPlaceholderText("Search solar system…")[index],
    {
      target: { value: query },
    },
  );
  await act(async () => {
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    await Promise.resolve();
  });
}

function renderFinder() {
  return render(<RouteFinder />, { wrapper: MemoryRouter });
}

async function pickStartAndEnd() {
  vi.mocked(searchSolarSystems).mockResolvedValue([solarSystem(100, "Jita")]);
  await search(0, "jita");
  fireEvent.click(screen.getByRole("button", { name: "Jita" }));

  vi.mocked(searchSolarSystems).mockResolvedValue([solarSystem(200, "Amarr")]);
  await search(0, "amarr");
  fireEvent.click(screen.getByRole("button", { name: "Amarr" }));
}

describe("RouteFinder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    navigateMock.mockReset();
    vi.mocked(searchSolarSystems).mockReset();
    vi.mocked(getRoute).mockReset();
    vi.mocked(shareRoute).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("prompts to pick systems before any route is found", () => {
    renderFinder();
    expect(
      screen.getByText("Pick a start and end system to find a route."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find route" })).toBeDisabled();
  });

  it("selecting a start system shows it with a change button and clears the search", async () => {
    vi.mocked(searchSolarSystems).mockResolvedValue([solarSystem(100, "Jita")]);
    renderFinder();

    await search(0, "jita");
    fireEvent.click(screen.getByRole("button", { name: "Jita" }));

    expect(screen.getByText("Jita")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "change" })).toBeInTheDocument();
  });

  it("clicking change lets you search again", async () => {
    vi.mocked(searchSolarSystems).mockResolvedValue([solarSystem(100, "Jita")]);
    renderFinder();
    await search(0, "jita");
    fireEvent.click(screen.getByRole("button", { name: "Jita" }));

    fireEvent.click(screen.getByRole("button", { name: "change" }));

    expect(screen.getAllByPlaceholderText("Search solar system…")).toHaveLength(
      2,
    );
  });

  it("enables Find route only once both start and end are picked", async () => {
    renderFinder();
    await pickStartAndEnd();
    expect(
      screen.getByRole("button", { name: "Find route" }),
    ).not.toBeDisabled();
  });

  it("finds a route and shows the diagram, itinerary, and share button", async () => {
    vi.mocked(getRoute).mockResolvedValue(route());
    renderFinder();
    await pickStartAndEnd();

    fireEvent.click(screen.getByRole("button", { name: "Find route" }));
    await flush();

    expect(getRoute).toHaveBeenCalledWith(100, 200);
    expect(screen.getByTestId("route-diagram")).toHaveTextContent("Jita,Amarr");
    expect(
      screen.getByRole("button", { name: "Share this route" }),
    ).toBeInTheDocument();
  });

  it("shows the not-found message instead of a diagram", async () => {
    vi.mocked(getRoute).mockResolvedValue(
      route({ found: false, message: "No connection exists.", route: null }),
    );
    renderFinder();
    await pickStartAndEnd();
    fireEvent.click(screen.getByRole("button", { name: "Find route" }));
    await flush();

    expect(screen.getByText("No connection exists.")).toBeInTheDocument();
    expect(screen.queryByTestId("route-diagram")).not.toBeInTheDocument();
  });

  it("shows the alternate banner and toggles the displayed route", async () => {
    vi.mocked(getRoute).mockResolvedValue(
      route({
        alternate: {
          systems: [solarSystem(300, "Dodixie")],
          legs: [],
          contributors: [],
        },
      }),
    );
    renderFinder();
    await pickStartAndEnd();
    fireEvent.click(screen.getByRole("button", { name: "Find route" }));
    await flush();

    expect(screen.getByTestId("route-diagram")).toHaveTextContent("Jita,Amarr");
    fireEvent.click(screen.getByRole("button", { name: "View risky route" }));
    expect(screen.getByTestId("route-diagram")).toHaveTextContent("Dodixie");
  });

  it("shares the route and navigates to the shared page", async () => {
    vi.mocked(getRoute).mockResolvedValue(route());
    vi.mocked(shareRoute).mockResolvedValue({
      id: 9,
      owner_id: 1,
      start_system: solarSystem(100, "Jita"),
      end_system: solarSystem(200, "Amarr"),
      visibility: "shared",
      found: true,
      systems: [],
      legs: [],
      contributors: [],
      alternate: null,
      last_computed_at: null,
      is_owner: true,
    });
    renderFinder();
    await pickStartAndEnd();
    fireEvent.click(screen.getByRole("button", { name: "Find route" }));
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Share this route" }));
    await flush();

    expect(shareRoute).toHaveBeenCalledWith(100, 200);
    expect(navigateMock).toHaveBeenCalledWith("/route/shared/9");
  });

  it("shows an error when sharing fails", async () => {
    vi.mocked(getRoute).mockResolvedValue(route());
    vi.mocked(shareRoute).mockRejectedValue(new Error("share failed"));
    renderFinder();
    await pickStartAndEnd();
    fireEvent.click(screen.getByRole("button", { name: "Find route" }));
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Share this route" }));
    await flush();

    expect(screen.getByText(/share failed/)).toBeInTheDocument();
  });

  it("toggles the fleet tracking panel", () => {
    renderFinder();
    expect(screen.queryByTestId("fleet-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Fleet tracking" }));
    expect(screen.getByTestId("fleet-panel")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hide fleet tracking" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Hide fleet tracking" }),
    );
    expect(screen.queryByTestId("fleet-panel")).not.toBeInTheDocument();
  });

  it("opens the universe dialog", () => {
    renderFinder();
    fireEvent.click(screen.getByRole("button", { name: "Universe" }));
    expect(screen.getByTestId("universe-dialog")).toBeInTheDocument();
  });

  it("shows a search error", async () => {
    vi.mocked(searchSolarSystems).mockRejectedValue(new Error("search down"));
    renderFinder();
    await search(0, "jita");

    expect(screen.getByText(/search down/)).toBeInTheDocument();
  });

  it("shows an error when finding the route fails", async () => {
    vi.mocked(getRoute).mockRejectedValue(new Error("route lookup failed"));
    renderFinder();
    await pickStartAndEnd();
    fireEvent.click(screen.getByRole("button", { name: "Find route" }));
    await flush();

    expect(screen.getByText(/route lookup failed/)).toBeInTheDocument();
  });
});
