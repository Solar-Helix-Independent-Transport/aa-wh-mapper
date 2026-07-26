import type {
  SignatureOut,
  WormholeConnectionOut,
  WormholeTypeOut,
} from "../api/types";
import {
  LIFE_STATUS_HOUR_BOUNDS,
  UNKNOWN_STABLE_MAX_HOURS,
} from "../constants";

// Common community convention for EVE's wormhole_class_id; not verified against
// a real imported SDE in this workspace (see docs/wh-mapper-plan.md). Treat as
// a display hint, not authoritative game data.
// Shared by ConnectionDetailsDialog and SystemDetailsDialog's connections
// list - kept here (a non-component module) rather than in either dialog
// file, since exporting a plain constant from a component file breaks fast
// refresh.
export const CONNECTION_TYPE_LABEL: Record<string, string> = {
  wormhole: "Wormhole",
  stargate: "Stargate",
  ansiblex: "Jump bridge",
};

const CLASS_LABELS: Record<number, string> = {
  1: "C1",
  2: "C2",
  3: "C3",
  4: "C4",
  5: "C5",
  6: "C6",
  7: "High-sec",
  8: "Low-sec",
  9: "Null-sec",
  12: "Thera",
  13: "C13",
};

export function wormholeClassLabel(classId: number | null): string | null {
  if (classId === null) {
    return null;
  }
  return CLASS_LABELS[classId] ?? `Class ${classId}`;
}

// Thresholds (kg) separating wormhole ship-size classes by max jump mass -
// community convention (Frigate/Medium/Large/XL breakpoints), same caveat as
// CLASS_LABELS above: not verified against a real imported SDE, treat as a
// display hint. Checked low-to-high, first threshold the mass fits under wins.
const SHIP_SIZE_JUMP_MASS_MAX: [number, string][] = [
  [5_000_000, "small"],
  [20_000_000, "medium"],
  [375_000_000, "large"],
];

export function shipSizeForJumpMass(maxJumpMass: number | null): string | null {
  if (maxJumpMass === null) {
    return null;
  }
  const tier = SHIP_SIZE_JUMP_MASS_MAX.find(([max]) => maxJumpMass <= max);
  return tier ? tier[1] : "capital";
}

// Same order as LIFE_STATUS_HOUR_BOUNDS - mirrors
// wh_mapper.api.helpers.LIFE_STATUS_BUCKET_ORDER/LIFE_STATUS_BUCKET_HOURS.
const LIFE_STATUS_BUCKET_ORDER = [
  "lt_48h",
  "lt_24h",
  "lt_12h",
  "lt_4h",
  "lt_1h",
];
const LIFE_STATUS_BUCKET_HOURS: Record<string, number> = Object.fromEntries(
  LIFE_STATUS_BUCKET_ORDER.map((bucket, index) => [
    bucket,
    LIFE_STATUS_HOUR_BOUNDS[index],
  ]),
);
// Stable's own assumed starting point - not part of the ladder above (it's
// never a threshold lifeStatusForRemainingHours checks against), but still
// needs an entry so an unidentified "stable" pick counts down like any
// other manual bucket instead of sitting frozen forever.
LIFE_STATUS_BUCKET_HOURS.stable = UNKNOWN_STABLE_MAX_HOURS;

// Mirrors wh_mapper.api.helpers.life_status_for_remaining_hours - the
// smallest (tightest) bound the value still fits under wins, so this checks
// lt_1h before lt_4h before lt_12h etc. (checking largest-first would always
// match lt_48h for anything under 48h).
function lifeStatusForRemainingHours(remainingHours: number): string {
  for (let i = LIFE_STATUS_BUCKET_ORDER.length - 1; i >= 0; i--) {
    if (remainingHours <= LIFE_STATUS_HOUR_BOUNDS[i]) {
      return LIFE_STATUS_BUCKET_ORDER[i];
    }
  }
  return "stable";
}

