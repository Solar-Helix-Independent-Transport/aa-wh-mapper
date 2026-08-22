"""API Schemas"""

# Standard Library
from datetime import datetime
from typing import Literal, Optional

# Third Party
from ninja import Schema

# Mirror wh_mapper.models.Signature.SignatureType/LifeStatus and
# WormholeConnection.MassStatus/ShipSize's choices= - kept as plain Literal
# aliases (like connection_type/visibility below) rather than derived from
# the model at import time, so this file has no Django-app-registry-order
# dependency on wh_mapper.models.
SignatureTypeLiteral = Literal[
    "unknown", "wormhole", "combat", "data", "relic", "gas", "ore"
]
LifeStatusLiteral = Literal["stable", "lt_48h", "lt_24h", "lt_12h", "lt_4h", "lt_1h"]
MassStatusLiteral = Literal["unknown", "fresh", "reduced", "critical"]
ShipSizeLiteral = Literal["unknown", "small", "medium", "large", "xlarge", "capital"]


class SystemOwnerOut(Schema):
    """Who controls a solar system - an NPC empire/pirate faction, or a
    player alliance holding null-sec sovereignty. See
    wh_mapper.api.helpers.bulk_system_owners."""

    type: Literal["alliance", "faction"]
    id: int
    name: str
    # Factions don't have tickers in EVE - only ever set for type="alliance".
    ticker: str | None = None
    icon_url: str


class SystemStaticOut(Schema):
    """One of a J-space system's fixed static wormhole connections - see
    wh_mapper.models.SystemStatic and wh_mapper.api.helpers.bulk_system_statics.
    `leads_to_class` is None for a code constants.CODE_TO_CLASS doesn't
    recognize (a new/unmapped code)."""

    code: str
    leads_to_class: int | None = None


class SolarSystemOut(Schema):
    """A referenced eve_sde.SolarSystem"""

    id: int
    name: str
    security_status: float | None = None
    wormhole_class_id: int | None = None
    visual_effect: str | None = None
    constellation_name: str | None = None
    region_name: str | None = None
    space_type: str
    owner: SystemOwnerOut | None = None
    # Only populated by callers that batch-resolve it up front (see
    # solar_system_to_schema's `statics` param, mirroring `owner` above) -
    # empty (not just unpopulated) for k-space, and for a J-space system
    # with no imported SystemStatic row.
    statics: list[SystemStaticOut] = []


class MapOut(Schema):
    """A Map"""

    id: int
    name: str
    owner_id: int
    owner_name: str
    visibility: Literal["private", "shared"]
    # A managed reference map (the eve-scout Thera/Turnur maps) - visible to
    # everyone with basic_access regardless of sharing, and rejects every
    # content-mutation endpoint for non-admins. See Map.read_only.
    read_only: bool
    # Whether *this* requesting user can actually mutate this map's content
    # right now - true for every ordinary map, false on a read_only map
    # unless the user has admin_access (mirrors
    # wh_mapper.api.helpers.require_writable_map exactly). The frontend
    # gates its edit UI on this, not the raw read_only flag, so an admin
    # still sees the normal editable UI on a read-only reference map.
    can_write: bool
    created_at: datetime
    # Latest of created_at, any system added, or any connection/signature
    # edit - see wh_mapper.api.helpers.map_last_updated. Falls back to
    # created_at itself for a still-empty map.
    last_updated: datetime
    is_owner: bool
    can_edit_sharing: bool
    active_users: int


class MapCreate(Schema):
    """Payload to create a Map"""

    name: str
    visibility: Literal["private", "shared"] = "private"


class MapUpdate(Schema):
    """Payload to update a Map"""

    name: str | None = None
    visibility: Literal["private", "shared"] | None = None


class MapSystemOut(Schema):
    """A MapSystem"""

    id: int
    map_id: int
    solar_system: SolarSystemOut
    label: str
    x: float
    y: float
    pinned: bool
    added_by_id: int | None = None
    added_at: datetime


class SystemDetailOut(Schema):
    """Everything beyond MapSystemOut's own fields for a system's
    right-click "Details" view - just the placer's resolved display name
    (added_by_id alone, like WormholeConnectionOut's created_by_id, carries
    no name). Not part of MapSystemOut itself since it's too expensive to
    compute for every system in a bulk fetch (get_map_state) - the rest of
    a system's detail (security/region/sovereignty, who's currently there,
    which connections touch it) is already fully present client-side in
    the map state the frontend already has, so this endpoint only needs to
    add the one missing piece."""

    added_by_name: str | None = None


