import type { InternalNode } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { getEdgeParams, getParallelOffset } from "./floatingEdgeUtils";

function makeNode(x: number, y: number, width = 40, height = 40): InternalNode {
  return {
    measured: { width, height },
    internals: { positionAbsolute: { x, y } },
  } as unknown as InternalNode;
}

describe("getEdgeParams", () => {
  it("connects two nodes' centers via their closest border points", () => {
    // Two same-size square nodes, directly side by side on the x axis - the
    // intersection should land on each node's vertical edge, at the shared
    // mid-height.
    const left = makeNode(0, 0, 40, 40); // center (20, 20)
    const right = makeNode(100, 0, 40, 40); // center (120, 20)

    const { sx, sy, tx, ty } = getEdgeParams(left, right);

    expect(sx).toBeCloseTo(40); // left node's right edge
    expect(sy).toBeCloseTo(20);
    expect(tx).toBeCloseTo(100); // right node's left edge
    expect(ty).toBeCloseTo(20);
  });

  it("is symmetric under swapping source and target", () => {
    const a = makeNode(0, 0, 40, 40);
    const b = makeNode(0, 100, 40, 60);

    const forward = getEdgeParams(a, b);
    const backward = getEdgeParams(b, a);

    expect(forward.sx).toBeCloseTo(backward.tx);
    expect(forward.sy).toBeCloseTo(backward.ty);
    expect(forward.tx).toBeCloseTo(backward.sx);
    expect(forward.ty).toBeCloseTo(backward.sy);
  });
});

describe("getParallelOffset", () => {
  it("returns 0 for a lone edge between a pair", () => {
    expect(getParallelOffset(0, 1)).toBe(0);
  });

  it("centers a 3-edge fan around 0", () => {
    expect(getParallelOffset(0, 3, 48)).toBe(-48);
    expect(getParallelOffset(1, 3, 48)).toBe(0);
    expect(getParallelOffset(2, 3, 48)).toBe(48);
  });

  it("centers a 2-edge fan symmetrically without landing on 0", () => {
    expect(getParallelOffset(0, 2, 48)).toBe(-24);
    expect(getParallelOffset(1, 2, 48)).toBe(24);
  });

  it("uses the default spacing when none is given", () => {
    expect(getParallelOffset(0, 3)).toBe(-48);
  });
});
