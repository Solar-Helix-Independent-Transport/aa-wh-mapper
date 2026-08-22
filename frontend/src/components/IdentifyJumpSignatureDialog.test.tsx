import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addSignature,
  linkConnectionSignature,
  listWormholeTypes,
  updateConnection,
  updateSignature,
} from "../api/maps";
import type {
  JumpNeedsSignaturePrompt,
  MapStateOut,
  SignatureOut,
  SolarSystemOut,
} from "../api/types";
import { IdentifyJumpSignatureDialog } from "./IdentifyJumpSignatureDialog";

vi.mock("../api/maps", () => ({
  addSignature: vi.fn(),
  linkConnectionSignature: vi.fn(),
  listWormholeTypes: vi.fn(),
  updateConnection: vi.fn(),
  updateSignature: vi.fn(),
}));

function solarSystem(
  id: number,
  name: string,
  regionName: string | null = "The Forge",
): SolarSystemOut {
  return {
    id,
    name,
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

function signature(overrides: Partial<SignatureOut> = {}): SignatureOut {
  return {
    id: 1,
    map_system_id: 10,
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

function state(overrides: Partial<MapStateOut> = {}): MapStateOut {
  return {
    map: {} as MapStateOut["map"],
    systems: [
      {
        id: 10,
        map_id: 1,
        solar_system: solarSystem(100, "OldSys"),
        label: "",
        x: 0,
        y: 0,
        pinned: false,
        added_by_id: null,
        added_at: "",
      },
      {
        id: 20,
        map_id: 1,
        solar_system: solarSystem(200, "NewSys"),
        label: "",
        x: 0,
        y: 0,
        pinned: false,
        added_by_id: null,
        added_at: "",
      },
    ],
    signatures: [],
    connections: [],
    tracked_characters: [],
    current_user_id: 1,
    ...overrides,
  };
}

function prompt(
  overrides: Partial<JumpNeedsSignaturePrompt> = {},
): JumpNeedsSignaturePrompt {
  return {
    connection_id: 5,
    character_name: "Alice",
    old_map_system_id: 10,
    new_map_system_id: 20,
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("IdentifyJumpSignatureDialog", () => {
  beforeEach(() => {
    vi.mocked(addSignature).mockReset();
    vi.mocked(linkConnectionSignature).mockReset();
    vi.mocked(listWormholeTypes).mockReset().mockResolvedValue([]);
    vi.mocked(updateConnection).mockReset();
    vi.mocked(updateSignature).mockReset();
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("shows the character-jump message when a character name is present", async () => {
    render(
      <IdentifyJumpSignatureDialog
        mapId={1}
        state={state()}
        prompt={prompt({ character_name: "Alice" })}
        queueLength={1}
        onClose={vi.fn()}
      />,
    );
    await flush();

    expect(
      screen.getByText(/Alice jumped OldSys → NewSys/),
    ).toBeInTheDocument();
  });

  it("shows a generic message when reopened manually (no character name)", async () => {
    render(
      <IdentifyJumpSignatureDialog
        mapId={1}
        state={state()}
        prompt={prompt({ character_name: null })}
        queueLength={1}
        onClose={vi.fn()}
      />,
    );
    await flush();

    expect(
      screen.getByText(/OldSys → NewSys - wormhole connection still needs/),
    ).toBeInTheDocument();
  });

  it("shows the remaining queue count only when more than one is pending", async () => {
    const { rerender } = render(
      <IdentifyJumpSignatureDialog
        mapId={1}
        state={state()}
        prompt={prompt()}
        queueLength={1}
        onClose={vi.fn()}
      />,
    );
    await flush();
    expect(screen.queryByText(/more jump/)).not.toBeInTheDocument();

    rerender(
      <IdentifyJumpSignatureDialog
        mapId={1}
        state={state()}
        prompt={prompt()}
        queueLength={3}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("2 more jumps waiting")).toBeInTheDocument();
  });

  it("only offers unlinked, non-hidden wormhole signatures from the departure system", async () => {
    const candidates = state({
      signatures: [
        signature({ id: 1, map_system_id: 10, signature_id: "AAA-111" }),
        signature({
          id: 2,
          map_system_id: 10,
          signature_id: "BBB-222",
          sig_type: "combat",
        }),
        signature({
          id: 3,
          map_system_id: 10,
          signature_id: "CCC-333",
          is_hidden: true,
        }),
        signature({ id: 4, map_system_id: 10, signature_id: "DDD-444" }),
        signature({ id: 5, map_system_id: 20, signature_id: "EEE-555" }),
      ],
      connections: [
        {
          id: 1,
          map_id: 1,
          connection_type: "wormhole",
          top_system_id: 10,
          bottom_system_id: 20,
          top_system_solar_system_id: 100,
          bottom_system_solar_system_id: 200,
          top_signature_id: 4,
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
        },
      ],
    });
    render(
      <IdentifyJumpSignatureDialog
        mapId={1}
        state={candidates}
        prompt={prompt()}
        queueLength={1}
        onClose={vi.fn()}
      />,
    );
    await flush();

    expect(screen.getByText("AAA-111", { exact: false })).toBeInTheDocument();
    expect(
      screen.queryByText("BBB-222", { exact: false }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("CCC-333", { exact: false }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("DDD-444", { exact: false }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("EEE-555", { exact: false }),
    ).not.toBeInTheDocument();
  });

  it("picking an existing signature links it, applies mass/life status, and closes", async () => {
    vi.mocked(linkConnectionSignature).mockResolvedValue({} as never);
    vi.mocked(updateConnection).mockResolvedValue({} as never);
    const onClose = vi.fn();
    render(
      <IdentifyJumpSignatureDialog
        mapId={1}
        state={state({
          signatures: [signature({ id: 1, signature_id: "AAA-111" })],
        })}
        prompt={prompt()}
        queueLength={1}
        onClose={onClose}
      />,
    );
    await flush();

    fireEvent.change(screen.getByPlaceholderText("K162 (type, optional)"), {
      target: { value: "K162" },
    });
    fireEvent.click(screen.getByRole("button", { name: /AAA-111/ }));
    await flush();

    expect(linkConnectionSignature).toHaveBeenCalledWith(1, 5, 1);
    expect(updateConnection).toHaveBeenCalledWith(1, 5, {
      mass_status: "reduced",
      life_status: "stable",
    });
    expect(updateSignature).toHaveBeenCalledWith(1, 10, 1, {
      wormhole_type_code: "K162",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("never overwrites a signature's already-known type", async () => {
    vi.mocked(linkConnectionSignature).mockResolvedValue({} as never);
    vi.mocked(updateConnection).mockResolvedValue({} as never);
    render(
      <IdentifyJumpSignatureDialog
        mapId={1}
        state={state({
          signatures: [
            signature({
              id: 1,
              signature_id: "AAA-111",
              wormhole_type: {
                code: "K162",
                leads_to_class: null,
                max_mass: null,
                max_jump_mass: null,
                max_stable_time: null,
              },
            }),
          ],
        })}
        prompt={prompt()}
        queueLength={1}
        onClose={vi.fn()}
      />,
    );
    await flush();

    fireEvent.change(screen.getByPlaceholderText("K162 (type, optional)"), {
      target: { value: "B274" },
    });
    fireEvent.click(screen.getByRole("button", { name: /AAA-111/ }));
    await flush();

    expect(updateSignature).not.toHaveBeenCalled();
  });

  it("marks the connection as an ansiblex and closes", async () => {
    vi.mocked(updateConnection).mockResolvedValue({} as never);
    const onClose = vi.fn();
    render(
      <IdentifyJumpSignatureDialog
        mapId={1}
        state={state()}
        prompt={prompt()}
        queueLength={1}
        onClose={onClose}
      />,
    );
    await flush();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Actually, this was a jump bridge (Ansiblex)",
      }),
    );
    await flush();

    expect(updateConnection).toHaveBeenCalledWith(1, 5, {
      connection_type: "ansiblex",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("adds and links a brand-new signature", async () => {
    vi.mocked(addSignature).mockResolvedValue(
      signature({ id: 9, signature_id: "XYZ-999" }),
    );
    vi.mocked(linkConnectionSignature).mockResolvedValue({} as never);
    vi.mocked(updateConnection).mockResolvedValue({} as never);
    const onClose = vi.fn();
    render(
      <IdentifyJumpSignatureDialog
        mapId={1}
        state={state()}
        prompt={prompt()}
        queueLength={1}
        onClose={onClose}
      />,
    );
    await flush();

    fireEvent.change(screen.getByPlaceholderText("ABC-123"), {
      target: { value: "xyz-999" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add & link" }));
    await flush();

    expect(addSignature).toHaveBeenCalledWith(1, 10, {
      signature_id: "XYZ-999",
      sig_type: "wormhole",
      wormhole_type_code: null,
    });
    expect(linkConnectionSignature).toHaveBeenCalledWith(1, 5, 9);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does nothing when submitting a blank new-signature id", async () => {
    render(
      <IdentifyJumpSignatureDialog
        mapId={1}
        state={state()}
        prompt={prompt()}
        queueLength={1}
        onClose={vi.fn()}
      />,
    );
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Add & link" }));
    await flush();

    expect(addSignature).not.toHaveBeenCalled();
  });

  it("shows an error when linking an existing signature fails", async () => {
    vi.mocked(linkConnectionSignature).mockRejectedValue(
      new Error("already linked"),
    );
    render(
      <IdentifyJumpSignatureDialog
        mapId={1}
        state={state({
          signatures: [signature({ id: 1, signature_id: "AAA-111" })],
        })}
        prompt={prompt()}
        queueLength={1}
        onClose={vi.fn()}
      />,
    );
    await flush();

    fireEvent.click(screen.getByRole("button", { name: /AAA-111/ }));
    await flush();

    expect(screen.getByText(/already linked/)).toBeInTheDocument();
  });

  it("calls onClose on Skip", async () => {
    const onClose = vi.fn();
    render(
      <IdentifyJumpSignatureDialog
        mapId={1}
        state={state()}
        prompt={prompt()}
        queueLength={1}
        onClose={onClose}
      />,
    );
    await flush();

    fireEvent.click(
      screen.getByRole("button", { name: "Skip - I'll link it later" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