class MapSystemCreate(Schema):
    """Payload to add a solar system to a Map"""

    solar_system_id: int
    label: str = ""
    x: float = 0
    y: float = 0
    pinned: bool = False


class MapSystemUpdate(Schema):
    """Payload to update a MapSystem"""

    label: str | None = None
    x: float | None = None
    y: float | None = None
    pinned: bool | None = None


class WormholeTypeOut(Schema):
    """A referenced wh_mapper.WormholeType"""

    code: str
    leads_to_class: int | None = None
    max_mass: float | None = None
    max_jump_mass: float | None = None
    max_stable_time: float | None = None


class SignatureOut(Schema):
    """A Signature"""

    id: int
    map_system_id: int
    signature_id: str
    sig_type: SignatureTypeLiteral
    wormhole_type: WormholeTypeOut | None = None
    life_status: LifeStatusLiteral
    life_status_marked_at: datetime | None = None
    is_hidden: bool
    updated_by_id: int | None = None
    updated_at: datetime


class SignatureCreate(Schema):
    """Payload to add a Signature to a MapSystem"""

    signature_id: str
    sig_type: SignatureTypeLiteral = "unknown"
    wormhole_type_code: str | None = None
    life_status: LifeStatusLiteral = "stable"


class SignatureUpdate(Schema):
    """Payload to update a Signature"""

    sig_type: SignatureTypeLiteral | None = None
    wormhole_type_code: str | None = None
    life_status: LifeStatusLiteral | None = None
    is_hidden: bool | None = None


class SignatureBulkRow(Schema):
    """A single row from a pasted probe-scan result"""

    signature_id: str
    sig_type: SignatureTypeLiteral | None = None


class SignatureBulkUpsert(Schema):
    """Payload to bulk-upsert Signatures on a MapSystem, by signature_id"""

    rows: list[SignatureBulkRow]
    # "Lazy delete": treat any existing signature in this MapSystem that
    # isn't in `rows` as gone (decayed, or its wormhole collapsed) and remove
    # it, along with any WormholeConnection linked to it.
    lazy_delete: bool = False
    # Only meaningful when lazy_delete is also true - additionally remove any
    # MapSystem left with zero connections by one of those removals (unless
    # pinned), cascading to any system that in turn goes dangling.
    remove_dangling_systems: bool = False


class SignatureBulkResult(Schema):
    """Result of a bulk Signature upsert"""

    signatures: list[SignatureOut]
    removed_signature_ids: list[int] = []
    removed_connection_ids: list[int] = []
    removed_system_ids: list[int] = []


class ConnectionSignatureLink(Schema):
    """Payload to attach a Signature to whichever end of a WormholeConnection
    it belongs to"""

    signature_id: int


class WormholeConnectionOut(Schema):
    """A WormholeConnection"""

    id: int
    map_id: int
    connection_type: Literal["wormhole", "stargate", "ansiblex"]
    top_system_id: int
    bottom_system_id: int
    # top_system_id/bottom_system_id above are MapSystem ids (this
    # connection's own FK target), not comparable to a SolarSystemOut.id
    # (e.g. RouteDetail.systems[].id) - these are the actual underlying
    # solar system ids, for a caller (like RouteDiagram) that needs to
    # match a connection's ends against solar-system-keyed data.
    top_system_solar_system_id: int
    bottom_system_solar_system_id: int
    top_signature_id: int | None = None
    bottom_signature_id: int | None = None
    # Full signature detail (code, type, identified wormhole type), not
    # just the id - the Map view already resolves this itself from its own
    # state.signatures, but a route leg (see RouteLegOut) has no such list
    # to resolve against, so this is populated for every caller rather
    # than adding a route-specific second field.
    top_signature: SignatureOut | None = None
    bottom_signature: SignatureOut | None = None
    life_status: LifeStatusLiteral
    life_status_marked_at: datetime | None = None
    mass_status: MassStatusLiteral
    ship_size_limit: ShipSizeLiteral
    time_status: Literal["green", "orange", "red", "unknown"]
    created_by_id: int | None = None
    created_at: datetime
    updated_at: datetime


class MapContributionOut(Schema):
    """One MapContribution row - a single bounty-attribution-worthy action
    recorded against a wormhole connection (see wh_mapper.models.
    MapContribution). `name` follows the same character-else-username
    fallback as RouteContributorOut."""

    id: int
    verb: Literal["added", "updated", "signature_linked"]
    character_id: int | None = None
    name: str
    created_at: datetime


