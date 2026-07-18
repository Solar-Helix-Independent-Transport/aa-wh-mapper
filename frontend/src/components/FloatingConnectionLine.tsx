import {
  getStraightPath,
  type ConnectionLineComponentProps,
} from "@xyflow/react";

export function FloatingConnectionLine({
  fromNode,
  toX,
  toY,
}: ConnectionLineComponentProps) {
  if (!fromNode) {
    return null;
  }

  const sourceX =
    fromNode.internals.positionAbsolute.x + (fromNode.measured.width ?? 0) / 2;
  const sourceY =
    fromNode.internals.positionAbsolute.y + (fromNode.measured.height ?? 0) / 2;

  const [path] = getStraightPath({
    sourceX,
    sourceY,
    targetX: toX,
    targetY: toY,
  });

  return (
    <g>
      <path fill="none" stroke="var(--accent)" strokeWidth={2} d={path} />
      <circle
        cx={toX}
        cy={toY}
        r={4}
        fill="var(--accent)"
        stroke="var(--bg)"
        strokeWidth={1}
      />
    </g>
  );
}
