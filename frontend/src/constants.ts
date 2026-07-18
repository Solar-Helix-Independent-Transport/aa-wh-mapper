// Shared constants for the WH Mapper frontend. Centralized here instead of
// scattered across components so each value only needs updating in one
// place. Where a constant has a backend counterpart (see
// wh_mapper/constants.py), its comment says so - there's no automated way
// to keep a TypeScript and a Python constant in sync, so those pairs still
// rely on this cross-linking convention rather than one true source of
// truth.
import type { CSSProperties } from "react";
import type { ConnectionType } from "./api/types";

// The "/wh-mapper" mount point this SPA, its REST API, and its websocket are
// all served under - must match wh_mapper/urls.py's URL prefix in the
// Django project.
export const WH_MAPPER_URL_PREFIX = "/wh-mapper";

// xyflow snap-to-grid size, and the matching Background dot spacing -
// matches wh_mapper/constants.py's GRID_SIZE.
export const SNAP_GRID: [number, number] = [24, 24];

// Wormhole connection edge color by server-computed time_status (see
// wh_mapper.api.helpers.connection_time_status).
export const TIME_STATUS_COLOR: Record<string, string> = {
  green: "#4ade80",
  orange: "#ffb454",
  red: "#ff5c7a",
};

// Stargates/Ansiblexes don't decay, so they get a fixed look instead of the
// time-status color coding above.
export const FIXED_CONNECTION_STYLE: Partial<
  Record<ConnectionType, CSSProperties>
> = {
  stargate: { stroke: "#ffffff", strokeWidth: 2 },
  ansiblex: {
    stroke: "var(--text-dim)",
    strokeWidth: 2,
    strokeDasharray: "2 3",
  },
};

// Dropdown options mirroring backend TextChoices - see wh_mapper.models'
// Signature.SignatureType / LifeStatus and WormholeConnection.ConnectionType
// / MassStatus / ShipSize.
export const SIG_TYPES = [
  "unknown",
  "wormhole",
  "combat",
  "data",
  "relic",
  "gas",
  "ore",
];
// A countdown-to-collapse ladder, not a plain stable/EOL flag - see
// wh_mapper.models' LifeStatus. Only ever manually picked (via the select
// this backs) while the wormhole type is unidentified; once known, the
// bucket is fully computed - see wormholeClass.ts's effectiveLifeStatus.
export const LIFE_STATUSES = [
  "stable",
  "lt_48h",
  "lt_24h",
  "lt_12h",
  "lt_4h",
  "lt_1h",
];
export const CONNECTION_TYPES: ConnectionType[] = [
  "wormhole",
  "stargate",
  "ansiblex",
];
export const MASS_STATUSES = ["unknown", "fresh", "reduced", "critical"];
export const SHIP_SIZE_LIMITS = [
  "unknown",
  "small",
  "medium",
  "large",
  "capital",
];

// Human-readable labels for LIFE_STATUSES - the stored/wire values are short
// codes (max_length=10 on the backend), not fit for direct display.
export const LIFE_STATUS_LABEL: Record<string, string> = {
  stable: "Stable",
  lt_48h: "< 48h",
  lt_24h: "< 24h",
  lt_12h: "< 12h",
  lt_4h: "< 4h",
  lt_1h: "< 1h",
};

// Short badge text for a connection's ship_size_limit, shown on the edge
// itself in place of the wormhole type code - 'unknown' has no entry so it
// renders no badge at all, same as an unidentified type code used to.
export const SHIP_SIZE_LABEL: Partial<Record<string, string>> = {
  small: "S",
  medium: "M",
  large: "L",
  capital: "XL",
};

// <datalist> element ids linking a text input to its suggestions.
export const SYSTEM_FINDER_DATALIST_ID = "wh-mapper-system-options";
export const WORMHOLE_TYPE_DATALIST_ID = "wh-mapper-wormhole-type-options";
export const JUMP_WORMHOLE_TYPE_DATALIST_ID =
  "wh-mapper-jump-wormhole-type-options";