class ConnectionDetailOut(Schema):
    """Everything else known about a single WormholeConnection beyond
    WormholeConnectionOut's own fields - who created it (resolved to a
    display name) and its full contribution history. Deliberately not part
    of WormholeConnectionOut itself: both are too expensive to compute for
    every connection in a bulk fetch (get_map_state, a route's legs), so
    this is a dedicated on-demand endpoint for the right-click "Details"
    view instead."""

    created_by_name: str | None = None
    contributions: list[MapContributionOut]


class WormholeConnectionCreate(Schema):
    """Payload to create a WormholeConnection"""

    top_system_id: int
    bottom_system_id: int
    connection_type: Literal["wormhole", "stargate", "ansiblex"] = "wormhole"
    top_signature_id: int | None = None
    bottom_signature_id: int | None = None
    mass_status: MassStatusLiteral = "unknown"
    ship_size_limit: ShipSizeLiteral = "unknown"


class WormholeConnectionUpdate(Schema):
    """Payload to update a WormholeConnection"""

    connection_type: Literal["wormhole", "stargate", "ansiblex"] | None = None
    life_status: LifeStatusLiteral | None = None
    mass_status: MassStatusLiteral | None = None
    ship_size_limit: ShipSizeLiteral | None = None


class TrackedCharacterOut(Schema):
    """A character being live-tracked on a Map via ESI location polling"""

    character_id: int
    character_name: str
    added_by_id: int
    is_online: bool
    last_solar_system: SolarSystemOut | None = None
    last_seen_at: datetime | None = None


class TrackableCharacterOut(Schema):
    """One of the requesting user's own characters that has ESI location
    access granted - either currently tracked, or available to toggle on
    without needing another EVE SSO round-trip."""

    character_id: int
    character_name: str
    is_tracked: bool
    is_online: bool = False
    last_solar_system: SolarSystemOut | None = None
    last_seen_at: datetime | None = None


class MapStateOut(Schema):
    """A full snapshot of a Map's graph"""

    map: MapOut
    systems: list[MapSystemOut]
    signatures: list[SignatureOut]
    connections: list[WormholeConnectionOut]
    tracked_characters: list[TrackedCharacterOut]
    current_user_id: int


class CharacterSearchResult(Schema):
    """A character search hit"""

    character_id: int
    character_name: str
    corporation_name: str = ""


class CorporationSearchResult(Schema):
    """A corporation search hit"""

    corporation_id: int
    corporation_name: str


class AllianceSearchResult(Schema):
    """An alliance search hit"""

    alliance_id: int
    alliance_name: str


class GroupSearchResult(Schema):
    """A group search hit - limited server-side to groups the requesting
    user is a member of."""

    group_id: int
    group_name: str


class ShareCreate(Schema):
    """Payload to grant map access"""

    scope: Literal["character", "corporation", "alliance", "group"]
    target_id: int


class ShareOut(Schema):
    """A single share grant"""

    scope: Literal["character", "corporation", "alliance", "group"]
    target_id: int
    # None for a character/corporation/alliance id AA has never seen locally
    # (shares are stored by raw id, not FK, so that's a valid state - see
    # wh_mapper.models.MapShare).
    target_name: str | None = None


class RegionOut(Schema):
    """A "flat" (regular k-space) eve_sde.Region, selectable to bulk-populate
    a map."""

    id: int
    name: str


class RegionGraphNodeOut(Schema):
    """One "flat" Region as a node in the universe-regions graph - see
    wh_mapper.api.helpers.build_region_graph. x/y are a centroid of the
    region's member systems, pre-scaled into REGION_IMPORT_LAYOUT_SIZE."""

    id: int
    name: str
    x: float
    y: float


class RegionGraphEdgeOut(Schema):
    """A cross-region Stargate pair, deduped to one edge per region pair.
    source/target match @xyflow's own Edge field names."""

    source: int
    target: int


class RegionGraphLandmarkOut(Schema):
    """A wormhole-only point of interest - Thera, one of the five Drifter
    regions, or Pochven - never linked to another flat region by a
    permanent Stargate, so never part of RegionGraphOut.nodes/edges. Has no
    server-computed position (see build_region_graph); the frontend lays
    these out itself, and derives any link from a landmark to a flat region
    from the currently open map's own connections, not this payload.

    id is a solar_system_id for "thera"/"drifter" (Thera's or a Drifter
    system's own id), or an eve_sde.Region id for "pochven"."""

    id: int
    name: str
    kind: Literal["thera", "drifter", "pochven"]


