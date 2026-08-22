import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMapState } from "../api/maps";
import type { MapOut, MapStateOut, WormholeConnectionOut } from "../api/types";
import {
  installFakeWebSocket,
  FakeWebSocket,
} from "../testUtils/fakeWebSocket";
import { MapView } from "./MapView";

vi.mock("../api/maps", () => ({
  getMapState: vi.fn(),
}));

let capturedMapCanvasProps: Record<string, unknown> = {};
vi.mock("./MapCanvas", () => ({
  MapCanvas: (props: Record<string, unknown>) => {
    capturedMapCanvasProps = props;
    return <div data-testid="map-canvas" />;
  },
}));
let capturedSignaturePanelProps: Record<string, unknown> = {};
vi.mock("./SignaturePanel", () => ({
  SignaturePanel: (props: Record<string, unknown>) => {
    capturedSignaturePanelProps = props;
    return <div data-testid="signature-panel" />;
  },
}));
vi.mock("./AddSystemDialog", () => ({
  AddSystemDialog: ({
    onClose,
    onAdded,
  }: {
    onClose: () => void;
    onAdded: () => void;
  }) => (
    <div data-testid="add-system-dialog">
      <button type="button" onClick={onAdded}>
        trigger added
      </button>
      <button type="button" onClick={onClose}>
        close add
      </button>
    </div>
  ),
}));
vi.mock("./ImportRegionDialog", () => ({
  ImportRegionDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="import-region-dialog">
      <button type="button" onClick={onClose}>
        close import region
      </button>
    </div>
  ),
}));
vi.mock("./ImportFromMapDialog", () => ({
  ImportFromMapDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="import-from-map-dialog">
      <button type="button" onClick={onClose}>
        close import from map
      </button>
    </div>
  ),
}));
vi.mock("./ShareDialog", () => ({
  ShareDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="share-dialog">
      <button type="button" onClick={onClose}>
        close share
      </button>
    </div>
  ),
}));
vi.mock("./ConnectionFlagsPanel", () => ({
  ConnectionFlagsPanel: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="flags-panel">
      <button type="button" onClick={onClose}>
        close flags
      </button>
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
vi.mock("./IdentifyJumpSignatureDialog", () => ({
  IdentifyJumpSignatureDialog: ({
    prompt,
    queueLength,
    onClose,
  }: {
    prompt: { connection_id: number };
    queueLength: number;
    onClose: () => void;
  }) => (
    <div data-testid="jump-signature-dialog">
      connection {prompt.connection_id}, queue {queueLength}
      <button type="button" onClick={onClose}>
        close jump prompt
      </button>
    </div>
  ),
}));

function mapOut(overrides: Partial<MapOut> = {}): MapOut {
  return {
    id: 1,
    name: "My Map",
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
    map: mapOut(),
    systems: [],
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

describe("MapView", () => {
  beforeEach(() => {
    installFakeWebSocket();
    vi.mocked(getMapState).mockReset();
    capturedMapCanvasProps = {};
    capturedSignaturePanelProps = {};
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a loading state before the map arrives", () => {
    vi.mocked(getMapState).mockReturnValue(new Promise(() => {}));
    render(<MapView mapId={1} />, { wrapper: MemoryRouter });
    expect(screen.getByText("Loading map…")).toBeInTheDocument();
  });

  it("shows an error message on fetch failure", async () => {
    vi.mocked(getMapState).mockRejectedValue(new Error("not found"));
    render(<MapView mapId={1} />, { wrapper: MemoryRouter });
    await flush();
    expect(screen.getByText(/not found/)).toBeInTheDocument();
  });

  it("renders the map's name, canvas, and signature panel once loaded", async () => {
    vi.mocked(getMapState).mockResolvedValue(
      state({ map: mapOut({ name: "Thera Hub" }) }),
    );
    render(<MapView mapId={1} />, { wrapper: MemoryRouter });
    await flush();

    expect(
      screen.getByRole("heading", { name: "Thera Hub" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("map-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("signature-panel")).toBeInTheDocument();
  });

  it("shows + Add system for a writable map, opens the dialog, and refreshes on add", async () => {
    vi.mocked(getMapState).mockResolvedValue(state());
    render(<MapView mapId={1} />, { wrapper: MemoryRouter });
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "+ Add system" }));
    expect(screen.getByTestId("add-system-dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "trigger added" }));
    await flush();

    expect(getMapState).toHaveBeenCalledTimes(2);
  });

  it("hides + Add system for a read-only map", async () => {
    vi.mocked(getMapState).mockResolvedValue(
      state({ map: mapOut({ can_write: false }) }),
    );
    render(<MapView mapId={1} />, { wrapper: MemoryRouter });
    await flush();

    expect(
      screen.queryByRole("button", { name: "+ Add system" }),
    ).not.toBeInTheDocument();
    expect(capturedMapCanvasProps.readOnly).toBe(true);
    expect(capturedSignaturePanelProps.readOnly).toBe(true);
  });

  it("opens the universe dialog", async () => {
    vi.mocked(getMapState).mockResolvedValue(state());
    render(<MapView mapId={1} />, { wrapper: MemoryRouter });
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Universe" }));
    expect(screen.getByTestId("universe-dialog")).toBeInTheDocument();
  });

  it("always offers Flags in the overflow menu, even read-only", async () => {
    vi.mocked(getMapState).mockResolvedValue(
      state({ map: mapOut({ can_write: false }) }),
    );
    render(<MapView mapId={1} />, { wrapper: MemoryRouter });
    await flush();

    fireEvent.click(screen.getByTitle("More actions"));
    fireEvent.click(screen.getByRole("button", { name: "Flags" }));
    expect(screen.getByTestId("flags-panel")).toBeInTheDocument();
  });

  it("offers Import region only for an empty, writable map", async () => {
    vi.mocked(getMapState).mockResolvedValue(state({ systems: [] }));
    render(<MapView mapId={1} />, { wrapper: MemoryRouter });
    await flush();
    fireEvent.click(screen.getByTitle("More actions"));
    expect(
      screen.getByRole("button", { name: "Import region" }),
    ).toBeInTheDocument();
  });

  it("hides Import region once the map has systems", async () => {
    vi.mocked(getMapState).mockResolvedValue(
      state({
        systems: [
          {
            id: 1,
            map_id: 1,
            solar_system: {
              id: 100,
              name: "Jita",
              security_status: 0.9,
              wormhole_class_id: null,
              visual_effect: null,
              constellation_name: null,
              region_name: null,
              space_type: "High Sec",
              owner: null,
              statics: [],
            },
            label: "",
            x: 0,
            y: 0,
            pinned: false,
            added_by_id: null,
            added_at: "",
          },
        ],
      }),
    );
    render(<MapView mapId={1} />, { wrapper: MemoryRouter });
    await flush();
    fireEvent.click(screen.getByTitle("More actions"));
    expect(
      screen.queryByRole("button", { name: "Import region" }),
    ).not.toBeInTheDocument();
  });

  it("hides write-gated overflow items for a read-only map", async () => {
    vi.mocked(getMapState).mockResolvedValue(
      state({ map: mapOut({ can_write: false }) }),
    );
    render(<MapView mapId={1} />, { wrapper: MemoryRouter });
    await flush();
    fireEvent.click(screen.getByTitle("More actions"));

    expect(
      screen.queryByRole("button", { name: "Import region" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Import from reference map…" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Share" }),
    ).not.toBeInTheDocument();
  });

  it("opens Import from reference map and Share for a writable map", async () => {
    vi.mocked(getMapState).mockResolvedValue(state());
    render(<MapView mapId={1} />, { wrapper: MemoryRouter });
    await flush();
    fireEvent.click(screen.getByTitle("More actions"));
    fireEvent.click(
      screen.getByRole("button", { name: "Import from reference map…" }),
    );
    expect(screen.getByTestId("import-from-map-dialog")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "close import from map" }),
    );

    fireEvent.click(screen.getByTitle("More actions"));
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(screen.getByTestId("share-dialog")).toBeInTheDocument();
  });

  it("shows Pending signatures with a count only when unlinked wormhole connections exist", async () => {
    vi.mocked(getMapState).mockResolvedValue(
      state({
        connections: [
          connection({
            id: 1,
            top_signature_id: null,
            bottom_signature_id: null,
          }),
          connection({ id: 2, top_signature_id: 5, bottom_signature_id: null }),
        ],
      }),
    );
    render(<MapView mapId={1} />, { wrapper: MemoryRouter });
    await flush();
    fireEvent.click(screen.getByTitle("More actions"));

    expect(
      screen.getByRole("button", { name: "Pending signatures (1)" }),
    ).toBeInTheDocument();
  });

  it("resyncs the full state on a map.resync socket event", async () => {
    vi.mocked(getMapState).mockResolvedValue(state());
    render(<MapView mapId={1} />, { wrapper: MemoryRouter });
    await flush();
    expect(getMapState).toHaveBeenCalledTimes(1);

    FakeWebSocket.instances[0].triggerMessage({
      event: "map.resync",
      data: {},
    });
    await flush();

    expect(getMapState).toHaveBeenCalledTimes(2);
  });

  it("applies a delta socket event without a full refetch", async () => {
    vi.mocked(getMapState).mockResolvedValue(state());
    render(<MapView mapId={1} />, { wrapper: MemoryRouter });
    await flush();

    FakeWebSocket.instances[0].triggerMessage({
      event: "connection.added",
      data: connection({ id: 99 }),
    });
    await flush();

    expect(getMapState).toHaveBeenCalledTimes(1);
    expect(
      (capturedMapCanvasProps.state as MapStateOut).connections,
    ).toHaveLength(1);
  });

  it("queues a jump-needs-signature prompt and opens the dialog", async () => {
    // activeJumpPrompt only surfaces a queued prompt whose connection still
    // has no signature on either end - the fixture needs a matching
    // connection row for the dialog to actually appear.
    vi.mocked(getMapState).mockResolvedValue(
      state({
        connections: [
          connection({
            id: 5,
            top_signature_id: null,
            bottom_signature_id: null,
          }),
        ],
      }),
    );
    render(<MapView mapId={1} />, { wrapper: MemoryRouter });
    await flush();

    FakeWebSocket.instances[0].triggerMessage({
      event: "character.jump_needs_signature",
      data: {
        connection_id: 5,
        character_name: "Alice",
        old_map_system_id: 1,
        new_map_system_id: 2,
      },
    });
    await flush();

    expect(screen.getByTestId("jump-signature-dialog")).toHaveTextContent(
      "connection 5, queue 1",
    );
  });

  it("does not queue the same connection's prompt twice", async () => {
    vi.mocked(getMapState).mockResolvedValue(
      state({
        connections: [
          connection({
            id: 5,
            top_signature_id: null,
            bottom_signature_id: null,
          }),
        ],
      }),
    );
    render(<MapView mapId={1} />, { wrapper: MemoryRouter });
    await flush();

    const payload = {
      connection_id: 5,
      character_name: "Alice",
      old_map_system_id: 1,
      new_map_system_id: 2,
    };
    FakeWebSocket.instances[0].triggerMessage({
      event: "character.jump_needs_signature",
      data: payload,
    });
    FakeWebSocket.instances[0].triggerMessage({
      event: "character.jump_needs_signature",
      data: payload,
    });
    await flush();

    expect(screen.getByTestId("jump-signature-dialog")).toHaveTextContent(
      "queue 1",
    );
  });

  it("moves to the next queued prompt when the current one is dismissed", async () => {
    vi.mocked(getMapState).mockResolvedValue(
      state({
        connections: [
          connection({
            id: 5,
            top_signature_id: null,
            bottom_signature_id: null,
          }),
          connection({
            id: 6,
            top_signature_id: null,
            bottom_signature_id: null,
          }),
        ],
      }),
    );
    render(<MapView mapId={1} />, { wrapper: MemoryRouter });
    await flush();

    FakeWebSocket.instances[0].triggerMessage({
      event: "character.jump_needs_signature",
      data: {
        connection_id: 5,
        character_name: "Alice",
        old_map_system_id: 1,
        new_map_system_id: 2,
      },
    });
    FakeWebSocket.instances[0].triggerMessage({
      event: "character.jump_needs_signature",
      data: {
        connection_id: 6,
        character_name: "Bob",
        old_map_system_id: 2,
        new_map_system_id: 3,
      },
    });
    await flush();
    expect(screen.getByTestId("jump-signature-dialog")).toHaveTextContent(
      "connection 5, queue 2",
    );

    fireEvent.click(screen.getByRole("button", { name: "close jump prompt" }));
    expect(screen.getByTestId("jump-signature-dialog")).toHaveTextContent(
      "connection 6, queue 1",
    );
  });

  it("re-queues pending signature connections via 'Pending signatures'", async () => {
    vi.mocked(getMapState).mockResolvedValue(
      state({
        connections: [
          connection({
            id: 7,
            top_system_id: 1,
            bottom_system_id: 2,
            top_signature_id: null,
            bottom_signature_id: null,
          }),
        ],
      }),
    );
    render(<MapView mapId={1} />, { wrapper: MemoryRouter });
    await flush();

    fireEvent.click(screen.getByTitle("More actions"));
    fireEvent.click(
      screen.getByRole("button", { name: "Pending signatures (1)" }),
    );

    expect(screen.getByTestId("jump-signature-dialog")).toHaveTextContent(
      "connection 7, queue 1",
    );
  });

  it("shows a dismissible error toast on a mutation error, and triggers a refresh", async () => {
    vi.mocked(getMapState).mockResolvedValue(state());
    render(<MapView mapId={1} />, { wrapper: MemoryRouter });
    await flush();

    (capturedMapCanvasProps.onMutationError as (msg: string) => void)(
      "save failed",
    );
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent("save failed");
    expect(getMapState).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("optimistically merges a system created via the signature panel", async () => {
    vi.mocked(getMapState).mockResolvedValue(state());
    render(<MapView mapId={1} />, { wrapper: MemoryRouter });
    await flush();

    const newSystem = {
      id: 42,
      map_id: 1,
      solar_system: {
        id: 500,
        name: "Amarr",
        security_status: 0.9,
        wormhole_class_id: null,
        visual_effect: null,
        constellation_name: null,
        region_name: null,
        space_type: "High Sec",
        owner: null,
        statics: [],
      },
      label: "",
      x: 0,
      y: 0,
      pinned: false,
      added_by_id: null,
      added_at: "",
    };
    (capturedSignaturePanelProps.onSystemCreated as (s: unknown) => void)(
      newSystem,
    );
    await flush();

    expect((capturedMapCanvasProps.state as MapStateOut).systems).toHaveLength(
      1,
    );
  });
});
