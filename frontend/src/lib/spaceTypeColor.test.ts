import { describe, expect, it } from "vitest";
import { spaceTypeColor } from "./spaceTypeColor";

describe("spaceTypeColor", () => {
  it.each([
    ["High Sec", "#4ade80"],
    ["Low Sec", "#ffb454"],
    ["Null Sec", "#ff5c7a"],
    ["Wormhole", "#a68cff"],
    ["Pochven", "#ff8cf0"],
    ["Abyssal Deadspace", "#ff8cf0"],
  ])("maps %s to %s", (spaceType, expected) => {
    expect(spaceTypeColor(spaceType)).toBe(expected);
  });

  it("falls back to the dimmed-text color for an unrecognized space type", () => {
    expect(spaceTypeColor("Unknown")).toBe("var(--text-dim)");
  });
});
