import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  RouteDetail,
  RouteLegOut,
  SolarSystemOut,
  WormholeConnectionOut,
} from "../api/types";
import { RouteDiagram } from "./RouteDiagram";

vi.mock("./ConnectionDetailsDialog", () => ({
  ConnectionDetailsDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="connection-details-dialog">
      <button type="button" onClick={onClose}>
        close connection details
      </button>
    </div>
  ),
}));
vi.mock("./RouteSystemDetailsDialog", () => ({
  RouteSystemDetailsDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="system-details-dialog">
      <button type="button" onClick={onClose}>
        close system details
      </button>
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
    region_name: "Region",
    space_type: "High Sec",
    owner: null,
    statics: [],
  };
}

function connection(
  overrides: Partial<WormholeConnectionOut> = {},
): WormholeConnectionOut {
  return {
    id: 1,
    map_id: 5,
    connection_type: "wormhole",
    top_system_id: 1,
    bottom_system_id: 2,
    top_system_solar_system_id: 100,
    bottom_system_solar_system_id: 200,
    top_signature_id: null,
    bottom_signature_id: null,
    top_signature: null,
    bottom_signature: null,
    life_status: "stable",
    life_status_marked_at: null,
    mass_status: "unknown",
    ship_size_limit: "unknown",
    time_status: "unknown",
    created_by_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function leg(overrides: Partial<RouteLegOut> = {}): RouteLegOut {
  return {
    connection_type: "wormhole",
    life_status: "stable",
    mass_status: "unknown",
    map_id: 5,
    connection_id: 1,
    connection: connection(),
    ...overrides,
  };
}

function route(): RouteDetail {
  return {
    systems: [solarSystem(100, "Jita"), solarSystem(200, "Amarr")],
    legs: [leg()],
    contributors: [],
  };
}

describe("RouteDiagram", () => {
  it("renders a node labeled with each route system's name", () => {
    render(
      <RouteDiagram
        route={route()}
        selectedSystemId={null}
        onSelectSystem={vi.fn()}
      />,
    );

    expect(screen.getByText("Jita")).toBeInTheDocument();
    expect(screen.getByText("Amarr")).toBeInTheDocument();
  });

  it("calls onSelectSystem with the clicked node's solar system id", () => {
    const onSelectSystem = vi.fn();
    const { container } = render(
      <RouteDiagram
        route={route()}
        selectedSystemId={null}
        onSelectSystem={onSelectSystem}
      />,
    );

    fireEvent.click(container.querySelector('[data-id="100"]')!);

    expect(onSelectSystem).toHaveBeenCalledWith(100);
  });

  it("calls onSelectSystem(null) when the pane is clicked", () => {
    const onSelectSystem = vi.fn();
    const { container } = render(
      <RouteDiagram
        route={route()}
        selectedSystemId={null}
        onSelectSystem={onSelectSystem}
      />,
    );

    fireEvent.click(container.querySelector(".react-flow__pane")!);

    expect(onSelectSystem).toHaveBeenCalledWith(null);
  });

  it("opens a Details context menu on right-clicking a node, and the system details dialog from it", () => {
    const { container } = render(
      <RouteDiagram
        route={route()}
        selectedSystemId={null}
        onSelectSystem={vi.fn()}
      />,
    );

    fireEvent.contextMenu(container.querySelector('[data-id="100"]')!);
    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByTestId("system-details-dialog")).toBeInTheDocument();
  });

  // handleEdgeContextMenu (opening ConnectionDetailsDialog, and skipping a
  // stargate leg entirely) isn't reachable from a rendered DOM event here -
  // jsdom's ResizeObserver stub never reports node measurements (see
  // testSetup.ts), and xyflow never renders an edge connected to an
  // unmeasured node, so `.react-flow__edges` stays permanently empty in this
  // environment. That logic is otherwise a straight mirror of the
  // node-context-menu path already covered above.
});