class RegionGraphOut(Schema):
    """The full region-to-region adjacency graph - not map/route-scoped,
    highlighting is computed client-side (see wayfinder map
    .scratch/universe-regions/issues/03-api-contract.md)."""

    nodes: list[RegionGraphNodeOut]
    edges: list[RegionGraphEdgeOut]
    landmarks: list[RegionGraphLandmarkOut]


class RegionImportRequest(Schema):
    """Payload to bulk-add every system in a Region to a Map"""

    region_id: int


class RegionImportResult(Schema):
    """Summary of a region bulk-import"""

    systems_added: int
    connections_added: int


class ImportMapRequest(Schema):
    """Payload to bulk-copy every system/signature/connection from another
    (read-only reference) Map onto this one - see
    wh_mapper.api.helpers.import_map_content."""

    source_map_id: int


class MapImportResult(Schema):
    """Summary of a map-to-map bulk-import - richer than
    RegionImportResult since a source Map (unlike an SDE Region) carries
    real signature detail too."""

    systems_added: int
    connections_added: int
    signatures_added: int


class RouteLegOut(Schema):
    """One hop of a computed route - see wh_mapper.pathfinding.RouteLeg.

    map_id/connection_id are None for a stargate leg (sourced from the
    static universe, not any Map) - present for wormhole/ansiblex legs so
    the frontend can call the existing connection update/delete endpoints,
    or the flag endpoints, directly from a route leg. `connection` carries
    the same WormholeConnectionOut shape the Map view uses (ship size,
    time_status, signature ids, etc.) - same source, same detail, no
    separate route-specific shape.
    """

    connection_type: Literal["stargate", "wormhole", "ansiblex"]
    life_status: LifeStatusLiteral | None = None
    mass_status: MassStatusLiteral | None = None
    map_id: int | None = None
    connection_id: int | None = None
    connection: WormholeConnectionOut | None = None


class RouteContributorOut(Schema):
    """Someone credited with bounty-worthy work (finding or maintaining a
    wormhole connection) along a computed route - see
    wh_mapper.models.MapContribution and
    wh_mapper.api.helpers._contributors_for_connection_ids."""

    character_id: int | None = None
    name: str
    contribution_count: int


class RouteDetail(Schema):
    """The ordered path - len(legs) == len(systems) - 1"""

    systems: list[SolarSystemOut]
    legs: list[RouteLegOut]
    contributors: list[RouteContributorOut] = []


class RouteOut(Schema):
    """Always-200 wrapper - found=False covers every unreachable case
    uniformly (including a totally isolated system), no special pre-check
    or 404 needed."""

    found: bool
    message: str | None = None
    route: RouteDetail | None = None
    # A strictly-shorter, risk-ignoring alternative `route` passed over -
    # see wh_mapper.pathfinding.RouteComputation.alternate. None when no
    # such alternative exists (the risk-weighted route is already fastest).
    alternate: RouteDetail | None = None


class RouteCreate(Schema):
    """Payload to share a computed route - promotes it to a persisted,
    live-updating Route."""

    start_id: int
    end_id: int


class SharedRouteOut(Schema):
    """A persisted, shared Route - see wh_mapper.models.Route"""

    id: int
    owner_id: int
    start_system: SolarSystemOut
    end_system: SolarSystemOut
    visibility: Literal["private", "shared"]
    found: bool
    systems: list[SolarSystemOut]
    legs: list[RouteLegOut]
    contributors: list[RouteContributorOut] = []
    # A strictly-shorter, risk-ignoring alternative to systems/legs above -
    # see wh_mapper.pathfinding.RouteComputation.alternate.
    alternate: RouteDetail | None = None
    last_computed_at: datetime | None = None
    is_owner: bool


class ConnectionFlagCreate(Schema):
    """Payload to suggest a connection status change - same vocabulary as
    WormholeConnectionUpdate, but for a user without edit access to the
    map (see wh_mapper.models.ConnectionFlag)."""

    suggested_life_status: LifeStatusLiteral | None = None
    suggested_mass_status: MassStatusLiteral | None = None
    suggests_collapsed: bool = False


