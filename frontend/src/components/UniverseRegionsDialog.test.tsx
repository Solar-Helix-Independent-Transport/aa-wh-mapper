import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMapState, getUniverseRegionsGraph } from "../api/maps";
import type {
  MapOut,
  MapSystemOut,
  RegionGraphOut,
  RouteDetail,
  SolarSystemOut,
  WormholeConnectionOut,
} from "../api/types";
import { UniverseRegionsDialog } from "./UniverseRegionsDialog";

vi.mock("../api/maps", () => ({
  getMapState: vi.fn(),
  getUniverseRegionsGraph: vi.fn(),
}));

function graph(overrides: Partial<RegionGraphOut> = {}): RegionGraphOut {
  return {
    nodes: [
      { id: 10, name: "Region A", x: 0, y: 0 },
      { id: 20, name: "Region B", x: 100, y: 0 },
    ],
    edges: [{ source: 10, target: 20 }],
    landmarks: [{ id: 31000005, name: "Thera", kind: "thera" }],
    ...overrides,
  };
}

function solarSystem(id: number, regionName: string | null): SolarSystemOut {
  return {
    id,
    name: `System ${id}`,
    security_status: 0.5,
    wormhole_class_id: null,
    visual_effect: null,
    constellation_name: null,
    region_name: regionName,
    space_type: "High Sec",
    owner: null,
    statics: [],
  };
}

function mapSystem(id: number, regionName: string | null): MapSystemOut {
  return {
    id,
    map_id: 1,
    solar_system: solarSystem(id, regionName),
    label: "",
    x: 0,
    y: 0,
    pinned: false,
    added_by_id: null,
    added_at: "",
  };
}

