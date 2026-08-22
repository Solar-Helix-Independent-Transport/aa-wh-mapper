import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addShare,
  listShares,
  removeShare,
  searchAlliances,
  searchCharacters,
  searchCorporations,
  searchGroups,
  updateMap,
} from "../api/maps";
import type { MapOut } from "../api/types";
import { SEARCH_DEBOUNCE_MS } from "../constants";
import { ShareDialog } from "./ShareDialog";

vi.mock("../api/maps", () => ({
  addShare: vi.fn(),
  listShares: vi.fn(),
  removeShare: vi.fn(),
  searchAlliances: vi.fn(),
  searchCharacters: vi.fn(),
  searchCorporations: vi.fn(),
  searchGroups: vi.fn(),
  updateMap: vi.fn(),
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
    created_at: "2026-01-01T00:00:00Z",
    last_updated: "2026-01-01T00:00:00Z",
    is_owner: true,
    can_edit_sharing: true,
    active_users: 0,
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function search(placeholder: string, query: string) {
  fireEvent.change(screen.getByPlaceholderText(placeholder), {
    target: { value: query },
  });
  await act(async () => {
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    await Promise.resolve();
  });
}

describe("ShareDialog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(addShare).mockReset();
    vi.mocked(listShares).mockReset().mockResolvedValue([]);
    vi.mocked(removeShare).mockReset();
    vi.mocked(searchAlliances).mockReset();
    vi.mocked(searchCharacters).mockReset();
    vi.mocked(searchCorporations).mockReset();
    vi.mocked(searchGroups).mockReset();
    vi.mocked(updateMap).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a message when the map isn't shared with anyone yet", async () => {
    render(
      <ShareDialog map={mapOut()} onClose={vi.fn()} onMapUpdated={vi.fn()} />,
    );
    await flush();
    expect(screen.getByText("Not shared with anyone yet.")).toBeInTheDocument();
  });

  it("lists existing shares by scope and target name", async () => {
    vi.mocked(listShares).mockResolvedValue([
      { scope: "character", target_id: 100, target_name: "Bob" },
      { scope: "corporation", target_id: 200, target_name: null },
    ]);
    render(
      <ShareDialog map={mapOut()} onClose={vi.fn()} onMapUpdated={vi.fn()} />,
    );
    await flush();

    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("#200")).toBeInTheDocument();
    expect(
      screen.getByText("character", { selector: ".badge" }),
    ).toBeInTheDocument();
  });

  it("hides sharing controls and shows a notice for a non-owner", async () => {
    render(
      <ShareDialog
        map={mapOut({ can_edit_sharing: false })}
        onClose={vi.fn()}
        onMapUpdated={vi.fn()}
      />,
    );
    await flush();

    expect(
      screen.getByText("Only the map's owner can change who it's shared with."),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Search/)).not.toBeInTheDocument();
  });

  it("hides the Revoke button for a non-owner even with existing shares", async () => {
    vi.mocked(listShares).mockResolvedValue([
      { scope: "character", target_id: 100, target_name: "Bob" },
    ]);
    render(
      <ShareDialog
        map={mapOut({ can_edit_sharing: false })}
        onClose={vi.fn()}
        onMapUpdated={vi.fn()}
      />,
    );
    await flush();

    expect(
      screen.queryByRole("button", { name: "Revoke" }),
    ).not.toBeInTheDocument();
  });

  it("searches characters by default", async () => {
    vi.mocked(searchCharacters).mockResolvedValue([
      {
        character_id: 1,
        character_name: "Alice Char",
        corporation_name: "Corp",
      },
    ]);
    render(
      <ShareDialog map={mapOut()} onClose={vi.fn()} onMapUpdated={vi.fn()} />,
    );
    await flush();

    await search("Search character…", "alice");

    expect(screen.getByText("Alice Char")).toBeInTheDocument();
  });

  it("switches to searching corporations and resets the query when that tab is picked", async () => {
    vi.mocked(searchCorporations).mockResolvedValue([
      { corporation_id: 1, corporation_name: "Some Corp" },
    ]);
    render(
      <ShareDialog map={mapOut()} onClose={vi.fn()} onMapUpdated={vi.fn()} />,
    );
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "corporation" }));
    await search("Search corporation…", "corp");

    expect(screen.getByText("Some Corp")).toBeInTheDocument();
  });

  it("grants a share and promotes visibility to shared on first grant", async () => {
    vi.mocked(searchCharacters).mockResolvedValue([
      {
        character_id: 1,
        character_name: "Alice Char",
        corporation_name: "Corp",
      },
    ]);
    vi.mocked(updateMap).mockResolvedValue(mapOut({ visibility: "shared" }));
    vi.mocked(addShare).mockResolvedValue({
      scope: "character",
      target_id: 1,
      target_name: "Alice Char",
    });
    const onMapUpdated = vi.fn();
    render(
      <ShareDialog
        map={mapOut({ visibility: "private" })}
        onClose={vi.fn()}
        onMapUpdated={onMapUpdated}
      />,
    );
    await flush();

    await search("Search character…", "alice");
    fireEvent.click(screen.getByRole("button", { name: "Alice Char" }));
    await flush();

    expect(updateMap).toHaveBeenCalledWith(1, { visibility: "shared" });
    expect(onMapUpdated).toHaveBeenCalledWith(mapOut({ visibility: "shared" }));
    expect(addShare).toHaveBeenCalledWith(1, "character", 1);
  });

  it("does not re-promote visibility when the map is already shared", async () => {
    vi.mocked(searchCharacters).mockResolvedValue([
      {
        character_id: 1,
        character_name: "Alice Char",
        corporation_name: "Corp",
      },
    ]);
    vi.mocked(addShare).mockResolvedValue({
      scope: "character",
      target_id: 1,
      target_name: "Alice Char",
    });
    render(
      <ShareDialog
        map={mapOut({ visibility: "shared" })}
        onClose={vi.fn()}
        onMapUpdated={vi.fn()}
      />,
    );
    await flush();

    await search("Search character…", "alice");
    fireEvent.click(screen.getByRole("button", { name: "Alice Char" }));
    await flush();

    expect(updateMap).not.toHaveBeenCalled();
    expect(addShare).toHaveBeenCalledWith(1, "character", 1);
  });

  it("revokes a share", async () => {
    vi.mocked(listShares)
      .mockResolvedValueOnce([
        { scope: "character", target_id: 1, target_name: "Bob" },
      ])
      .mockResolvedValueOnce([]);
    vi.mocked(removeShare).mockResolvedValue(undefined);
    render(
      <ShareDialog map={mapOut()} onClose={vi.fn()} onMapUpdated={vi.fn()} />,
    );
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await flush();

    expect(removeShare).toHaveBeenCalledWith(1, "character", 1);
    expect(screen.getByText("Not shared with anyone yet.")).toBeInTheDocument();
  });

  it("shows an error when fetching shares fails", async () => {
    vi.mocked(listShares).mockRejectedValue(new Error("network error"));
    render(
      <ShareDialog map={mapOut()} onClose={vi.fn()} onMapUpdated={vi.fn()} />,
    );
    await flush();

    expect(screen.getByText(/network error/)).toBeInTheDocument();
  });

  it("shows an error when granting a share fails", async () => {
    vi.mocked(searchCharacters).mockResolvedValue([
      {
        character_id: 1,
        character_name: "Alice Char",
        corporation_name: "Corp",
      },
    ]);
    vi.mocked(addShare).mockRejectedValue(new Error("already shared"));
    render(
      <ShareDialog
        map={mapOut({ visibility: "shared" })}
        onClose={vi.fn()}
        onMapUpdated={vi.fn()}
      />,
    );
    await flush();

    await search("Search character…", "alice");
    fireEvent.click(screen.getByRole("button", { name: "Alice Char" }));
    await flush();

    expect(screen.getByText(/already shared/)).toBeInTheDocument();
  });

  it("calls onClose on Done", async () => {
    const onClose = vi.fn();
    render(
      <ShareDialog map={mapOut()} onClose={onClose} onMapUpdated={vi.fn()} />,
    );
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
