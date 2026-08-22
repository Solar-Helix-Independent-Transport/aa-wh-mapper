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
# while there's anyone to poll - see wh_mapper.tasks. Split from
# FLEET_POLL_RESCHEDULE_SECONDS below (they used to be one shared constant)
# so tightening character-location polling doesn't also silently speed up
# fleet-session polling, a separate feature with its own ESI load profile.
CHARACTER_LOCATION_POLL_RESCHEDULE_SECONDS = 6

# How often (seconds) poll_fleet_tracking_sessions reschedules itself while
# any session is active - see wh_mapper.tasks. ESI's fleet-members endpoint
# has its own 5s cache (see the fleet-mass-tracking wayfinder map's ticket
# 05 research), so this stays comfortably above that floor.
FLEET_POLL_RESCHEDULE_SECONDS = 10

# ESI scope required to read a fleet's composition/member locations - see
# wh_mapper.tasks.poll_fleet_session and the fleet-mass-tracking wayfinder
# map's ticket 05 research (a single scope covers both fleet endpoints;
# there is no boss-only variant).
FLEET_SCOPES = ["esi-fleets.read_fleet.v1"]

# Remaining-mass-fraction thresholds bucketing WormholeConnection's
# computed mass_status (fresh/reduced/critical) - see
# wh_mapper.api.helpers.mass_status_for_remaining_fraction. Matches the
# convention EVE's own client and community mapping tools already use, per
# the fleet-mass-tracking wayfinder map's ticket 06.
MASS_STATUS_FRESH_FRACTION = 0.5
MASS_STATUS_CRITICAL_FRACTION = 0.1

# Consecutive failed fleet-members polls before a FleetTrackingSession
# auto-stops - see wh_mapper.tasks.poll_fleet_session and the fleet-mass-
# tracking wayfinder map's ticket 07. Tolerates one transient ESI blip
# without leaving a genuinely-dead session polling indefinitely.
FLEET_SESSION_FAILURE_THRESHOLD = 3

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

# eve_sde.SolarSystem.wormhole_class_id_raw comes from CCP's own
# "wormholeClassID" SDE field - but as of the SDE snapshot checked when this
# was added, CCP's current static-data export only actually publishes that
# field for 692 of 8490 systems total (687 low-sec k-space systems and the 5
# Drifter regions), never for ordinary C1-C6/C13/Thera systems - so
# wormhole_class_id_raw is null for nearly every real wormhole system. EVE's
# wormhole region-naming convention (a region's name always starts with a
# letter denoting its class) fills that gap - verified deterministic with
# zero mismatches against all 2604 real J-space systems in zKillboard's
# wh_effects.csv (github.com/zKillboard/zKillboard, commit fb8ce9d) - see
# wh_mapper.api.helpers.wormhole_class_id.
WORMHOLE_REGION_LETTER_TO_CLASS = {
    "A": 1, "B": 2, "C": 3, "D": 4, "E": 5, "F": 6, "G": 12, "H": 13,
}
# The five Drifter regions all share one real region name ("K-R00033"), so
# they can't be told apart by that region-letter convention alone - keyed by
# solar_system_id instead. Matches frontend/src/components/wormholeClass.ts's
# CLASS_LABELS 14-18 and wh_mapper_derive_wormhole_types.py's CODE_TO_CLASS.
DRIFTER_SYSTEM_CLASS = {
    31000001: 14,  # Sentinel MZ
    31000002: 15,  # Liberated Barbican
    31000003: 16,  # Sanctified Vidette
    31000004: 17,  # Conflux Eyrie
    31000006: 18,  # Azdaja Redoubt
}

# Thera's own solar_system_id - unlike ordinary J-space systems, every
# wormhole chain agrees on this one fixed system as "Thera" (it's a single,
# well-known hub, not a class of interchangeable systems). See
# wh_mapper.api.helpers.build_region_graph's landmark nodes.
THERA_SYSTEM_ID = 31000005