// The current life_status bucket for a signature/connection, computed live
// rather than trusting the stored field directly - mirrors
// wh_mapper.api.helpers.connection_effective_life_status (also used there
// server-side, for wh_mapper.tasks.age_wormhole_connections' pruning and for
// connection_time_status's edge coloring). Two sources, in priority order:
// the wormhole type's real max_stable_time once identified (elapsed time
// measured from `referenceTime` - a connection's created_at, or a
// signature's updated_at), or failing that, a manually-picked bucket
// counting down from lifeStatusMarkedAt. Ticking `now` forward (see useNow)
// lets the displayed bucket keep advancing between server pushes, all the
// way up to the final "lt_1h" - only the eventual delete needs an actual
// server push.
export function effectiveLifeStatus(
  lifeStatus: string,
  lifeStatusMarkedAt: string | null,
  wormholeType: WormholeTypeOut | null | undefined,
  referenceTime: string,
  now: number,
): string {
  if (wormholeType?.max_stable_time != null) {
    const elapsedHours =
      (now - new Date(referenceTime).getTime()) / (1000 * 60 * 60);
    return lifeStatusForRemainingHours(
      wormholeType.max_stable_time / 60 - elapsedHours,
    );
  }
  if (lifeStatusMarkedAt && lifeStatus in LIFE_STATUS_BUCKET_HOURS) {
    const elapsedHours =
      (now - new Date(lifeStatusMarkedAt).getTime()) / (1000 * 60 * 60);
    return lifeStatusForRemainingHours(
      LIFE_STATUS_BUCKET_HOURS[lifeStatus] - elapsedHours,
    );
  }
  return lifeStatus;
}

// The WormholeType backing a connection, from whichever end's Signature has
// one set (a connection can be scanned from either side) - mirrors
// wh_mapper.api.helpers.connection_wormhole_type. Once identified, this
// takes priority over the connection's manually-set mass/ship-size/life
// status fields, which only exist as a fallback for before the type is known
// - see the two call sites in MapCanvas.tsx/SignaturePanel.tsx.
export function connectionWormholeType(
  connection: Pick<
    WormholeConnectionOut,
    "top_signature_id" | "bottom_signature_id"
  >,
  signatures: SignatureOut[],
): WormholeTypeOut | null | undefined {
  const topSignature = signatures.find(
    (s) => s.id === connection.top_signature_id,
  );
  const bottomSignature = signatures.find(
    (s) => s.id === connection.bottom_signature_id,
  );
  return topSignature?.wormhole_type ?? bottomSignature?.wormhole_type;
}

export function wormholeTypeSummary(wt: WormholeTypeOut): string {
  const parts: string[] = [];
  const leadsTo = wormholeClassLabel(wt.leads_to_class);
  if (leadsTo) {
    parts.push(`→ ${leadsTo}`);
  }
  if (wt.max_mass) {
    parts.push(`${wt.max_mass.toLocaleString()} kg max`);
  }
  if (wt.max_jump_mass) {
    parts.push(`${wt.max_jump_mass.toLocaleString()} kg/jump`);
  }
  if (wt.max_stable_time) {
    parts.push(`${wt.max_stable_time}m lifetime`);
  }
  return parts.join(" · ");
}

/** WormholeTypeOut rows deduped by `code`, for a wormhole-type <datalist> -
 * the backend's WormholeType rows aren't unique per code (CCP's SDE reuses
 * the same displayed code across multiple distinct ItemTypes that differ
 * only in shattered-wormhole target-distribution weighting; see
 * wh_mapper.models.WormholeType), so listing every row verbatim would offer
 * duplicate options for the same code. */
export function wormholeTypeDatalistOptions(
  wormholeTypes: WormholeTypeOut[],
): WormholeTypeOut[] {
  return [...new Map(wormholeTypes.map((wt) => [wt.code, wt])).values()];
}
