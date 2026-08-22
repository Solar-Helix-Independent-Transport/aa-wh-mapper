import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listTrackableCharacters,
  removeTrackedCharacter,
  startTrackingCharacter,
} from "../api/maps";
import type { TrackableCharacterOut } from "../api/types";
import { TrackedCharactersPanel } from "./TrackedCharactersPanel";

vi.mock("../api/maps", () => ({
  listTrackableCharacters: vi.fn(),
  removeTrackedCharacter: vi.fn(),
  startTrackingCharacter: vi.fn(),
  trackCharacterUrl: (next?: string) =>
    `/wh-mapper/track/add/${next ? `?next=${encodeURIComponent(next)}` : ""}`,
}));

function character(
  overrides: Partial<TrackableCharacterOut> = {},
): TrackableCharacterOut {
  return {
    character_id: 1,
    character_name: "Alice",
    is_tracked: false,
    is_online: false,
    last_solar_system: null,
    last_seen_at: null,
    ...overrides,
  };
}

describe("TrackedCharactersPanel", () => {
  beforeEach(() => {
    vi.mocked(listTrackableCharacters).mockReset();
    vi.mocked(removeTrackedCharacter).mockReset();
    vi.mocked(startTrackingCharacter).mockReset();
  });

  it("shows a loading state before the initial fetch resolves", () => {
    vi.mocked(listTrackableCharacters).mockReturnValue(new Promise(() => {}));
    render(<TrackedCharactersPanel onClose={vi.fn()} />);
    expect(screen.getByText("Loading characters…")).toBeInTheDocument();
  });

  it("shows a message when no characters have ESI access granted", async () => {
    vi.mocked(listTrackableCharacters).mockResolvedValue([]);
    render(<TrackedCharactersPanel onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(/None of your characters/)).toBeInTheDocument(),
    );
  });

  it("lists trackable characters and reflects their tracked/online state", async () => {
    vi.mocked(listTrackableCharacters).mockResolvedValue([
      character({
        character_id: 1,
        character_name: "Alice",
        is_tracked: true,
        is_online: true,
      }),
      character({ character_id: 2, character_name: "Bob", is_tracked: false }),
    ]);
    render(<TrackedCharactersPanel onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByTitle("Live")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Stop tracking Alice" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Start tracking Bob" }),
    ).not.toBeChecked();
  });

  it("shows an offline dot for a tracked but currently-offline character", async () => {
    vi.mocked(listTrackableCharacters).mockResolvedValue([
      character({ is_tracked: true, is_online: false }),
    ]);
    render(<TrackedCharactersPanel onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByTitle("Offline")).toBeInTheDocument(),
    );
  });

  it("shows the last-known system and 'never seen' when a tracked character has no last_seen_at", async () => {
    vi.mocked(listTrackableCharacters).mockResolvedValue([
      character({ is_tracked: true, last_seen_at: null }),
    ]);
    render(<TrackedCharactersPanel onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText("never seen")).toBeInTheDocument(),
    );
    expect(screen.getByText("unknown")).toBeInTheDocument();
  });

  it("starts tracking a character on toggle and refreshes the list", async () => {
    vi.mocked(listTrackableCharacters)
      .mockResolvedValueOnce([
        character({ character_id: 1, is_tracked: false }),
      ])
      .mockResolvedValueOnce([
        character({ character_id: 1, is_tracked: true }),
      ]);
    vi.mocked(startTrackingCharacter).mockResolvedValue({
      character_id: 1,
      character_name: "Alice",
      added_by_id: 1,
      is_online: false,
      last_solar_system: null,
      last_seen_at: null,
    });
    render(<TrackedCharactersPanel onClose={vi.fn()} />);

    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Start tracking Alice" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Start tracking Alice" }),
    );

    expect(startTrackingCharacter).toHaveBeenCalledWith(1);
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Stop tracking Alice" }),
      ).toBeChecked(),
    );
  });

  it("stops tracking a character on toggle", async () => {
    vi.mocked(listTrackableCharacters)
      .mockResolvedValueOnce([character({ character_id: 1, is_tracked: true })])
      .mockResolvedValueOnce([
        character({ character_id: 1, is_tracked: false }),
      ]);
    vi.mocked(removeTrackedCharacter).mockResolvedValue(undefined);
    render(<TrackedCharactersPanel onClose={vi.fn()} />);

    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Stop tracking Alice" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Stop tracking Alice" }),
    );

    expect(removeTrackedCharacter).toHaveBeenCalledWith(1);
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Start tracking Alice" }),
      ).not.toBeChecked(),
    );
  });

  it("shows an error message when the initial fetch fails", async () => {
    vi.mocked(listTrackableCharacters).mockRejectedValue(
      new Error("network down"),
    );
    render(<TrackedCharactersPanel onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(/network down/)).toBeInTheDocument(),
    );
  });

  it("shows an error message when toggling tracking fails", async () => {
    vi.mocked(listTrackableCharacters).mockResolvedValue([
      character({ is_tracked: false }),
    ]);
    vi.mocked(startTrackingCharacter).mockRejectedValue(new Error("boom"));
    render(<TrackedCharactersPanel onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole("checkbox")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("checkbox"));

    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument());
  });

  it("links to add another character via the current page as `next`", async () => {
    vi.mocked(listTrackableCharacters).mockResolvedValue([]);
    render(<TrackedCharactersPanel onClose={vi.fn()} />);

    await waitFor(() =>
      expect(
        screen.getByRole("link", {
          name: "+ Grant access to another character",
        }),
      ).toHaveAttribute(
        "href",
        expect.stringContaining("/wh-mapper/track/add/"),
      ),
    );
  });

  it("calls onClose when the Close button is clicked", async () => {
    vi.mocked(listTrackableCharacters).mockResolvedValue([]);
    const onClose = vi.fn();
    render(<TrackedCharactersPanel onClose={onClose} />);

    await waitFor(() =>
      expect(screen.getByText(/None of your characters/)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
