import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { importRegion, listRegions } from "../api/maps";
import { ImportRegionDialog } from "./ImportRegionDialog";

vi.mock("../api/maps", () => ({
  listRegions: vi.fn(),
  importRegion: vi.fn(),
}));

describe("ImportRegionDialog", () => {
  beforeEach(() => {
    vi.mocked(listRegions).mockReset();
    vi.mocked(importRegion).mockReset();
  });

  it("shows a loading state before regions arrive", () => {
    vi.mocked(listRegions).mockReturnValue(new Promise(() => {}));
    render(
      <ImportRegionDialog mapId={1} onClose={vi.fn()} onImported={vi.fn()} />,
    );
    expect(screen.getByText("Loading regions…")).toBeInTheDocument();
  });

  it("lists regions and defaults the selection to the first one", async () => {
    vi.mocked(listRegions).mockResolvedValue([
      { id: 10, name: "The Forge" },
      { id: 20, name: "Domain" },
    ]);
    render(
      <ImportRegionDialog mapId={1} onClose={vi.fn()} onImported={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("10"));
    expect(screen.getByRole("option", { name: "Domain" })).toBeInTheDocument();
  });

  it("imports the selected region and shows the summary", async () => {
    vi.mocked(listRegions).mockResolvedValue([{ id: 10, name: "The Forge" }]);
    vi.mocked(importRegion).mockResolvedValue({
      systems_added: 5,
      connections_added: 3,
    });
    const onImported = vi.fn();
    render(
      <ImportRegionDialog
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
        screen.getByText("Added 5 systems and 3 connections."),
      ).toBeInTheDocument(),
    );
    expect(importRegion).toHaveBeenCalledWith(1, 10);
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it("singularizes the summary for exactly one system/connection", async () => {
    vi.mocked(listRegions).mockResolvedValue([{ id: 10, name: "The Forge" }]);
    vi.mocked(importRegion).mockResolvedValue({
      systems_added: 1,
      connections_added: 1,
    });
    render(
      <ImportRegionDialog mapId={1} onClose={vi.fn()} onImported={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByRole("combobox")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() =>
      expect(
        screen.getByText("Added 1 system and 1 connection."),
      ).toBeInTheDocument(),
    );
  });

  it("hides the Import button and relabels Cancel as Done once imported", async () => {
    vi.mocked(listRegions).mockResolvedValue([{ id: 10, name: "The Forge" }]);
    vi.mocked(importRegion).mockResolvedValue({
      systems_added: 1,
      connections_added: 1,
    });
    render(
      <ImportRegionDialog mapId={1} onClose={vi.fn()} onImported={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByRole("combobox")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Import" }),
    ).not.toBeInTheDocument();
  });

  it("shows an error message when the import fails", async () => {
    vi.mocked(listRegions).mockResolvedValue([{ id: 10, name: "The Forge" }]);
    vi.mocked(importRegion).mockRejectedValue(new Error("wormhole region"));
    render(
      <ImportRegionDialog mapId={1} onClose={vi.fn()} onImported={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByRole("combobox")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() =>
      expect(screen.getByText(/wormhole region/)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Import" })).toBeInTheDocument();
  });

  it("calls onClose when Cancel is clicked", async () => {
    vi.mocked(listRegions).mockResolvedValue([{ id: 10, name: "The Forge" }]);
    const onClose = vi.fn();
    render(
      <ImportRegionDialog mapId={1} onClose={onClose} onImported={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByRole("combobox")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