function connection(
  topSolarSystemId: number,
  bottomSolarSystemId: number,
): WormholeConnectionOut {
  return {
    id: 1,
    map_id: 1,
    connection_type: "wormhole",
    top_system_id: 1,
    bottom_system_id: 2,
    top_system_solar_system_id: topSolarSystemId,
    bottom_system_solar_system_id: bottomSolarSystemId,
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
    created_at: "",
    updated_at: "",
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("UniverseRegionsDialog", () => {
  beforeEach(() => {
    vi.mocked(getUniverseRegionsGraph).mockReset();
    vi.mocked(getMapState).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a loading state before the graph arrives", () => {
    vi.mocked(getUniverseRegionsGraph).mockReturnValue(new Promise(() => {}));
    render(
      <UniverseRegionsDialog
        mode="map"
        systems={[]}
        connections={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Loading region graph…")).toBeInTheDocument();
  });

  it("shows an error message when the graph fetch fails", async () => {
    vi.mocked(getUniverseRegionsGraph).mockRejectedValue(
      new Error("network down"),
    );
    render(
      <UniverseRegionsDialog
        mode="map"
        systems={[]}
        connections={[]}
        onClose={vi.fn()}
      />,
    );
    await flush();
    expect(screen.getByText(/network down/)).toBeInTheDocument();
  });

  it("renders every region and landmark once loaded", async () => {
    vi.mocked(getUniverseRegionsGraph).mockResolvedValue(graph());
    render(
      <UniverseRegionsDialog
        mode="map"
        systems={[]}
        connections={[]}
        onClose={vi.fn()}
      />,
    );
    await flush();

    expect(screen.getByText("Region A")).toBeInTheDocument();
    expect(screen.getByText("Region B")).toBeInTheDocument();
    expect(screen.getByText("Thera")).toBeInTheDocument();
  });

  it("ring-highlights a region touched by the map's own connections", async () => {
    vi.mocked(getUniverseRegionsGraph).mockResolvedValue(graph());
    const { container } = render(
      <UniverseRegionsDialog
        mode="map"
        systems={[mapSystem(1, "Region A"), mapSystem(2, "Region B")]}
        connections={[connection(1, 2)]}
        onClose={vi.fn()}
      />,
    );
    await flush();

    const dots = container.querySelectorAll(
      ".universe-region-node-dot-touched",
    );
    expect(dots.length).toBeGreaterThan(0);
  });

  it("waits for every map's state before rendering in all-maps mode", async () => {
    vi.mocked(getUniverseRegionsGraph).mockResolvedValue(graph());
    vi.mocked(getMapState).mockReturnValue(new Promise(() => {}));
    const maps: MapOut[] = [
      {
        id: 1,
        name: "Map 1",
        owner_id: 1,
        owner_name: "Alice",
        visibility: "private",
        read_only: false,
        can_write: true,
        created_at: "",
        last_updated: "",
        is_owner: true,
        can_edit_sharing: true,
        active_users: 0,
      },
    ];
    render(
      <UniverseRegionsDialog mode="all-maps" maps={maps} onClose={vi.fn()} />,
    );
    await flush();

    expect(screen.getByText("Loading region graph…")).toBeInTheDocument();
  });

  it("renders once all maps' states have arrived in all-maps mode", async () => {
    vi.mocked(getUniverseRegionsGraph).mockResolvedValue(graph());
    vi.mocked(getMapState).mockResolvedValue({
      map: {} as never,
      systems: [],
      signatures: [],
      connections: [],
      tracked_characters: [],
      current_user_id: 1,
    });
    const maps: MapOut[] = [
      {
        id: 1,
        name: "Map 1",
        owner_id: 1,
        owner_name: "Alice",
        visibility: "private",
        read_only: false,
        can_write: true,
        created_at: "",
        last_updated: "",
        is_owner: true,
        can_edit_sharing: true,
        active_users: 0,
      },
    ];
    render(
      <UniverseRegionsDialog mode="all-maps" maps={maps} onClose={vi.fn()} />,
    );
    await flush();

    expect(screen.queryByText("Loading region graph…")).not.toBeInTheDocument();
    expect(screen.getByText("Region A")).toBeInTheDocument();
  });

  it("shows a hint when a route never crosses a region boundary", async () => {
    vi.mocked(getUniverseRegionsGraph).mockResolvedValue(graph());
    const route: RouteDetail = {
      systems: [solarSystem(1, "Region A")],
      legs: [],
      contributors: [],
    };
    render(
      <UniverseRegionsDialog mode="route" route={route} onClose={vi.fn()} />,
    );
    await flush();

    expect(
      screen.getByText(/This route never crosses a real-space region boundary/),
    ).toBeInTheDocument();
  });

  it("hides the hint for a null route (nothing computed yet)", async () => {
    vi.mocked(getUniverseRegionsGraph).mockResolvedValue(graph());
    render(
      <UniverseRegionsDialog mode="route" route={null} onClose={vi.fn()} />,
    );
    await flush();

    expect(
      screen.queryByText(
        /This route never crosses a real-space region boundary/,
      ),
    ).not.toBeInTheDocument();
  });

  it("toggles the legend popover open and closed", async () => {
    vi.mocked(getUniverseRegionsGraph).mockResolvedValue(graph());
    render(
      <UniverseRegionsDialog
        mode="map"
        systems={[]}
        connections={[]}
        onClose={vi.fn()}
      />,
    );
    await flush();

    expect(
      screen.queryByText("Cross-region stargate link"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Legend" }));
    expect(screen.getByText("Cross-region stargate link")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(
      screen.queryByText("Cross-region stargate link"),
    ).not.toBeInTheDocument();
  });

  it("labels the wormhole-link legend entry differently for route mode", async () => {
    vi.mocked(getUniverseRegionsGraph).mockResolvedValue(graph());
    render(
      <UniverseRegionsDialog mode="route" route={null} onClose={vi.fn()} />,
    );
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Legend" }));

    expect(
      screen.getByText("Wormhole/ansiblex leg used by this route"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Find a route to see which edges it crosses."),
    ).toBeInTheDocument();
  });

  it("fades unrelated nodes when a node is selected, and toggles off on a second click", async () => {
    vi.mocked(getUniverseRegionsGraph).mockResolvedValue(graph());
    const { container } = render(
      <UniverseRegionsDialog
        mode="map"
        systems={[]}
        connections={[]}
        onClose={vi.fn()}
      />,
    );
    await flush();

    const nodeA = container.querySelector('[data-id="10"]') as HTMLElement;
    const nodeB = container.querySelector('[data-id="20"]') as HTMLElement;
    fireEvent.click(nodeA);

    // Region A and Region B are connected by graph()'s one edge, so B stays
    // fully opaque (part of A's ego-network) - only truly unrelated nodes
    // (e.g. the Thera landmark, not linked to anything here) fade.
    const landmarkNode = container.querySelector(
      '[data-id="landmark-31000005"]',
    ) as HTMLElement;
    expect(landmarkNode.style.opacity).toBe("0.15");
    expect(nodeB.style.opacity).toBe("1");

    fireEvent.click(nodeA);
    expect(landmarkNode.style.opacity).toBe("1");
  });

  it("clears node selection on a pane click", async () => {
    vi.mocked(getUniverseRegionsGraph).mockResolvedValue(graph());
    const { container } = render(
      <UniverseRegionsDialog
        mode="map"
        systems={[]}
        connections={[]}
        onClose={vi.fn()}
      />,
    );
    await flush();

    const nodeA = container.querySelector('[data-id="10"]') as HTMLElement;
    fireEvent.click(nodeA);
    const landmarkNode = container.querySelector(
      '[data-id="landmark-31000005"]',
    ) as HTMLElement;
    expect(landmarkNode.style.opacity).toBe("0.15");

    fireEvent.click(container.querySelector(".react-flow__pane")!);
    expect(landmarkNode.style.opacity).toBe("1");
  });
});
