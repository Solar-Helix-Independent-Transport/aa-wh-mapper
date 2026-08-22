import { act, fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addSignature,
  bulkUpsertSignatures,
  linkConnectionSignature,
  listWormholeTypes,
  removeConnection,
  removeSignature,
  removeSystem,
  updateConnection,
  updateSignature,
  updateSystem,
} from "../api/maps";
import type {
  MapStateOut,
  MapSystemOut,
  SignatureOut,
  SolarSystemOut,
  WormholeConnectionOut,
} from "../api/types";
import { SignaturePanel } from "./SignaturePanel";

vi.mock("../api/maps", () => ({
  addSignature: vi.fn(),
  bulkUpsertSignatures: vi.fn(),
  linkConnectionSignature: vi.fn(),
  listWormholeTypes: vi.fn(),
  removeConnection: vi.fn(),
  removeSignature: vi.fn(),
  removeSystem: vi.fn(),
  updateConnection: vi.fn(),
  updateSignature: vi.fn(),
  updateSystem: vi.fn(),
}));
vi.mock("./ConnectSignatureDialog", () => ({
  ConnectSignatureDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="connect-signature-dialog">
      <button type="button" onClick={onClose}>
        close connect dialog
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
    added_at: "2026-01-01T00:00:00Z",
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

function renderPanel(
  props: Partial<Parameters<typeof SignaturePanel>[0]> = {},
) {
  return render(
    <SignaturePanel
      mapId={1}
      state={state()}
      systemId={1}
      onClose={vi.fn()}
      onSelectSystem={vi.fn()}
      onSystemCreated={vi.fn()}
      {...props}
    />,
    { wrapper: ReactFlowProvider },
  );
}

describe("SignaturePanel", () => {
  beforeEach(() => {
    vi.mocked(listWormholeTypes).mockReset().mockResolvedValue([]);
    vi.mocked(addSignature).mockReset().mockResolvedValue(signature());
    vi.mocked(bulkUpsertSignatures).mockReset().mockResolvedValue({
      signatures: [],
      removed_signature_ids: [],
      removed_connection_ids: [],
      removed_system_ids: [],
    });
    vi.mocked(linkConnectionSignature)
      .mockReset()
      .mockResolvedValue(connection());
    vi.mocked(removeConnection).mockReset().mockResolvedValue(undefined);
    vi.mocked(removeSignature).mockReset().mockResolvedValue(undefined);
    vi.mocked(removeSystem).mockReset().mockResolvedValue(undefined);
    vi.mocked(updateConnection).mockReset().mockResolvedValue(connection());
    vi.mocked(updateSignature).mockReset().mockResolvedValue(signature());
    vi.mocked(updateSystem).mockReset().mockResolvedValue(mapSystem());
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:10:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows a placeholder message when no system is selected", async () => {
    renderPanel({ systemId: null });
    await flush();
    expect(
      screen.getByText("Select a system for details."),
    ).toBeInTheDocument();
  });

  it("titles the panel with the system's custom label, falling back to its real name", async () => {
    renderPanel({
      state: state({ systems: [mapSystem({ id: 1, label: "Home" })] }),
    });
    await flush();
    expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument();
  });

  it("selects a matching system via the finder and clears the query", async () => {
    const onSelectSystem = vi.fn();
    renderPanel({ onSelectSystem });
    await flush();

    fireEvent.change(screen.getByPlaceholderText("Find a system…"), {
      target: { value: "Amarr" },
    });

    expect(onSelectSystem).toHaveBeenCalledWith(2);
    expect(screen.getByPlaceholderText("Find a system…")).toHaveValue("");
  });

  it("does nothing via the finder for a non-matching query", async () => {
    const onSelectSystem = vi.fn();
    renderPanel({ onSelectSystem });
    await flush();

    fireEvent.change(screen.getByPlaceholderText("Find a system…"), {
      target: { value: "Nowhere" },
    });

    expect(onSelectSystem).not.toHaveBeenCalled();
  });

  it("hides non-wormhole/unknown signature types by default", async () => {
    renderPanel({
      state: state({
        signatures: [
          signature({ id: 1, signature_id: "AAA-111", sig_type: "wormhole" }),
          signature({ id: 2, signature_id: "BBB-222", sig_type: "combat" }),
        ],
      }),
    });
    await flush();

    expect(screen.getByText("AAA-111")).toBeInTheDocument();
    expect(screen.queryByText("BBB-222")).not.toBeInTheDocument();
  });

  it("hides individually-hidden signatures by default, shown via 'Show hidden'", async () => {
    renderPanel({
      state: state({
        signatures: [
          signature({ id: 1, signature_id: "AAA-111", is_hidden: true }),
        ],
      }),
    });
    await flush();
    expect(screen.queryByText("AAA-111")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Filter signature types" }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Show hidden" }));

    expect(screen.getByText("AAA-111")).toBeInTheDocument();
  });

  it("toggling a type filter checkbox reveals that type and updates the badge count", async () => {
    renderPanel({
      state: state({
        signatures: [
          signature({ id: 1, signature_id: "AAA-111", sig_type: "wormhole" }),
          signature({ id: 2, signature_id: "BBB-222", sig_type: "combat" }),
        ],
      }),
    });
    await flush();

    fireEvent.click(
      screen.getByRole("button", { name: "Filter signature types" }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "combat" }));

    expect(screen.getByText("BBB-222")).toBeInTheDocument();
  });

  it("closes the type filter dropdown when clicking outside", async () => {
    renderPanel();
    await flush();

    fireEvent.click(
      screen.getByRole("button", { name: "Filter signature types" }),
    );
    expect(
      screen.getByRole("checkbox", { name: "Show hidden" }),
    ).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(
      screen.queryByRole("checkbox", { name: "Show hidden" }),
    ).not.toBeInTheDocument();
  });

  it("filters visible signatures by search text (id, type, or wormhole code)", async () => {
    renderPanel({
      state: state({
        signatures: [
          signature({ id: 1, signature_id: "AAA-111" }),
          signature({ id: 2, signature_id: "ZZZ-999" }),
        ],
      }),
    });
    await flush();

    fireEvent.change(screen.getByPlaceholderText("Search signatures…"), {
      target: { value: "aaa" },
    });

    expect(screen.getByText("AAA-111")).toBeInTheDocument();
    expect(screen.queryByText("ZZZ-999")).not.toBeInTheDocument();
  });

  it("removes a signature", async () => {
    vi.mocked(removeSignature).mockResolvedValue(undefined);
    renderPanel({
      state: state({
        signatures: [signature({ id: 1, signature_id: "AAA-111" })],
      }),
    });
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "✕" }));

    expect(removeSignature).toHaveBeenCalledWith(1, 1, 1);
  });

  it("disables per-signature edit controls in read-only mode", async () => {
    renderPanel({
      readOnly: true,
      state: state({
        signatures: [signature({ id: 1, signature_id: "AAA-111" })],
      }),
    });
    await flush();

    expect(screen.getByRole("button", { name: "✕" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Hide signature" }),
    ).toBeDisabled();
  });

  it("toggles a signature's hidden state", async () => {
    vi.mocked(updateSignature).mockResolvedValue(signature());
    renderPanel({
      state: state({
        signatures: [signature({ id: 1, signature_id: "AAA-111" })],
      }),
    });
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Hide signature" }));

    expect(updateSignature).toHaveBeenCalledWith(1, 1, 1, { is_hidden: true });
  });

  it("shows a computed life status for a signature with a known wormhole type", async () => {
    renderPanel({
      state: state({
        signatures: [
          signature({
            id: 1,
            signature_id: "AAA-111",
            wormhole_type: {
              code: "K162",
              leads_to_class: null,
              max_mass: null,
              max_jump_mass: null,
              max_stable_time: 6000, // 100h - well over the lt_48h boundary
            },
          }),
        ],
      }),
    });
    await flush();

    expect(
      screen.getByTitle(
        "Computed from the identified wormhole type's real lifetime",
      ),
    ).toHaveTextContent("Stable");
  });

  it("offers an editable life-status select for a signature with no known type yet", async () => {
    renderPanel({
      state: state({
        signatures: [signature({ id: 1, signature_id: "AAA-111" })],
      }),
    });
    await flush();

    fireEvent.change(screen.getByDisplayValue("Stable"), {
      target: { value: "lt_1h" },
    });

    expect(updateSignature).toHaveBeenCalledWith(1, 1, 1, {
      life_status: "lt_1h",
    });
  });

  it("sets a signature's wormhole type code on blur", async () => {
    renderPanel({
      state: state({
        signatures: [signature({ id: 1, signature_id: "AAA-111" })],
      }),
    });
    await flush();

    fireEvent.blur(screen.getByPlaceholderText("K162 (once identified)"), {
      target: { value: "b274" },
    });

    expect(updateSignature).toHaveBeenCalledWith(1, 1, 1, {
      wormhole_type_code: "b274",
    });
  });

  it("shows the linked system for a signature already attached to a connection", async () => {
    renderPanel({
      state: state({
        signatures: [signature({ id: 1, signature_id: "AAA-111" })],
        connections: [
          connection({
            id: 1,
            top_signature_id: 1,
            top_system_id: 1,
            bottom_system_id: 2,
          }),
        ],
      }),
    });
    await flush();

    // Shows up twice, structurally - once as the Signatures section's
    // linked-badge, once as the Connections section's own row for the same
    // connection (that section's own coverage is elsewhere in this file).
    expect(screen.getAllByText("→ Amarr")).toHaveLength(2);
    expect(screen.queryByText("Link to other system…")).not.toBeInTheDocument();
  });

  it("opens ConnectSignatureDialog for an unlinked wormhole signature", async () => {
    renderPanel({
      state: state({
        signatures: [signature({ id: 1, signature_id: "AAA-111" })],
      }),
    });
    await flush();

    fireEvent.click(
      screen.getByRole("button", { name: "Link to other system…" }),
    );

    expect(screen.getByTestId("connect-signature-dialog")).toBeInTheDocument();
  });

  it("hides link controls entirely in read-only mode", async () => {
    renderPanel({
      readOnly: true,
      state: state({
        signatures: [signature({ id: 1, signature_id: "AAA-111" })],
      }),
    });
    await flush();

    expect(screen.queryByText("Link to other system…")).not.toBeInTheDocument();
  });

  it("attaches a signature to an existing linkable connection", async () => {
    vi.mocked(linkConnectionSignature).mockResolvedValue(connection());
    renderPanel({
      state: state({
        signatures: [signature({ id: 1, signature_id: "AAA-111" })],
        connections: [
          connection({ id: 9, top_system_id: 1, top_signature_id: null }),
        ],
      }),
    });
    await flush();

    fireEvent.change(screen.getByTitle(/Attach this signature/), {
      target: { value: "9" },
    });

    expect(linkConnectionSignature).toHaveBeenCalledWith(1, 9, 1);
  });

  it("adds a new signature and clears the form", async () => {
    vi.mocked(addSignature).mockResolvedValue(signature());
    renderPanel();
    await flush();

    fireEvent.change(screen.getByPlaceholderText("ABC-123"), {
      target: { value: "xyz-999" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await flush();

    expect(addSignature).toHaveBeenCalledWith(1, 1, {
      signature_id: "XYZ-999",
      sig_type: "wormhole",
      wormhole_type_code: null,
    });
    expect(screen.getByPlaceholderText("ABC-123")).toHaveValue("");
  });

  it("hides the add-signature form in read-only mode", async () => {
    renderPanel({ readOnly: true });
    await flush();
    expect(screen.queryByPlaceholderText("ABC-123")).not.toBeInTheDocument();
  });

  it("imports pasted probe scan results and shows a summary", async () => {
    vi.mocked(bulkUpsertSignatures).mockResolvedValue({
      signatures: [signature(), signature({ id: 2 })],
      removed_signature_ids: [],
      removed_connection_ids: [],
      removed_system_ids: [],
    });
    renderPanel();
    await flush();

    fireEvent.change(
      screen.getByPlaceholderText(/Paste probe scan results here/),
      { target: { value: "ABC-123\tCosmic Signature\tWormhole" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await flush();

    expect(bulkUpsertSignatures).toHaveBeenCalledWith(
      1,
      1,
      [{ signature_id: "ABC-123", sig_type: "wormhole" }],
      false,
      false,
    );
    expect(screen.getByText("Imported 2 signatures.")).toBeInTheDocument();
  });

  it("reports removed counts in the import summary", async () => {
    vi.mocked(bulkUpsertSignatures).mockResolvedValue({
      signatures: [],
      removed_signature_ids: [1],
      removed_connection_ids: [2, 3],
      removed_system_ids: [],
    });
    renderPanel();
    await flush();

    fireEvent.change(
      screen.getByPlaceholderText(/Paste probe scan results here/),
      { target: { value: "ABC-123" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await flush();

    expect(
      screen.getByText(
        "Imported 0 signatures. Removed 1 signature, 2 connections.",
      ),
    ).toBeInTheDocument();
  });

  it("confirms before a lazy-delete-everything import (blank paste)", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPanel({
      state: state({ signatures: [signature()] }),
    });
    await flush();

    fireEvent.click(screen.getByRole("checkbox", { name: "Lazy delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(bulkUpsertSignatures).not.toHaveBeenCalled();
  });

  it("proceeds with the import once the lazy-delete-everything confirmation is accepted", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(bulkUpsertSignatures).mockResolvedValue({
      signatures: [],
      removed_signature_ids: [],
      removed_connection_ids: [],
      removed_system_ids: [],
    });
    renderPanel({ state: state({ signatures: [signature()] }) });
    await flush();

    fireEvent.click(screen.getByRole("checkbox", { name: "Lazy delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await flush();

    expect(bulkUpsertSignatures).toHaveBeenCalledWith(1, 1, [], true, false);
  });

  it("unchecking lazy delete also clears remove-dangling-systems", async () => {
    renderPanel();
    await flush();

    fireEvent.click(screen.getByRole("checkbox", { name: "Lazy delete" }));
    expect(
      screen.getByRole("checkbox", { name: "Remove dangling systems" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Lazy delete" }));
    expect(
      screen.queryByRole("checkbox", { name: "Remove dangling systems" }),
    ).not.toBeInTheDocument();
  });

  it("hides the paste-import form in read-only mode", async () => {
    renderPanel({ readOnly: true });
    await flush();
    expect(
      screen.queryByPlaceholderText(/Paste probe scan results here/),
    ).not.toBeInTheDocument();
  });

  it("shows a message when there are no connections", async () => {
    renderPanel();
    await flush();
    expect(screen.getByText("No connections yet.")).toBeInTheDocument();
  });

  it("removes a connection", async () => {
    vi.mocked(removeConnection).mockResolvedValue(undefined);
    renderPanel({
      state: state({
        connections: [
          connection({ id: 9, top_system_id: 1, bottom_system_id: 2 }),
        ],
      }),
    });
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "✕" }));

    expect(removeConnection).toHaveBeenCalledWith(1, 9);
  });

  it("shows computed ship size when the wormhole type is known, an editable select otherwise", async () => {
    const linkedSignature = signature({
      id: 1,
      wormhole_type: {
        code: "K162",
        leads_to_class: null,
        max_mass: null,
        max_jump_mass: 20_000_000,
        max_stable_time: null,
      },
    });
    renderPanel({
      state: state({
        signatures: [linkedSignature],
        connections: [
          connection({
            id: 9,
            top_system_id: 1,
            bottom_system_id: 2,
            top_signature_id: 1,
          }),
        ],
      }),
    });
    await flush();

    expect(screen.getByText("M ship size")).toBeInTheDocument();
  });

  it("toggles a system's pinned (home base) state", async () => {
    vi.mocked(updateSystem).mockResolvedValue(mapSystem());
    renderPanel();
    await flush();

    fireEvent.click(
      screen.getByRole("button", { name: "Lock system (home base)" }),
    );

    expect(updateSystem).toHaveBeenCalledWith(1, 1, { pinned: true });
  });

  it("removes the system from the map and closes the panel", async () => {
    vi.mocked(removeSystem).mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderPanel({ onClose });
    await flush();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove system from map" }),
    );
    await flush();

    expect(removeSystem).toHaveBeenCalledWith(1, 1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables removal for a pinned system", async () => {
    renderPanel({
      state: state({
        systems: [mapSystem({ id: 1, pinned: true }), mapSystem({ id: 2 })],
      }),
    });
    await flush();

    expect(
      screen.getByRole("button", { name: "Remove system from map" }),
    ).toBeDisabled();
  });

  it("hides footer actions in read-only mode", async () => {
    renderPanel({ readOnly: true });
    await flush();
    expect(
      screen.queryByRole("button", { name: "Remove system from map" }),
    ).not.toBeInTheDocument();
  });

  it("calls onClose from the Close button", async () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows an error message when a background fetch fails", async () => {
    vi.mocked(listWormholeTypes).mockRejectedValue(new Error("network down"));
    renderPanel();
    await flush();
    expect(screen.getByText(/network down/)).toBeInTheDocument();
  });
});
