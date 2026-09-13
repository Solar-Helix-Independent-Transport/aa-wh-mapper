import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  MapSystemOut,
  SolarSystemOut,
  TrackedCharacterOut,
} from "../api/types";
import { CharacterFinder } from "./CharacterFinder";

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
    added_at: "",
    ...overrides,
  };
}

function trackedCharacter(
  overrides: Partial<TrackedCharacterOut> = {},
): TrackedCharacterOut {
  return {
    character_id: 1,
    character_name: "Bob",
    added_by_id: 1,
    is_online: true,
    last_solar_system: solarSystem(100, "Jita"),
    last_seen_at: null,
    ...overrides,
  };
}

describe("CharacterFinder", () => {
  it("starts closed", () => {
    render(
      <CharacterFinder
        characters={[]}
        systems={[]}
        currentUserId={1}
        onFocus={vi.fn()}
      />,
    );
    expect(
      screen.queryByPlaceholderText("Find character…"),
    ).not.toBeInTheDocument();
  });

  it("shows the character count on the toggle button", () => {
    render(
      <CharacterFinder
        characters={[
          trackedCharacter(),
          trackedCharacter({ character_id: 2, character_name: "Alice" }),
        ]}
        systems={[mapSystem()]}
        currentUserId={1}
        onFocus={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Characters (2)" }),
    ).toBeInTheDocument();
  });

  it("lists characters sorted by name with their system", () => {
    render(
      <CharacterFinder
        characters={[
          trackedCharacter({ character_id: 1, character_name: "Zed" }),
          trackedCharacter({ character_id: 2, character_name: "Alice" }),
        ]}
        systems={[mapSystem()]}
        currentUserId={1}
        onFocus={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Characters (2)" }));

    const names = screen
      .getAllByText(/^(Alice|Zed)$/)
      .map((el) => el.textContent);
    expect(names).toEqual(["Alice", "Zed"]);
    expect(screen.getAllByText("Jita")).toHaveLength(2);
  });

  it("focuses the character's system and closes on click", () => {
    const onFocus = vi.fn();
    render(
      <CharacterFinder
        characters={[trackedCharacter()]}
        systems={[mapSystem({ id: 42 })]}
        currentUserId={1}
        onFocus={onFocus}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Characters (1)" }));
    fireEvent.click(screen.getByText("Bob"));

    expect(onFocus).toHaveBeenCalledWith(42);
    expect(
      screen.queryByPlaceholderText("Find character…"),
    ).not.toBeInTheDocument();
  });

  it("marks a character not on this map as unselectable", () => {
    const onFocus = vi.fn();
    render(
      <CharacterFinder
        characters={[trackedCharacter()]}
        systems={[]}
        currentUserId={1}
        onFocus={onFocus}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Characters (1)" }));

    expect(screen.getByText("not on this map")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Bob"));
    expect(onFocus).not.toHaveBeenCalled();
  });

  it("filters the list by search query", () => {
    render(
      <CharacterFinder
        characters={[
          trackedCharacter({ character_id: 1, character_name: "Zed" }),
          trackedCharacter({ character_id: 2, character_name: "Alice" }),
        ]}
        systems={[mapSystem()]}
        currentUserId={1}
        onFocus={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Characters (2)" }));
    fireEvent.change(screen.getByPlaceholderText("Find character…"), {
      target: { value: "ali" },
    });

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Zed")).not.toBeInTheDocument();
  });

  it("closes when clicking outside the popover", () => {
    render(
      <CharacterFinder
        characters={[trackedCharacter()]}
        systems={[mapSystem()]}
        currentUserId={1}
        onFocus={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Characters (1)" }));
    expect(screen.getByPlaceholderText("Find character…")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(
      screen.queryByPlaceholderText("Find character…"),
    ).not.toBeInTheDocument();
  });
});
