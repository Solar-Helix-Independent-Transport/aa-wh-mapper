"""Shared constants for the WH Mapper backend.

Centralized here instead of scattered across modules so each value only
needs updating in one place. Where a constant has a frontend counterpart
(see frontend/src/constants.ts), its comment says so - there's no automated
way to keep a Python and a TypeScript constant in sync, so those pairs still
rely on this cross-linking convention rather than one true source of truth.
"""

# ESI scopes required to poll a tracked character's location/online status -
# see wh_mapper.tasks, wh_mapper.views.add_tracked_character.
LOCATION_SCOPES = [
    "esi-location.read_location.v1",
    "esi-location.read_online.v1",
]

# How often (seconds) poll_tracked_character_locations reschedules itself
# while there's anyone to poll - see wh_mapper.tasks.
POLL_RESCHEDULE_SECONDS = 10

# Canvas grid unit a newly-tracked-character-jump system snaps to - matches
# frontend/src/constants.ts's SNAP_GRID.
GRID_SIZE = 24

# Horizontal offset (in canvas units) for placing a system a tracked
# character just jumped into, relative to the system they came from - see
# wh_mapper.tasks._position_near.
NEW_SYSTEM_OFFSET_X = GRID_SIZE * 6

# The whole imported chunk of a region is laid out inside this many "pixels"
# on the canvas, preserving the region's real relative layout (via its
# x_2d/y_2d SDE coordinates) but scaled to roughly the same neighborhood size
# new manually-added systems already use - see wh_mapper.api.regions. Not
# required to match frontend/src/constants.ts's NEW_SYSTEM_SPACING_X/Y (a
# different placement flow - manual "+Add system" vs bulk region import).
REGION_IMPORT_LAYOUT_SIZE = 2400

# Websocket close codes MapConsumer sends for a deliberate, non-recoverable
# rejection (auth/permission failures) - see wh_mapper.consumers. Matches
# frontend/src/constants.ts's TERMINAL_WS_CLOSE_CODES.
WS_CLOSE_UNAUTHENTICATED = 4401
WS_CLOSE_FORBIDDEN = 4403

# How often (ms) useMapSocket sends a {"type": "ping"} heartbeat frame over
# an open map socket - see frontend/src/constants.ts's MAP_PRESENCE_PING_INTERVAL_MS
# and wh_mapper.consumers.MapConsumer.receive_json, which bumps
# MapPresence.last_seen_at on each one.
MAP_PRESENCE_PING_INTERVAL_SECONDS = 30

# How long (seconds) a MapPresence row can go without a heartbeat before
# wh_mapper.tasks.prune_stale_map_presence treats it as abandoned (a
# disconnect() that never fired) and deletes it. Comfortably above
# MAP_PRESENCE_PING_INTERVAL_SECONDS to tolerate a missed ping or two from
# normal network jitter without evicting a still-live connection.
MAP_PRESENCE_STALE_AFTER_SECONDS = MAP_PRESENCE_PING_INTERVAL_SECONDS * 4

# How long (seconds) a shared Route can go unviewed before
# wh_mapper.tasks.prune_stale_routes deletes it - a shared route is a
# casual, disposable artifact (see wh_mapper.models.Route), not something
# meant to persist indefinitely. 48 hours.
ROUTE_STALE_AFTER_SECONDS = 60 * 60 * 48

# security_status at/above which a k-space system is considered High Sec
# (below is Low Sec down to 0.0, Null Sec below that) - see
# wh_mapper.api.helpers.space_type_label.
HIGH_SEC_SECURITY_THRESHOLD = 0.45

# Solar system id range CCP's SDE uses for J-space (wormhole) systems - see
# wh_mapper.api.helpers._is_kspace_system_id. Upper bound is exclusive.
WORMHOLE_SPACE_ID_MIN = 31_000_000
WORMHOLE_SPACE_ID_MAX = 32_000_000

# Fraction of a wormhole connection's max_stable_time elapsed before its
# traffic-light status downgrades (green -> orange -> red) - see
# wh_mapper.api.helpers.connection_time_status.
CONNECTION_TIME_STATUS_GREEN_THRESHOLD = 0.5
CONNECTION_TIME_STATUS_ORANGE_THRESHOLD = 0.85

# Absolute hours-of-life-remaining boundaries backing Signature/
# WormholeConnection.LifeStatus's countdown ladder (stable -> lt_48h ->
# lt_24h -> lt_12h -> lt_4h -> lt_1h -> pruned) - same thresholds regardless
# of wormhole type, per product decision (two wormhole types "both at <24h
# remaining" mean the same thing in real time, even though one might have a
# much longer total lifetime than the other). Ordered descending: the first
# entry whose hours the actual remaining time falls under wins - see
# wh_mapper.api.helpers.life_status_for_remaining_hours. Once remaining
# hours drops to/below 0 (past the smallest bucket), it's pruned entirely -
# see wh_mapper.tasks.age_wormhole_connections. Matches frontend/src/
# constants.ts's LIFE_STATUS_HOUR_BOUNDS.
LIFE_STATUS_HOUR_BOUNDS = [48, 24, 12, 4, 1]

# Assumed starting lifespan (hours) for a manually-marked "stable" bucket
# while the wormhole type is still unidentified - see
# wh_mapper.api.helpers.apply_life_status/LIFE_STATUS_BUCKET_HOURS. Without
# this, "stable" had no countdown anchor at all and could sit unaged
# forever, even past when a real wormhole would have long since collapsed.
# 48h matches the longest max_stable_time actually seen across the SDE's
# WormholeType rows (e.g. B041/U319/B520/C391) - the most generous (latest
# possible collapse) real assumption, so this never prunes a hole early.
# Matches frontend/src/constants.ts's UNKNOWN_STABLE_MAX_HOURS.
UNKNOWN_STABLE_MAX_HOURS = 48
