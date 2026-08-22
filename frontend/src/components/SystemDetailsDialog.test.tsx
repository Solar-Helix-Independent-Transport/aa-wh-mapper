import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSystemDetails } from "../api/maps";
import type {
  MapSystemOut,
  SolarSystemOut,
  WormholeConnectionOut,
} from "../api/types";
import { SystemDetailsDialog } from "./SystemDetailsDialog";

vi.mock("../api/maps", () => ({
  getSystemDetails: vi.fn(),
}));

function solarSystem(overrides: Partial<SolarSystemOut> = {}): SolarSystemOut {
  return {
    id: 100,
    name: "Jita",
    security_status: 0.9,
    wormhole_class_id: null,
    visual_effect: null,
    constellation_name: "Kimotoro",
    region_name: "The Forge",
    space_type: "High Sec",
    owner: null,
    statics: [],
    ...overrides,
  };
}

function mapSystem(overrides: Partial<MapSystemOut> = {}): MapSystemOut {
  return {
    id: 1,
    map_id: 1,
    solar_system: solarSystem(),
    label: "",
    x: 0,
    y: 0,
    pinned: false,
    added_by_id: null,
    added_at: "2026-01-01T00:00:00Z",
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
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("SystemDetailsDialog", () => {
  beforeEach(() => {
    vi.mocked(getSystemDetails).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("titles the dialog with the system's custom label when set", () => {
    vi.mocked(getSystemDetails).mockReturnValue(new Promise(() => {}));
    render(
      <SystemDetailsDialog
        mapId={1}
        system={mapSystem({ label: "Home" })}
        characters={[]}
        connections={[]}
        allSystems={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument();
  });

  it("falls back to the solar system's real name with no custom label", () => {
    vi.mocked(getSystemDetails).mockReturnValue(new Promise(() => {}));
    render(
      <SystemDetailsDialog
        mapId={1}
        system={mapSystem()}
        characters={[]}
        connections={[]}
        allSystems={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Jita" })).toBeInTheDocument();
  });

  it("shows a wormhole class label instead of the plain space type", () => {
    vi.mocked(getSystemDetails).mockReturnValue(new Promise(() => {}));
    render(
      <SystemDetailsDialog
        mapId={1}
        system={mapSystem({
          solar_system: solarSystem({
            space_type: "Wormhole",
            wormhole_class_id: 3,
          }),
        })}
        characters={[]}
        connections={[]}
        allSystems={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("C3")).toBeInTheDocument();
  });

  it("shows the plain space type for k-space", () => {
    vi.mocked(getSystemDetails).mockReturnValue(new Promise(() => {}));
    render(
      <SystemDetailsDialog
        mapId={1}
        system={mapSystem()}
        characters={[]}
        connections={[]}
        allSystems={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("High Sec")).toBeInTheDocument();
  });

  it("hides the security row for a null security status", () => {
    vi.mocked(getSystemDetails).mockReturnValue(new Promise(() => {}));
    render(
      <SystemDetailsDialog
        mapId={1}
        system={mapSystem({
          solar_system: solarSystem({ security_status: null }),
        })}
        characters={[]}
        connections={[]}
        allSystems={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("Security")).not.toBeInTheDocument();
  });

  it("joins constellation and region into the location row", () => {
    vi.mocked(getSystemDetails).mockReturnValue(new Promise(() => {}));
    render(
      <SystemDetailsDialog
        mapId={1}
        system={mapSystem()}
        characters={[]}
        connections={[]}
        allSystems={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Kimotoro · The Forge")).toBeInTheDocument();
  });

  it("shows sovereignty with a ticker when the system has an owner", () => {
    vi.mocked(getSystemDetails).mockReturnValue(new Promise(() => {}));
    render(
      <SystemDetailsDialog
        mapId={1}
        system={mapSystem({
          solar_system: solarSystem({
            owner: {
              type: "alliance",
              id: 1,
              name: "Test Alliance",
              ticker: "TEST",
              icon_url: "",
            },
          }),
        })}
        characters={[]}
        connections={[]}
        allSystems={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Test Alliance [TEST]")).toBeInTheDocument();
  });

  it("shows 'Yes (home base)' for a pinned system, 'No' otherwise", () => {
    vi.mocked(getSystemDetails).mockReturnValue(new Promise(() => {}));
    const { rerender } = render(
      <SystemDetailsDialog
        mapId={1}
        system={mapSystem({ pinned: false })}
        characters={[]}
        connections={[]}
        allSystems={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("No")).toBeInTheDocument();

    rerender(
      <SystemDetailsDialog
        mapId={1}
        system={mapSystem({ pinned: true })}
        characters={[]}
        connections={[]}
        allSystems={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Yes (home base)")).toBeInTheDocument();
  });

  it("resolves added_by_name once details arrive", async () => {
    vi.mocked(getSystemDetails).mockResolvedValue({ added_by_name: "Alice" });
    render(
      <SystemDetailsDialog
        mapId={1}
        system={mapSystem()}
        characters={[]}
        connections={[]}
        allSystems={[]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Added").nextSibling).toHaveTextContent(/^…/);
    await flush();
    expect(screen.getByText("Added").nextSibling).toHaveTextContent(/^Alice/);
  });

  it("shows 'Unknown' for a system with no resolvable adder", async () => {
    vi.mocked(getSystemDetails).mockResolvedValue({ added_by_name: null });
    render(
      <SystemDetailsDialog
        mapId={1}
        system={mapSystem()}
        characters={[]}
        connections={[]}
        allSystems={[]}
        onClose={vi.fn()}
      />,
    );
    await flush();
    expect(screen.getByText("Added").nextSibling).toHaveTextContent(/^Unknown/);
  });

  it("shows a message when no characters are present", () => {
    vi.mocked(getSystemDetails).mockReturnValue(new Promise(() => {}));
    render(
      <SystemDetailsDialog
        mapId={1}
        system={mapSystem()}
        characters={[]}
        connections={[]}
        allSystems={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("No tracked characters here.")).toBeInTheDocument();
  });

  it("lists present characters, marking the viewer's own", () => {
    vi.mocked(getSystemDetails).mockReturnValue(new Promise(() => {}));
    render(
      <SystemDetailsDialog
        mapId={1}
        system={mapSystem()}
        characters={[
          { name: "Alice", isOwn: true },
          { name: "Bob", isOwn: false },
        ]}
        connections={[]}
        allSystems={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Alice").nextSibling).toHaveTextContent("(you)");
    expect(screen.getByText("Bob").nextSibling).toBeNull();
  });

  it("shows a message when there are no connections", () => {
    vi.mocked(getSystemDetails).mockReturnValue(new Promise(() => {}));
    render(
      <SystemDetailsDialog
        mapId={1}
        system={mapSystem()}
        characters={[]}
        connections={[]}
        allSystems={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("No connections yet.")).toBeInTheDocument();
  });

  it("resolves the other end of each connection by whichever id isn't this system's", () => {
    vi.mocked(getSystemDetails).mockReturnValue(new Promise(() => {}));
    const thisSystem = mapSystem({ id: 1 });
    const otherSystem = mapSystem({
      id: 2,
      solar_system: solarSystem({ name: "Amarr" }),
    });
    render(
      <SystemDetailsDialog
        mapId={1}
        system={thisSystem}
        characters={[]}
        connections={[
          connection({
            top_system_id: 1,
            bottom_system_id: 2,
            connection_type: "stargate",
          }),
        ]}
        allSystems={[thisSystem, otherSystem]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Amarr")).toBeInTheDocument();
    expect(screen.getByText("Stargate")).toBeInTheDocument();
  });

  it("shows '?' when the other end's system can't be resolved", () => {
    vi.mocked(getSystemDetails).mockReturnValue(new Promise(() => {}));
    const thisSystem = mapSystem({ id: 1 });
    render(
      <SystemDetailsDialog
        mapId={1}
        system={thisSystem}
        characters={[]}
        connections={[connection({ top_system_id: 1, bottom_system_id: 999 })]}
        allSystems={[thisSystem]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("shows an error message when fetching details fails", async () => {
    vi.mocked(getSystemDetails).mockRejectedValue(new Error("not found"));
    render(
      <SystemDetailsDialog
        mapId={1}
        system={mapSystem()}
        characters={[]}
        connections={[]}
        allSystems={[]}
        onClose={vi.fn()}
      />,
    );
    await flush();
    expect(screen.getByText(/not found/)).toBeInTheDocument();
  });

  it("calls onClose on Close", () => {
    vi.mocked(getSystemDetails).mockReturnValue(new Promise(() => {}));
    const onClose = vi.fn();
    render(
      <SystemDetailsDialog
        mapId={1}
        system={mapSystem()}
        characters={[]}
        connections={[]}
        allSystems={[]}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
