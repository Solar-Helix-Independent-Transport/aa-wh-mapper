import type { CSSProperties } from "react";
import type { RouteLegOut, SignatureOut } from "../api/types";
import {
  FIXED_CONNECTION_STYLE,
  SHIP_SIZE_LABEL,
  TIME_STATUS_COLOR,
} from "../constants";

/** A wormhole connection has two ends (top/bottom, fixed at creation - which
 * is "top" is arbitrary), each with its own optional signature. `sourceId`
 * is whichever system this leg is being traversed *from* in this route
 * (route.systems[index].id) - orients the connection's top/bottom back to
 * "the end at the system before this leg" vs "the end at the system after
 * it", the same logic RouteDiagram uses for its edge end-labels, extracted
 * here so RouteLegRow (which needs the same orientation, per-leg, to label
 * signatures by which system they're on) doesn't duplicate it. */
export function routeLegOrientedSignatures(
  leg: RouteLegOut,
  sourceId: number,
): { source: SignatureOut | null; target: SignatureOut | null } {
  const traversesTopToBottom =
    leg.connection?.top_system_solar_system_id === sourceId;
  return traversesTopToBottom
    ? {
        source: leg.connection?.top_signature ?? null,
        target: leg.connection?.bottom_signature ?? null,
      }
    : {
        source: leg.connection?.bottom_signature ?? null,
        target: leg.connection?.top_signature ?? null,
      };
}

/** Shared between RouteDiagram (the edge's line color) and RouteLegRow (the
 * itinerary's vertical connector) so both read as the same legend - same
 * coloring rule as MapCanvas's own baseEdges: fixed look for
 * stargate/ansiblex (they don't decay), else the connection's own
 * server-computed time_status
 * (wh_mapper.api.helpers.connection_time_status) - the exact same value
 * the Map view's edges use, not an approximation. */
export function routeLegColor(leg: RouteLegOut): string {
  if (leg.connection_type !== "wormhole") {
    return (
      (FIXED_CONNECTION_STYLE[leg.connection_type]?.stroke as string) ??
      "var(--text-dim)"
    );
  }
  const timeStatus = leg.connection?.time_status ?? "unknown";
  return TIME_STATUS_COLOR[timeStatus] ?? TIME_STATUS_COLOR.unknown;
}

/** Whether this leg's line should render dashed - same signal as the
 * diagram's strokeDasharray (ansiblex's fixed style, or a wormhole whose
 * mass is critical), just expressed as a CSS border-style rather than an
 * SVG stroke-dasharray. */
export function routeLegDashed(leg: RouteLegOut): boolean {
  return leg.connection_type === "ansiblex" || leg.mass_status === "critical";
}

export function routeLegEdgeStyle(leg: RouteLegOut): CSSProperties {
  if (leg.connection_type !== "wormhole") {
    return (
      FIXED_CONNECTION_STYLE[leg.connection_type] ?? {
        stroke: "var(--text-dim)",
        strokeWidth: 2,
      }
    );
  }
  return {
    stroke: routeLegColor(leg),
    strokeWidth: 2,
    // Dashing is mass-based, not time-based - same independent-axis
    // reasoning as MapCanvas's own baseEdges.
    strokeDasharray: leg.mass_status === "critical" ? "6 4" : undefined,
  };
}

export function routeLegLabel(leg: RouteLegOut): string | undefined {
  if (leg.connection?.ship_size_limit) {
    return SHIP_SIZE_LABEL[leg.connection.ship_size_limit];
  }
  return leg.connection_type;
}