class ConnectionFlagOut(Schema):
    id: int
    connection_id: int
    flagged_by_id: int
    flagged_by_name: str
    suggested_life_status: LifeStatusLiteral | None = None
    suggested_mass_status: MassStatusLiteral | None = None
    suggests_collapsed: bool
    created_at: datetime


class ConnectionFlagAcceptResult(Schema):
    """Result of accepting a flag - deleted=True means the suggestion was
    "suggests_collapsed" and the connection no longer exists."""

    deleted: bool
    connection: WormholeConnectionOut | None = None


class AvailableFleetCharacterOut(Schema):
    """One character in the backseat-FC token pool - any character (across
    every user's account, not just the requester's own) whose owner has
    granted fleet-read ESI access. See the fleet-mass-tracking wayfinder
    map's tickets 02/12."""

    character_id: int
    character_name: str
    owner_name: str
    has_active_session: bool


class FleetMemberOut(Schema):
    """One fleet member's live ship/location, as shown in the Navigate
    view's fleet overlay - see ticket 10/12. `solar_system` is always
    resolved (ESI always reports a real solar_system_id for every member);
    `hop_distance` is None for ticket 09's "unknown" (unreachable within the
    viewer's visible graph) state - distinct from 0 (the fleet boss
    themselves) or 1 (adjacent)."""

    character_id: int
    character_name: str
    ship_type_name: str
    solar_system: SolarSystemOut
    hop_distance: int | None = None


class FleetSessionOut(Schema):
    """A live backseat fleet-tracking session - see ticket 07/12."""

    id: int
    fc_character_id: int
    fc_character_name: str
    fleet_id: int
    started_by_id: int
    started_at: datetime
    is_watcher: bool
    # Mirrors SharedRouteOut.is_owner's shape - only the starter may stop
    # this session (ticket 07), so the frontend needs this rather than
    # comparing started_by_id against a raw current-user id it doesn't have.
    is_starter: bool
    members: list[FleetMemberOut]


class SdeStatusOut(Schema):
    """Local eve_sde import health - see wh_mapper.api.helpers.sde_status.
    build_number/release_date/last_check_date are None if the SDE has never
    been imported at all in this environment."""

    build_number: int | None = None
    release_date: datetime | None = None
    last_check_date: datetime | None = None
    total_solar_systems: int
    total_jspace_systems: int
    jspace_with_raw_wormhole_class: int


class TaskHeartbeatOut(Schema):
    """One periodic task's last-run status - see
    wh_mapper.api.helpers.task_heartbeat_status. last_run_at/last_success are
    None if the task has never run at all in this environment (still
    counts as `stale`)."""

    task_name: str
    expected_interval_seconds: int
    last_run_at: datetime | None = None
    last_success: bool | None = None
    last_error: str
    stale: bool


class UsageStatsOut(Schema):
    """Coarse app-wide activity counts - see wh_mapper.api.helpers.usage_stats."""

    total_maps: int
    private_maps: int
    shared_maps: int
    active_tracked_characters: int
    live_map_presences: int


class WormholeTypeCoverageOut(Schema):
    """How many WormholeType rows have each derived field populated - see
    wh_mapper.api.helpers.wormhole_type_coverage."""

    total: int
    with_leads_to_class: int
    with_max_mass: int
    with_max_jump_mass: int
    with_max_stable_time: int


class MapSummaryOut(Schema):
    """One Map row in the admin status page's full listing - see
    wh_mapper.api.helpers.admin_map_list. Distinct from MapOut: this is an
    admin-wide view (every map, not just the requesting user's visible
    ones), so it carries no viewer-relative fields like is_owner."""

    id: int
    name: str
    owner_name: str
    visibility: Literal["private", "shared"]
    created_at: datetime
    last_updated: datetime
    system_count: int
    active_users: int


class RouteSummaryOut(Schema):
    """One current (not yet pruned) shared Route, for the admin status
    page's full listing - see wh_mapper.api.helpers.admin_route_list."""

    id: int
    owner_name: str
    start_system_name: str
    end_system_name: str
    visibility: Literal["private", "shared"]
    found: bool
    last_viewed_at: datetime
    created_at: datetime


class AppStatusOut(Schema):
    """The whole admin status page's worth of data - see
    wh_mapper.api.helpers.app_status_to_schema."""

    sde: SdeStatusOut
    tasks: list[TaskHeartbeatOut]
    usage: UsageStatsOut
    wormhole_types: WormholeTypeCoverageOut
    maps: list[MapSummaryOut]
    routes: list[RouteSummaryOut]