// Manually-added-system placement (AddSystemDialog) - not required to match
// wh_mapper/constants.py's NEW_SYSTEM_OFFSET_X (that's for auto-added
// systems from character tracking, a different placement flow).
export const NEW_SYSTEM_SPACING_X = 220;
export const NEW_SYSTEM_SPACING_Y = 60;

// Maps the server's space_type label (wh_mapper.api.helpers.space_type_label)
// to a CSS class - the keys must stay in sync with that function's return
// values.
export const SPACE_TYPE_CLASS: Record<string, string> = {
  "High Sec": "space-highsec",
  "Low Sec": "space-lowsec",
  "Null Sec": "space-nullsec",
  Wormhole: "space-wormhole",
  Pochven: "space-pochven",
  "Abyssal Deadspace": "space-abyssal",
};

// Close codes MapConsumer sends for a deliberate, non-recoverable rejection
// (see wh_mapper/consumers.py) - retrying without a code/permission change
// would just hammer the server forever, so these stop the retry loop instead
// of the usual exponential backoff. Matches wh_mapper/constants.py's
// WS_CLOSE_UNAUTHENTICATED / WS_CLOSE_FORBIDDEN.
export const TERMINAL_WS_CLOSE_CODES = new Set([4401, 4403]);

// useMapSocket reconnect backoff (milliseconds).
export const WS_RECONNECT_INITIAL_DELAY_MS = 1000;
export const WS_RECONNECT_MAX_DELAY_MS = 30_000;

// How often useMapSocket sends a {"type": "ping"} heartbeat frame over an
// open map socket - see wh_mapper/consumers.py's MapConsumer.receive_json,
// which bumps MapPresence.last_seen_at on each one so
// wh_mapper.tasks.prune_stale_map_presence can tell a connection is still
// genuinely open. Matches wh_mapper/constants.py's
// MAP_PRESENCE_PING_INTERVAL_SECONDS.
export const MAP_PRESENCE_PING_INTERVAL_MS = 30_000;

// TrackedCharactersPanel's "Xm ago" label refresh tick (milliseconds).
export const TRACKED_CHARACTERS_REFRESH_INTERVAL_MS = 30_000;

// Absolute hours-of-life-remaining boundaries backing the LifeStatus
// countdown ladder (stable -> lt_48h -> lt_24h -> lt_12h -> lt_4h -> lt_1h ->
// pruned) - same thresholds regardless of wormhole type. Matches
// wh_mapper/constants.py's LIFE_STATUS_HOUR_BOUNDS; see
// wormholeClass.ts's effectiveLifeStatus, which computes the same bucket
// live (from wormhole_type.max_stable_time when known, or from
// life_status_marked_at as a manual-fallback countdown otherwise) so the
// displayed status keeps advancing between server pushes without waiting on
// one for every transition.
export const LIFE_STATUS_HOUR_BOUNDS = [48, 24, 12, 4, 1];

// How often edges/signature rows re-check remaining life against the
// current time to advance to the next bucket - hour-scale precision doesn't
// need to be finer than this.
export const LIFE_STATUS_CHECK_INTERVAL_MS = 60_000;

// useSearch's type-ahead debounce and minimum query length before it calls
// the server at all - shared by every "search as you type" picker
// (AddSystemDialog, ConnectSignatureDialog, ShareDialog).
export const SEARCH_DEBOUNCE_MS = 250;
export const SEARCH_MIN_QUERY_LENGTH = 2;

// SignaturePanel's drag-to-resize width bounds and default, and the
// localStorage keys MapView persists the user's chosen width/hidden state
// under (so it survives a reload, per-browser rather than per-map).
export const SIGNATURE_PANEL_DEFAULT_WIDTH = 420;
export const SIGNATURE_PANEL_MIN_WIDTH = 280;
export const SIGNATURE_PANEL_MAX_WIDTH = 800;
export const SIGNATURE_PANEL_WIDTH_STORAGE_KEY =
  "wh-mapper-signature-panel-width";
export const SIGNATURE_PANEL_HIDDEN_STORAGE_KEY =
  "wh-mapper-signature-panel-hidden";
