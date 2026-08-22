import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptConnectionFlag,
  dismissConnectionFlag,
  listConnectionFlags,
} from "../api/route";
import type { MapSystemOut, WormholeConnectionOut } from "../api/types";
import { ConnectionFlagsPanel } from "./ConnectionFlagsPanel";

vi.mock("../api/route", () => ({
  listConnectionFlags: vi.fn(),
  acceptConnectionFlag: vi.fn(),
  dismissConnectionFlag: vi.fn(),
}));

function mapSystem(id: number, name: string): MapSystemOut {
  return {
    id,
    map_id: 1,
    solar_system: {
      id: id * 100,
      name,
      security_status: 0.5,
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

function flag(
  overrides: Partial<{
    id: number;
    connection_id: number;
    flagged_by_id: number;
    flagged_by_name: string;
    suggested_life_status: string | null;
    suggested_mass_status: string | null;
    suggests_collapsed: boolean;
    created_at: string;
  }> = {},
) {
  return {
    id: 1,
    connection_id: 1,
    flagged_by_id: 1,
    flagged_by_name: "Bob",
    suggested_life_status: null,
    suggested_mass_status: null,
    suggests_collapsed: false,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

const systems = [mapSystem(1, "Jita"), mapSystem(2, "Amarr")];
const connections = [
  connection({ id: 1, top_system_id: 1, bottom_system_id: 2 }),
];

describe("ConnectionFlagsPanel", () => {
  beforeEach(() => {
    vi.mocked(listConnectionFlags).mockReset();
    vi.mocked(acceptConnectionFlag).mockReset();
    vi.mocked(dismissConnectionFlag).mockReset();
  });

  it("shows a loading state before flags arrive", () => {
    vi.mocked(listConnectionFlags).mockReturnValue(new Promise(() => {}));
    render(
      <ConnectionFlagsPanel
        mapId={1}
        systems={systems}
        connections={connections}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows a message when no connections have pending flags", async () => {
    vi.mocked(listConnectionFlags).mockResolvedValue([]);
    render(
      <ConnectionFlagsPanel
        mapId={1}
        systems={systems}
        connections={connections}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    await flush();
    expect(screen.getByText("No pending flags.")).toBeInTheDocument();
  });

  it("groups flags under their connection's system names", async () => {
    vi.mocked(listConnectionFlags).mockResolvedValue([flag()]);
    render(
      <ConnectionFlagsPanel
        mapId={1}
        systems={systems}
        connections={connections}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    await flush();

    expect(screen.getByText("Jita ↔ Amarr")).toBeInTheDocument();
  });

  it("shows an unknown system as '?' when it isn't in the systems list", async () => {
    vi.mocked(listConnectionFlags).mockResolvedValue([flag()]);
    render(
      <ConnectionFlagsPanel
        mapId={1}
        systems={[mapSystem(1, "Jita")]}
        connections={connections}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    await flush();

    expect(screen.getByText("Jita ↔ ?")).toBeInTheDocument();
  });

  it("summarizes a suggests_collapsed flag", async () => {
    vi.mocked(listConnectionFlags).mockResolvedValue([
      flag({ suggests_collapsed: true }),
    ]);
    render(
      <ConnectionFlagsPanel
        mapId={1}
        systems={systems}
        connections={connections}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    await flush();

    expect(screen.getByText(/Bob suggests: collapsed/)).toBeInTheDocument();
  });

  it("summarizes a life/mass status suggestion", async () => {
    vi.mocked(listConnectionFlags).mockResolvedValue([
      flag({
        suggested_life_status: "lt_1h",
        suggested_mass_status: "critical",
      }),
    ]);
    render(
      <ConnectionFlagsPanel
        mapId={1}
        systems={systems}
        connections={connections}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    await flush();

    expect(
      screen.getByText(/Bob suggests: life: lt_1h, mass: critical/),
    ).toBeInTheDocument();
  });

  it("accepts a flag, refreshes, and notifies the caller of the change", async () => {
    vi.mocked(listConnectionFlags)
      .mockResolvedValueOnce([flag()])
      .mockResolvedValueOnce([]);
    vi.mocked(acceptConnectionFlag).mockResolvedValue({} as never);
    const onChanged = vi.fn();
    render(
      <ConnectionFlagsPanel
        mapId={1}
        systems={systems}
        connections={connections}
        onClose={vi.fn()}
        onChanged={onChanged}
      />,
    );
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await flush();

    expect(acceptConnectionFlag).toHaveBeenCalledWith(1, 1, 1);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByText("No pending flags.")).toBeInTheDocument();
  });

  it("dismisses a flag and refreshes without notifying the caller", async () => {
    vi.mocked(listConnectionFlags)
      .mockResolvedValueOnce([flag()])
      .mockResolvedValueOnce([]);
    vi.mocked(dismissConnectionFlag).mockResolvedValue(undefined);
    const onChanged = vi.fn();
    render(
      <ConnectionFlagsPanel
        mapId={1}
        systems={systems}
        connections={connections}
        onClose={vi.fn()}
        onChanged={onChanged}
      />,
    );
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await flush();

    expect(dismissConnectionFlag).toHaveBeenCalledWith(1, 1, 1);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("disables Accept/Dismiss when readOnly", async () => {
    vi.mocked(listConnectionFlags).mockResolvedValue([flag()]);
    render(
      <ConnectionFlagsPanel
        mapId={1}
        systems={systems}
        connections={connections}
        onClose={vi.fn()}
        onChanged={vi.fn()}
        readOnly
      />,
    );
    await flush();

    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeDisabled();
  });

  it("shows an error message when refreshing fails", async () => {
    vi.mocked(listConnectionFlags).mockRejectedValue(new Error("network down"));
    render(
      <ConnectionFlagsPanel
        mapId={1}
        systems={systems}
        connections={connections}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    await flush();

    expect(screen.getByText(/network down/)).toBeInTheDocument();
  });

  it("calls onClose when the dialog is closed", async () => {
    vi.mocked(listConnectionFlags).mockResolvedValue([]);
    const onClose = vi.fn();
    render(
      <ConnectionFlagsPanel
        mapId={1}
        systems={systems}
        connections={connections}
        onClose={onClose}
        onChanged={vi.fn()}
      />,
    );
    await flush();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
