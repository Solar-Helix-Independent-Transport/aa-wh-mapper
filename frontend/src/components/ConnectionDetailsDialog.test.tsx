import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConnectionDetails } from "../api/maps";
import type { SignatureOut, WormholeConnectionOut } from "../api/types";
import { ConnectionDetailsDialog } from "./ConnectionDetailsDialog";

vi.mock("../api/maps", () => ({
  getConnectionDetails: vi.fn(),
}));

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
    mass_status: "fresh",
    ship_size_limit: "large",
    time_status: "green",
    created_by_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T01:00:00Z",
    ...overrides,
  };
}

function signature(overrides: Partial<SignatureOut> = {}): SignatureOut {
  return {
    id: 1,
    map_system_id: 1,
    signature_id: "ABC-123",
    sig_type: "wormhole",
    wormhole_type: null,
    life_status: "stable",
    life_status_marked_at: null,
    is_hidden: false,
    updated_by_id: null,
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("ConnectionDetailsDialog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    vi.mocked(getConnectionDetails).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("titles the dialog with both system names", async () => {
    vi.mocked(getConnectionDetails).mockReturnValue(new Promise(() => {}));
    render(
      <ConnectionDetailsDialog
        mapId={1}
        connection={connection()}
        topSystemName="Jita"
        bottomSystemName="Amarr"
        signatures={[]}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Jita ↔ Amarr" }),
    ).toBeInTheDocument();
  });

  it("shows the wormhole-only fields for a wormhole connection", async () => {
    vi.mocked(getConnectionDetails).mockReturnValue(new Promise(() => {}));
    render(
      <ConnectionDetailsDialog
        mapId={1}
        connection={connection()}
        topSystemName="Jita"
        bottomSystemName="Amarr"
        signatures={[]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("fresh")).toBeInTheDocument();
    expect(screen.getByText("L")).toBeInTheDocument();
    expect(screen.getByText("green")).toBeInTheDocument();
  });

  it("hides the wormhole-only fields for a stargate connection", async () => {
    vi.mocked(getConnectionDetails).mockReturnValue(new Promise(() => {}));
    render(
      <ConnectionDetailsDialog
        mapId={1}
        connection={connection({ connection_type: "stargate" })}
        topSystemName="Jita"
        bottomSystemName="Amarr"
        signatures={[]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Stargate")).toBeInTheDocument();
    expect(screen.queryByText("Mass")).not.toBeInTheDocument();
    expect(screen.queryByText("Ship size")).not.toBeInTheDocument();
  });

  it("labels an ansiblex connection as a jump bridge", async () => {
    vi.mocked(getConnectionDetails).mockReturnValue(new Promise(() => {}));
    render(
      <ConnectionDetailsDialog
        mapId={1}
        connection={connection({ connection_type: "ansiblex" })}
        topSystemName="Jita"
        bottomSystemName="Amarr"
        signatures={[]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Jump bridge")).toBeInTheDocument();
  });

  it("annotates the life status with when it was manually marked", async () => {
    vi.mocked(getConnectionDetails).mockReturnValue(new Promise(() => {}));
    render(
      <ConnectionDetailsDialog
        mapId={1}
        connection={connection({
          life_status_marked_at: "2026-01-01T22:00:00Z",
        })}
        topSystemName="Jita"
        bottomSystemName="Amarr"
        signatures={[]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/marked 2h ago/)).toBeInTheDocument();
  });

  it("shows '…' for Created before details arrive, then the creator's name", async () => {
    vi.mocked(getConnectionDetails).mockResolvedValue({
      created_by_name: "Bob",
      contributions: [],
    });
    render(
      <ConnectionDetailsDialog
        mapId={1}
        connection={connection()}
        topSystemName="Jita"
        bottomSystemName="Amarr"
        signatures={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Created").nextSibling).toHaveTextContent(
      "… · 1d ago",
    );

    await flush();
    expect(screen.getByText("Created").nextSibling).toHaveTextContent(
      "Bob · 1d ago",
    );
  });

  it("shows 'Unknown' when the creator couldn't be resolved", async () => {
    vi.mocked(getConnectionDetails).mockResolvedValue({
      created_by_name: null,
      contributions: [],
    });
    render(
      <ConnectionDetailsDialog
        mapId={1}
        connection={connection()}
        topSystemName="Jita"
        bottomSystemName="Amarr"
        signatures={[]}
        onClose={vi.fn()}
      />,
    );
    await flush();

    expect(screen.getByText(/Unknown/)).toBeInTheDocument();
  });

  it("renders signature summaries for both ends when present", async () => {
    vi.mocked(getConnectionDetails).mockReturnValue(new Promise(() => {}));
    render(
      <ConnectionDetailsDialog
        mapId={1}
        connection={connection({
          top_signature: signature({ signature_id: "TOP-111" }),
          bottom_signature: signature({ signature_id: "BOT-222" }),
        })}
        topSystemName="Jita"
        bottomSystemName="Amarr"
        signatures={[]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("TOP-111")).toBeInTheDocument();
    expect(screen.getByText("BOT-222")).toBeInTheDocument();
  });

  it("hides the signatures section entirely when neither end has one", async () => {
    vi.mocked(getConnectionDetails).mockReturnValue(new Promise(() => {}));
    render(
      <ConnectionDetailsDialog
        mapId={1}
        connection={connection()}
        topSystemName="Jita"
        bottomSystemName="Amarr"
        signatures={[]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByText("Signatures")).not.toBeInTheDocument();
  });

  it("shows a loading state for contribution history before details arrive", () => {
    vi.mocked(getConnectionDetails).mockReturnValue(new Promise(() => {}));
    render(
      <ConnectionDetailsDialog
        mapId={1}
        connection={connection()}
        topSystemName="Jita"
        bottomSystemName="Amarr"
        signatures={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows a message when there are no recorded contributions", async () => {
    vi.mocked(getConnectionDetails).mockResolvedValue({
      created_by_name: "Bob",
      contributions: [],
    });
    render(
      <ConnectionDetailsDialog
        mapId={1}
        connection={connection()}
        topSystemName="Jita"
        bottomSystemName="Amarr"
        signatures={[]}
        onClose={vi.fn()}
      />,
    );
    await flush();

    expect(
      screen.getByText("No recorded contributions yet."),
    ).toBeInTheDocument();
  });

  it("lists contributions with a human-readable verb label", async () => {
    vi.mocked(getConnectionDetails).mockResolvedValue({
      created_by_name: "Bob",
      contributions: [
        {
          id: 1,
          verb: "added",
          character_id: 1,
          name: "Bob",
          created_at: "2026-01-01T23:00:00Z",
        },
        {
          id: 2,
          verb: "signature_linked",
          character_id: 2,
          name: "Carol",
          created_at: "2026-01-01T23:00:00Z",
        },
      ],
    });
    render(
      <ConnectionDetailsDialog
        mapId={1}
        connection={connection()}
        topSystemName="Jita"
        bottomSystemName="Amarr"
        signatures={[]}
        onClose={vi.fn()}
      />,
    );
    await flush();

    expect(screen.getByText("Added connection")).toBeInTheDocument();
    expect(screen.getByText("Linked signature")).toBeInTheDocument();
  });

  it("shows an error message when fetching details fails", async () => {
    vi.mocked(getConnectionDetails).mockRejectedValue(new Error("not found"));
    render(
      <ConnectionDetailsDialog
        mapId={1}
        connection={connection()}
        topSystemName="Jita"
        bottomSystemName="Amarr"
        signatures={[]}
        onClose={vi.fn()}
      />,
    );
    await flush();

    expect(screen.getByText(/not found/)).toBeInTheDocument();
  });

  it("calls onClose on Close", () => {
    vi.mocked(getConnectionDetails).mockReturnValue(new Promise(() => {}));
    const onClose = vi.fn();
    render(
      <ConnectionDetailsDialog
        mapId={1}
        connection={connection()}
        topSystemName="Jita"
        bottomSystemName="Amarr"
        signatures={[]}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
