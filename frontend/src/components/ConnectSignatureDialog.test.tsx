import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addConnection,
  addSystem,
  removeSystem,
  searchSolarSystems,
} from "../api/maps";
import type { MapSystemOut, SolarSystemOut } from "../api/types";
import { SEARCH_DEBOUNCE_MS } from "../constants";
import { ConnectSignatureDialog } from "./ConnectSignatureDialog";

vi.mock("../api/maps", () => ({
  addConnection: vi.fn(),
  addSystem: vi.fn(),
  removeSystem: vi.fn(),
  searchSolarSystems: vi.fn(),
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

function mapSystem(id: number, name: string, label = ""): MapSystemOut {
  return {
    id,
    map_id: 1,
    solar_system: solarSystem(id * 100, name),
    label,
    x: 0,
    y: 0,
    pinned: false,
    added_by_id: null,
    added_at: "2026-01-01T00:00:00Z",
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function search(query: string) {
  fireEvent.change(screen.getByPlaceholderText("Search solar system…"), {
    target: { value: query },
  });
  await act(async () => {
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    await Promise.resolve();
  });
}

describe("ConnectSignatureDialog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(addConnection).mockReset();
    vi.mocked(addSystem).mockReset();
    vi.mocked(removeSystem).mockReset();
    vi.mocked(searchSolarSystems).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("excludes the source system from the existing-systems picker", () => {
    render(
      <ConnectSignatureDialog
        mapId={1}
        sourceSystemId={1}
        signatureId={10}
        existingSystems={[mapSystem(1, "Source"), mapSystem(2, "Other")]}
        onSystemCreated={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("option", { name: "Source" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Other" })).toBeInTheDocument();
  });

  it("prefers a system's custom label over its solar system name", () => {
    render(
      <ConnectSignatureDialog
        mapId={1}
        sourceSystemId={1}
        signatureId={10}
        existingSystems={[
          mapSystem(1, "Source"),
          mapSystem(2, "Other", "Home"),
        ]}
        onSystemCreated={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("option", { name: "Home" })).toBeInTheDocument();
  });

  it("hides the existing-systems section entirely when there's nothing else on the map", () => {
    render(
      <ConnectSignatureDialog
        mapId={1}
        sourceSystemId={1}
        signatureId={10}
        existingSystems={[mapSystem(1, "Source")]}
        onSystemCreated={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByText("Already on this map")).not.toBeInTheDocument();
  });

  it("disables Connect until an existing system is picked", () => {
    render(
      <ConnectSignatureDialog
        mapId={1}
        sourceSystemId={1}
        signatureId={10}
        existingSystems={[mapSystem(1, "Source"), mapSystem(2, "Other")]}
        onSystemCreated={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "2" } });
    expect(screen.getByRole("button", { name: "Connect" })).not.toBeDisabled();
  });

  it("connects to an existing system and closes", async () => {
    vi.mocked(addConnection).mockResolvedValue({} as never);
    const onClose = vi.fn();
    render(
      <ConnectSignatureDialog
        mapId={1}
        sourceSystemId={1}
        signatureId={10}
        existingSystems={[mapSystem(1, "Source"), mapSystem(2, "Other")]}
        onSystemCreated={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await flush();

    expect(addConnection).toHaveBeenCalledWith(1, {
      top_system_id: 1,
      bottom_system_id: 2,
      top_signature_id: 10,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows an error when connecting to an existing system fails", async () => {
    vi.mocked(addConnection).mockRejectedValue(new Error("already connected"));
    const onClose = vi.fn();
    render(
      <ConnectSignatureDialog
        mapId={1}
        sourceSystemId={1}
        signatureId={10}
        existingSystems={[mapSystem(1, "Source"), mapSystem(2, "Other")]}
        onSystemCreated={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await flush();

    expect(screen.getByText(/already connected/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("creates a new system, connects it, notifies the caller, and closes", async () => {
    const created = mapSystem(5, "Jita");
    vi.mocked(searchSolarSystems).mockResolvedValue([solarSystem(500, "Jita")]);
    vi.mocked(addSystem).mockResolvedValue(created);
    vi.mocked(addConnection).mockResolvedValue({} as never);
    const onSystemCreated = vi.fn();
    const onClose = vi.fn();
    render(
      <ConnectSignatureDialog
        mapId={1}
        sourceSystemId={1}
        signatureId={10}
        existingSystems={[mapSystem(1, "Source")]}
        onSystemCreated={onSystemCreated}
        onClose={onClose}
      />,
    );

    await search("jita");
    fireEvent.click(screen.getByRole("button", { name: "Jita" }));
    await flush();

    expect(addSystem).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ solar_system_id: 500 }),
    );
    expect(onSystemCreated).toHaveBeenCalledWith(created);
    expect(addConnection).toHaveBeenCalledWith(1, {
      top_system_id: 1,
      bottom_system_id: 5,
      top_signature_id: 10,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("rolls back the newly-created system when linking the connection fails", async () => {
    const created = mapSystem(5, "Jita");
    vi.mocked(searchSolarSystems).mockResolvedValue([solarSystem(500, "Jita")]);
    vi.mocked(addSystem).mockResolvedValue(created);
    vi.mocked(addConnection).mockRejectedValue(new Error("connection failed"));
    vi.mocked(removeSystem).mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <ConnectSignatureDialog
        mapId={1}
        sourceSystemId={1}
        signatureId={10}
        existingSystems={[mapSystem(1, "Source")]}
        onSystemCreated={vi.fn()}
        onClose={onClose}
      />,
    );

    await search("jita");
    fireEvent.click(screen.getByRole("button", { name: "Jita" }));
    await flush();

    expect(removeSystem).toHaveBeenCalledWith(1, 5);
    expect(screen.getByText(/connection failed/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not attempt a rollback when addSystem itself fails (nothing to remove)", async () => {
    vi.mocked(searchSolarSystems).mockResolvedValue([solarSystem(500, "Jita")]);
    vi.mocked(addSystem).mockRejectedValue(new Error("system add failed"));
    render(
      <ConnectSignatureDialog
        mapId={1}
        sourceSystemId={1}
        signatureId={10}
        existingSystems={[mapSystem(1, "Source")]}
        onSystemCreated={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await search("jita");
    fireEvent.click(screen.getByRole("button", { name: "Jita" }));
    await flush();

    expect(removeSystem).not.toHaveBeenCalled();
    expect(screen.getByText(/system add failed/)).toBeInTheDocument();
  });

  it("calls onClose on Cancel", () => {
    const onClose = vi.fn();
    render(
      <ConnectSignatureDialog
        mapId={1}
        sourceSystemId={1}
        signatureId={10}
        existingSystems={[mapSystem(1, "Source")]}
        onSystemCreated={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
