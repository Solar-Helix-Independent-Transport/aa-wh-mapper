import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteSharedRoute, getSharedRoute } from "../api/route";
import type { RouteDetail, SharedRouteOut, SolarSystemOut } from "../api/types";
import {
  installFakeWebSocket,
  FakeWebSocket,
} from "../testUtils/fakeWebSocket";
import { SharedRoute } from "./SharedRoute";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("../api/route", () => ({
  getSharedRoute: vi.fn(),
  deleteSharedRoute: vi.fn(),
}));

vi.mock("./RouteDiagram", () => ({
  RouteDiagram: ({ route }: { route: RouteDetail }) => (
    <div data-testid="route-diagram">
      {route.systems.map((s) => s.name).join(",")}
    </div>
  ),
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

function sharedRoute(overrides: Partial<SharedRouteOut> = {}): SharedRouteOut {
  return {
    id: 1,
    owner_id: 1,
    start_system: solarSystem(100, "Jita"),
    end_system: solarSystem(200, "Amarr"),
    visibility: "shared",
    found: true,
    systems: [solarSystem(100, "Jita"), solarSystem(200, "Amarr")],
    legs: [],
    contributors: [],
    alternate: null,
    last_computed_at: "2026-01-01T00:00:00Z",
    is_owner: true,
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function renderRoute(routeId = 1) {
  return render(<SharedRoute routeId={routeId} />, { wrapper: MemoryRouter });
}

describe("SharedRoute", () => {
  beforeEach(() => {
    installFakeWebSocket();
    vi.mocked(getSharedRoute).mockReset();
    vi.mocked(deleteSharedRoute).mockReset();
    navigateMock.mockReset();
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows a loading state before the route arrives", () => {
    vi.mocked(getSharedRoute).mockReturnValue(new Promise(() => {}));
    renderRoute();
    expect(screen.getByText("Loading route…")).toBeInTheDocument();
  });

  it("shows an error message on fetch failure", async () => {
    vi.mocked(getSharedRoute).mockRejectedValue(new Error("not found"));
    renderRoute();
    await flush();
    expect(screen.getByText(/not found/)).toBeInTheDocument();
  });

  it("titles the toolbar with the start/end systems and a Live badge once the socket opens", async () => {
    vi.mocked(getSharedRoute).mockResolvedValue(sharedRoute());
    renderRoute();
    await flush();

    expect(screen.getByText("Jita → Amarr")).toBeInTheDocument();
    expect(screen.getByText("Connecting…")).toBeInTheDocument();

    FakeWebSocket.instances[0].triggerOpen();
    await flush();
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("copies the current URL and reverts the label after a couple seconds", async () => {
    vi.useFakeTimers();
    vi.mocked(getSharedRoute).mockResolvedValue(sharedRoute());
    renderRoute();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await flush();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      window.location.href,
    );
    expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(
      screen.getByRole("button", { name: "Copy link" }),
    ).toBeInTheDocument();
  });

  it("shows Delete only for the route's owner", async () => {
    vi.mocked(getSharedRoute).mockResolvedValue(
      sharedRoute({ is_owner: false }),
    );
    renderRoute();
    await flush();
    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
  });

  it("deletes the route and navigates back to /route", async () => {
    vi.mocked(getSharedRoute).mockResolvedValue(
      sharedRoute({ is_owner: true }),
    );
    vi.mocked(deleteSharedRoute).mockResolvedValue(undefined);
    renderRoute();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await flush();

    expect(deleteSharedRoute).toHaveBeenCalledWith(1);
    expect(navigateMock).toHaveBeenCalledWith("/route");
  });

  it("shows a placeholder and no-route message when the route wasn't found", async () => {
    vi.mocked(getSharedRoute).mockResolvedValue(sharedRoute({ found: false }));
    renderRoute();
    await flush();

    expect(
      screen.getByText("No route found between Jita and Amarr"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("route-diagram")).not.toBeInTheDocument();
  });

  it("hides the alternate banner when the route wasn't found even if an alternate exists", async () => {
    const alternate: RouteDetail = {
      systems: [solarSystem(300, "Dodixie")],
      legs: [],
      contributors: [],
    };
    vi.mocked(getSharedRoute).mockResolvedValue(
      sharedRoute({ found: false, alternate }),
    );
    renderRoute();
    await flush();

    expect(screen.queryByText(/shorter route/)).not.toBeInTheDocument();
  });

  it("shows the alternate banner and toggles the displayed route", async () => {
    const alternate: RouteDetail = {
      systems: [solarSystem(300, "Dodixie")],
      legs: [],
      contributors: [],
    };
    vi.mocked(getSharedRoute).mockResolvedValue(sharedRoute({ alternate }));
    renderRoute();
    await flush();

    expect(screen.getByTestId("route-diagram")).toHaveTextContent("Jita,Amarr");

    fireEvent.click(screen.getByRole("button", { name: "View risky route" }));
    expect(screen.getByTestId("route-diagram")).toHaveTextContent("Dodixie");

    fireEvent.click(screen.getByRole("button", { name: "View safe route" }));
    expect(screen.getByTestId("route-diagram")).toHaveTextContent("Jita,Amarr");
  });

  it("refetches the route when the live socket signals a change", async () => {
    vi.mocked(getSharedRoute).mockResolvedValue(sharedRoute());
    renderRoute();
    await flush();
    expect(getSharedRoute).toHaveBeenCalledTimes(1);

    FakeWebSocket.instances[0].triggerMessage({
      event: "route.updated",
      data: {},
    });
    await flush();

    expect(getSharedRoute).toHaveBeenCalledTimes(2);
  });
});
