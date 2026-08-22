import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextPosition } from "./nextPosition";
import { NEW_SYSTEM_SPACING_X } from "../constants";

describe("nextPosition", () => {
  it("places the first system at the origin", () => {
    expect(nextPosition([])).toEqual({ x: 0, y: 0 });
  });

  describe("with existing systems", () => {
    beforeEach(() => {
      // Pin Math.random so the y jitter term is deterministic (0.5 makes
      // (Math.random() - 0.5) * spacing evaluate to exactly 0).
      vi.spyOn(Math, "random").mockReturnValue(0.5);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("places the next system to the right of the rightmost existing one", () => {
      const result = nextPosition([
        { x: 0, y: 0 },
        { x: 100, y: 20 },
      ]);

      expect(result.x).toBe(100 + NEW_SYSTEM_SPACING_X);
    });

    it("centers the new system's y on the average of every existing y", () => {
      const result = nextPosition([
        { x: 0, y: 0 },
        { x: 50, y: 100 },
      ]);

      expect(result.y).toBe(50);
    });
  });
});