# Pochven's real eve_sde.Region id - mirrors eve_sde.models.map's own
# POCHVEN_REGION_ID (not imported directly - that's a private submodule
# path, and every other wh_mapper region/system id like DRIFTER_SYSTEM_CLASS
# and THERA_SYSTEM_ID above is already its own hardcoded constant rather
# than reaching into eve_sde's internals). See
# wh_mapper.api.helpers.build_region_graph.
POCHVEN_REGION_ID = 10000070

# Wormhole type code -> destination class - sourced from zKillboard's
# setup/sig2class.csv (github.com/zKillboard/zKillboard, commit fb8ce9d), a
# community-curated table (this has no SDE dogma attribute at all - see
# wh_mapper.models.WormholeType). Same convention/class-numbering as
# WORMHOLE_REGION_LETTER_TO_CLASS/DRIFTER_SYSTEM_CLASS above and frontend/
# src/components/wormholeClass.ts's CLASS_LABELS. Shared by two consumers so
# both derive the same class for a given code from one table:
# wh_mapper_derive_wormhole_types (WormholeType.leads_to_class) and
# wh_mapper.api.helpers.bulk_system_statics (a system's static-connection
# badges, from wh_mapper.models.SystemStatic). Pochven's code (F216) is
# deliberately omitted: this codebase has no numeric wormhole_class_id for
# Pochven (space_type_label detects it by region instead), so there's no
# class value to assign it.
_CODE_TO_CLASS_GROUPS: dict[int, tuple[str, ...]] = {
    1: ("H121", "Z647", "V301", "P060", "Y790", "Q317", "Z971", "E004"),
    2: ("C125", "D382", "I182", "N766", "D364", "G024", "R943", "L005"),
    3: ("O883", "O477", "N968", "C247", "M267", "L477", "X702", "Z006"),
    4: ("M609", "Y683", "T405", "X877", "E175", "Z457", "O128", "M001"),
    5: ("L614", "N062", "N770", "H900", "H296", "V911", "M555", "C008"),
    6: ("S804", "R474", "A982", "U574", "V753", "W237", "B041", "U239", "G008"),
    7: ("N110", "B274", "D845", "S047", "D792", "B520", "A641", "B449", "Q063"),  # High-sec
    8: ("J244", "A239", "U210", "N290", "C140", "C391", "R051", "N944", "V898"),  # Low-sec
    9: ("Z060", "E545", "K346", "K329", "Z142", "C248", "V283", "S199", "E587", "Q003"),  # Null-sec
    12: ("F353", "F135", "T458", "M164", "L031"),  # Thera
    13: ("A009",),  # C13 (shattered)
    14: ("S877",),  # Sentinel
    15: ("B735",),  # Barbican
    16: ("V928",),  # Vidette
    17: ("C414",),  # Conflux
    18: ("R259",),  # Redoubt
}
CODE_TO_CLASS: dict[str, int] = {
    code: class_id
    for class_id, codes in _CODE_TO_CLASS_GROUPS.items()
    for code in codes
}

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

# Expected run interval (seconds) for each of wh_mapper's periodic Celery
# tasks (see wh_mapper.tasks.record_task_heartbeat/track_heartbeat) - matches
# this app's README's CELERYBEAT_SCHEDULE section. Used by the admin status
# page to flag a heartbeat that's gone stale (see
# wh_mapper.api.helpers.task_heartbeat_status), rather than just showing a
# raw timestamp someone has to do the "is that too long ago?" math on
# themselves. prune_stale_routes isn't actually in the README's
# CELERYBEAT_SCHEDULE snippet despite its own docstring saying hourly - a
# real gap in the docs, not something to silently paper over here, but this
# still needs *a* number to compare against, so it uses what the docstring
# promises.
TASK_EXPECTED_INTERVAL_SECONDS = {
    "poll_tracked_character_locations": 60,
    "age_wormhole_connections": 300,
    "refresh_system_sovereignty": 3600,
    "prune_stale_map_presence": 120,
    "prune_stale_routes": 3600,
}
