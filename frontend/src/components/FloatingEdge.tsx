import {
  BaseEdge,
  EdgeLabelRenderer,
  getStraightPath,
  useInternalNode,
  type EdgeProps,
} from "@xyflow/react";
import { getEdgeParams, getParallelOffset } from "./floatingEdgeUtils";

// How far along the line (0 = source node, 1 = target node) each end's
// signature-id label sits - close enough to its own node to read as "this
// signature is on that side," far enough not to collide with the node itself.
const END_LABEL_POSITION = 0.22;

// Point at parameter t on the quadratic Bezier source->control->target.
// When control is exactly the source/target midpoint (the offset === 0
// case), this is mathematically identical to plain linear interpolation -
// so using it unconditionally for every label position (not just the
// curve's own midpoint) keeps straight edges pixel-identical while making
// fanned-out/curved edges' end labels actually follow the bowed path
// instead of the straight chord between the nodes.
function pointAlongCurve(
  sx: number,
  sy: number,
  cx: number,
  cy: number,
  tx: number,
  ty: number,
  t: number,
) {
  const oneMinusT = 1 - t;
  return {
    x: oneMinusT * oneMinusT * sx + 2 * t * oneMinusT * cx + t * t * tx,
    y: oneMinusT * oneMinusT * sy + 2 * t * oneMinusT * cy + t * t * ty,
  };
}

export function FloatingEdge({
  id,
  source,
  target,
  markerEnd,
  style,
  data,
  selected,
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  if (!sourceNode || !targetNode) {
    return null;
  }

  const { sx, sy, tx, ty } = getEdgeParams(sourceNode, targetNode);
  const parallelIndex = (data?.parallelIndex as number | undefined) ?? 0;
  const parallelCount = (data?.parallelCount as number | undefined) ?? 1;
  const offset = getParallelOffset(parallelIndex, parallelCount);

  // Bow the line around its straight-line midpoint, offset perpendicular to
  // source->target, so parallel edges between the same pair of nodes fan
  // out instead of rendering on top of each other. At offset 0 this control
  // point is just the plain midpoint, which - per pointAlongCurve's comment
  // above - makes every position below identical to the straight-line case.
  const dx = tx - sx;
  const dy = ty - sy;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const mx = (sx + tx) / 2 + nx * offset;
  const my = (sy + ty) / 2 + ny * offset;

  const path =
    offset === 0
      ? getStraightPath({
          sourceX: sx,
          sourceY: sy,
          targetX: tx,
          targetY: ty,
        })[0]
      : `M ${sx},${sy} Q ${mx},${my} ${tx},${ty}`;

  const { x: labelX, y: labelY } = pointAlongCurve(sx, sy, mx, my, tx, ty, 0.5);

  const label = data?.label as string | undefined;
  const sourceSignatureId = data?.sourceSignatureId as string | undefined;
  const targetSignatureId = data?.targetSignatureId as string | undefined;
  const critical = Boolean(data?.critical);

  const sourceLabelPos = pointAlongCurve(
    sx,
    sy,
    mx,
    my,
    tx,
    ty,
    END_LABEL_POSITION,
  );
  const targetLabelPos = pointAlongCurve(
    sx,
    sy,
    mx,
    my,
    tx,
    ty,
    1 - END_LABEL_POSITION,
  );

  // Selected (box-select/ctrl-click, for bulk delete) gets a glow layered on
  // top of its existing stroke color/dash, rather than overriding either -
  // both keep carrying their own meaning (time left / mass depleted).
  const edgeStyle = selected
    ? { ...style, filter: "drop-shadow(0 0 3px var(--accent-bright))" }
    : style;

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={edgeStyle} />
      <EdgeLabelRenderer>
        {label && (
          <div
            className="edge-label"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {label}
          </div>
        )}
        {critical && (
          <div
            className="edge-label edge-label-critical"
            title="Expected to collapse within the next hour"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + 14}px)`,
            }}
          >
            ≤1h
          </div>
        )}
        {sourceSignatureId && (
          <div
            className="edge-label edge-label-end mono"
            style={{
              transform: `translate(-50%, -50%) translate(${sourceLabelPos.x}px, ${sourceLabelPos.y}px)`,
            }}
          >
            {sourceSignatureId}
          </div>
        )}
        {targetSignatureId && (
          <div
            className="edge-label edge-label-end mono"
            style={{
              transform: `translate(-50%, -50%) translate(${targetLabelPos.x}px, ${targetLabelPos.y}px)`,
            }}
          >
            {targetSignatureId}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
