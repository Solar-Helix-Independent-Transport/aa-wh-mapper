import type { InternalNode } from "@xyflow/react";

// Ported from xyflow's "Floating Edges" example: instead of anchoring an edge
// to a fixed handle position, find where the straight line between the two
// nodes' centers crosses each node's rectangle - so the edge always looks
// like it leaves/enters at the closest point on the node's border, and stays
// correct as nodes move.
function getNodeIntersection(
  intersectionNode: InternalNode,
  targetNode: InternalNode,
) {
  const w = (intersectionNode.measured.width ?? 0) / 2;
  const h = (intersectionNode.measured.height ?? 0) / 2;
  const nodePosition = intersectionNode.internals.positionAbsolute;
  const targetPosition = targetNode.internals.positionAbsolute;

  const x2 = nodePosition.x + w;
  const y2 = nodePosition.y + h;
  const x1 = targetPosition.x + (targetNode.measured.width ?? 0) / 2;
  const y1 = targetPosition.y + (targetNode.measured.height ?? 0) / 2;

  const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h);
  const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h);
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1);
  const xx3 = a * xx1;
  const yy3 = a * yy1;

  return {
    x: w * (xx3 + yy3) + x2,
    y: h * (-xx3 + yy3) + y2,
  };
}

export function getEdgeParams(source: InternalNode, target: InternalNode) {
  const sourceIntersection = getNodeIntersection(source, target);
  const targetIntersection = getNodeIntersection(target, source);

  return {
    sx: sourceIntersection.x,
    sy: sourceIntersection.y,
    tx: targetIntersection.x,
    ty: targetIntersection.y,
  };
}

// Multiple real wormholes can connect the same pair of systems, which would
// otherwise render as fully overlapping straight lines. Spreads them into a
// centered fan (e.g. 3 edges -> offsets -spacing, 0, +spacing) so each one is
// visually distinct; a lone edge between a pair gets no offset at all.
export function getParallelOffset(
  index: number,
  count: number,
  spacing = 48,
): number {
  if (count <= 1) {
    return 0;
  }
  return (index - (count - 1) / 2) * spacing;
}
