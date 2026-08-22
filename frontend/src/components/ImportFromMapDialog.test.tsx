import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { importFromMap, listMaps } from "../api/maps";
import type { MapOut } from "../api/types";
import { ImportFromMapDialog } from "./ImportFromMapDialog";

vi.mock("../api/maps", () => ({
  listMaps: vi.fn(),
  importFromMap: vi.fn(),
}));

function mapOut(overrides: Partial<MapOut> = {}): MapOut {
  return {
    id: 1,
    name: "Map",
    owner_id: 1,
    owner_name: "Alice",
    visibility: "private",
    read_only: false,
    can_write: true,
    created_at: "2026-01-01T00:00:00Z",
    last_updated: "2026-01-01T00:00:00Z",
    is_owner: true,
    can_edit_sharing: true,
    active_users: 0,
    ...overrides,
  };
}

describe("ImportFromMapDialog", () => {
  beforeEach(() => {
    vi.mocked(listMaps).mockReset();
    vi.mocked(importFromMap).mockReset();
  });

  it("shows a loading state before maps arrive", () => {
    vi.mocked(listMaps).mockReturnValue(new Promise(() => {}));
    render(
      <ImportFromMapDialog mapId={1} onClose={vi.fn()} onImported={vi.fn()} />,
    );
    expect(screen.getByText("Loading reference maps…")).toBeInTheDocument();
  });

  it("only offers read-only maps other than the current one", async () => {
    vi.mocked(listMaps).mockResolvedValue([
      mapOut({ id: 1, name: "Current Map", read_only: false }),
      mapOut({ id: 2, name: "Thera (eve-scout)", read_only: true }),
      mapOut({ id: 1, name: "Read-only self", read_only: true }),
      mapOut({ id: 3, name: "Turnur (eve-scout)", read_only: true }),
    ]);
    render(
      <ImportFromMapDialog mapId={1} onClose={vi.fn()} onImported={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByRole("combobox")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("option", { name: "Thera (eve-scout)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Turnur (eve-scout)" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Current Map" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Read-only self" }),
    ).not.toBeInTheDocument();
  });

  it("shows a message and no Import button when no reference maps exist", async () => {
    vi.mocked(listMaps).mockResolvedValue([]);
    render(
      <ImportFromMapDialog mapId={1} onClose={vi.fn()} onImported={vi.fn()} />,
    );

    await waitFor(() =>
      expect(
        screen.getByText("No read-only reference maps available yet."),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Import" }),
    ).not.toBeInTheDocument();
  });

  it("imports from the selected reference map and shows the full summary", async () => {
    vi.mocked(listMaps).mockResolvedValue([
      mapOut({ id: 2, name: "Thera (eve-scout)", read_only: true }),
    ]);
    vi.mocked(importFromMap).mockResolvedValue({
      systems_added: 4,
      signatures_added: 6,
      connections_added: 2,
    });
    const onImported = vi.fn();
    render(
      <ImportFromMapDialog
        mapId={1}
        onClose={vi.fn()}
        onImported={onImported}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("combobox")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() =>
      expect(
        screen.getByText("Added 4 systems, 6 signatures, and 2 connections."),
      ).toBeInTheDocument(),
    );
    expect(importFromMap).toHaveBeenCalledWith(1, 2);
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it("shows an error message when the import fails", async () => {
    vi.mocked(listMaps).mockResolvedValue([mapOut({ id: 2, read_only: true })]);
    vi.mocked(importFromMap).mockRejectedValue(
      new Error("not a reference map"),
    );
    render(
      <ImportFromMapDialog mapId={1} onClose={vi.fn()} onImported={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByRole("combobox")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() =>
      expect(screen.getByText(/not a reference map/)).toBeInTheDocument(),
    );
  });

  it("calls onClose when Cancel is clicked", async () => {
    vi.mocked(listMaps).mockResolvedValue([]);
    const onClose = vi.fn();
    render(
      <ImportFromMapDialog mapId={1} onClose={onClose} onImported={vi.fn()} />,
    );

    await waitFor(() =>
      expect(
        screen.getByText(/No read-only reference maps/),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
