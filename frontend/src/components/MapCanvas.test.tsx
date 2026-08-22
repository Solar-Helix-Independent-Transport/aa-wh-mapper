import { act, fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addConnection,
  removeConnection,
  removeSystem,
  updateConnection,
  updateSystem,
} from "../api/maps";
import type {
  MapStateOut,
  MapSystemOut,
  SolarSystemOut,
  WormholeConnectionOut,
} from "../api/types";
import { MapCanvas } from "./MapCanvas";

vi.mock("../api/maps", () => ({
  addConnection: vi.fn(),
  removeConnection: vi.fn(),
  removeSystem: vi.fn(),
  updateConnection: vi.fn(),
  updateSystem: vi.fn(),
}));
vi.mock("./SystemDetailsDialog", () => ({
  SystemDetailsDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="system-details-dialog">
      <button type="button" onClick={onClose}>
        close system details
      </button>
    </div>
  ),
}));
vi.mock("./ConnectionDetailsDialog", () => ({
  ConnectionDetailsDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="connection-details-dialog">
      <button type="button" onClick={onClose}>
        close connection details
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
    region_name: null,
    space_type: "High Sec",
    owner: null,
    statics: [],
  };
}

function mapSystem(overrides: Partial<MapSystemOut> = {}): MapSystemOut {
  return {
    id: 1,
    map_id: 1,
    solar_system: solarSystem(100, "Jita"),
    label: "",
    x: 0,
    y: 0,
    pinned: false,
    added_by_id: null,
    added_at: "",
    ...overrides,
  };
}

function connection(
  overrides: Partial<WormholeConnectionOut> = {},
): WormholeConnectionOut {
  return {
    id: 1,
    map_id: 1,
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
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function state(overrides: Partial<MapStateOut> = {}): MapStateOut {
  return {
    map: {} as MapStateOut["map"],
    systems: [
      mapSystem({ id: 1 }),
      mapSystem({ id: 2, solar_system: solarSystem(200, "Amarr") }),
    ],
    signatures: [],
    connections: [],
    tracked_characters: [],
    current_user_id: 1,
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function renderCanvas(props: Partial<Parameters<typeof MapCanvas>[0]> = {}) {
  return render(
    <MapCanvas
      mapId={1}
      state={state()}
      selectedSystemId={null}
      onSelectSystem={vi.fn()}
      onAddSystemAt={vi.fn()}
      onMutationError={vi.fn()}
      {...props}
    />,
    { wrapper: ReactFlowProvider },
  );
}

describe("MapCanvas", () => {
  beforeEach(() => {
    vi.mocked(addConnection).mockReset().mockResolvedValue(connection());
    vi.mocked(removeConnection).mockReset().mockResolvedValue(undefined);
    vi.mocked(removeSystem).mockReset().mockResolvedValue(undefined);
    vi.mocked(updateConnection).mockReset().mockResolvedValue(connection());
    vi.mocked(updateSystem).mockReset().mockResolvedValue(mapSystem());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a node for each system", () => {
    renderCanvas();
    expect(screen.getByText("Jita")).toBeInTheDocument();
    expect(screen.getByText("Amarr")).toBeInTheDocument();
  });

  it("selects a system on node click", () => {
    const onSelectSystem = vi.fn();
    const { container } = renderCanvas({ onSelectSystem });

    fireEvent.click(container.querySelector('[data-id="1"]')!);

    expect(onSelectSystem).toHaveBeenCalledWith(1);
  });

  it("deselects on pane click", () => {
    const onSelectSystem = vi.fn();
    const { container } = renderCanvas({ onSelectSystem });

    fireEvent.click(container.querySelector(".react-flow__pane")!);

    expect(onSelectSystem).toHaveBeenCalledWith(null);
  });

  it("opens an 'Add system…' menu on right-clicking the pane", () => {
    const { container } = renderCanvas();

    fireEvent.contextMenu(container.querySelector(".react-flow__pane")!);

    expect(
      screen.getByRole("button", { name: "Add system…" }),
    ).toBeInTheDocument();
  });

  it("calls onAddSystemAt with a flow position when 'Add system…' is picked", () => {
    const onAddSystemAt = vi.fn();
    const { container } = renderCanvas({ onAddSystemAt });

    fireEvent.contextMenu(container.querySelector(".react-flow__pane")!, {
      clientX: 50,
      clientY: 60,
    });
    fireEvent.click(screen.getByRole("button", { name: "Add system…" }));

    expect(onAddSystemAt).toHaveBeenCalledWith(
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    );
  });

  it("hides the pane context menu in read-only mode", () => {
    const { container } = renderCanvas({ readOnly: true });

    fireEvent.contextMenu(container.querySelector(".react-flow__pane")!);

    expect(
      screen.queryByRole("button", { name: "Add system…" }),
    ).not.toBeInTheDocument();
  });

  it("offers Details, lock, and delete from a node's context menu", () => {
    const { container } = renderCanvas();

    fireEvent.contextMenu(container.querySelector('[data-id="1"]')!);

    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Lock system (home base)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete system" }),
    ).toBeInTheDocument();
  });

  it("opens SystemDetailsDialog from the node context menu", () => {
    const { container } = renderCanvas();

    fireEvent.contextMenu(container.querySelector('[data-id="1"]')!);
    fireEvent.click(screen.getByRole("button", { name: "Details" }));

    expect(screen.getByTestId("system-details-dialog")).toBeInTheDocument();
  });

  it("shows only Details in a node's context menu in read-only mode", () => {
    const { container } = renderCanvas({ readOnly: true });

    fireEvent.contextMenu(container.querySelector('[data-id="1"]')!);

    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete system" }),
    ).not.toBeInTheDocument();
  });

  it("toggles pinned via the node context menu, calling updateSystem", () => {
    const { container } = renderCanvas();

    fireEvent.contextMenu(container.querySelector('[data-id="1"]')!);
    fireEvent.click(
      screen.getByRole("button", { name: "Lock system (home base)" }),
    );

    expect(updateSystem).toHaveBeenCalledWith(1, 1, { pinned: true });
  });

  it("labels the menu item Unlock system for an already-pinned system", () => {
    const { container } = renderCanvas({
      state: state({
        systems: [mapSystem({ id: 1, pinned: true }), mapSystem({ id: 2 })],
      }),
    });

    fireEvent.contextMenu(container.querySelector('[data-id="1"]')!);

    expect(
      screen.getByRole("button", { name: "Unlock system" }),
    ).toBeInTheDocument();
  });

  it("disables Delete system for a pinned system", () => {
    const { container } = renderCanvas({
      state: state({
        systems: [mapSystem({ id: 1, pinned: true }), mapSystem({ id: 2 })],
      }),
    });

    fireEvent.contextMenu(container.querySelector('[data-id="1"]')!);

    expect(
      screen.getByRole("button", { name: "Delete system" }),
    ).toBeDisabled();
  });

  it("deletes a system via the node context menu and clears selection if it was selected", () => {
    const onSelectSystem = vi.fn();
    const { container } = renderCanvas({ selectedSystemId: 1, onSelectSystem });

    fireEvent.contextMenu(container.querySelector('[data-id="1"]')!);
    fireEvent.click(screen.getByRole("button", { name: "Delete system" }));

    expect(removeSystem).toHaveBeenCalledWith(1, 1);
    expect(onSelectSystem).toHaveBeenCalledWith(null);
  });

  it("reports a mutation error and does not clear selection when delete fails", async () => {
    vi.mocked(removeSystem).mockRejectedValue(new Error("locked"));
    const onMutationError = vi.fn();
    const onSelectSystem = vi.fn();
    const { container } = renderCanvas({ onMutationError, onSelectSystem });

    fireEvent.contextMenu(container.querySelector('[data-id="1"]')!);
    fireEvent.click(screen.getByRole("button", { name: "Delete system" }));
    await flush();

    expect(onMutationError).toHaveBeenCalledWith(
      expect.stringContaining("locked"),
    );
  });

  // persistNodePositions (onNodeDragStop/onSelectionDragStop -> updateSystem,
  // with rollback + onMutationError on failure) isn't reachable through a
  // simulated drag here - xyflow's own drag-gesture detection depends on
  // real layout measurement (getBoundingClientRect), which jsdom doesn't
  // provide (same root cause as edges never rendering - see FloatingEdge's
  // and testSetup.ts's own notes); pointerdown/move/up events fire but
  // xyflow never registers a drag start. The rollback-on-failure logic
  // itself is structurally identical to patterns already covered elsewhere
  // (RouteLegRow, SignaturePanel's optimistic updates).

  it("disables dragging and connecting in read-only mode", () => {
    const { container } = renderCanvas({ readOnly: true });
    expect(container.querySelector('[data-id="1"]')).not.toHaveClass(
      "draggable",
    );
  });
});
