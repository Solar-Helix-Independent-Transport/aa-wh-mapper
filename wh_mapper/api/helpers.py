"""Shared helpers for the WH Mapper API"""

# Standard Library
import logging

# Third Party
# Django EvE SDE
from eve_sde.models import EveSDE, ItemType, Region, SolarSystem, Stargate

# Django
from django.db import IntegrityError
from django.db.models import Count, F, Max, Min, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone

# Alliance Auth
from allianceauth.eveonline.models import EveAllianceInfo, EveCharacter, EveFactionInfo

# AA WH Mapper App
from wh_mapper.broadcast import broadcast_map_event, revoke_map_access
from wh_mapper.constants import (
    CONNECTION_TIME_STATUS_GREEN_THRESHOLD,
    CONNECTION_TIME_STATUS_ORANGE_THRESHOLD,
    DRIFTER_SYSTEM_CLASS,
    HIGH_SEC_SECURITY_THRESHOLD,
    LIFE_STATUS_HOUR_BOUNDS,
    MASS_STATUS_CRITICAL_FRACTION,
    MASS_STATUS_FRESH_FRACTION,
    TASK_EXPECTED_INTERVAL_SECONDS,
    UNKNOWN_STABLE_MAX_HOURS,
    WORMHOLE_REGION_LETTER_TO_CLASS,
    WORMHOLE_SPACE_ID_MAX,
    WORMHOLE_SPACE_ID_MIN,
)
from wh_mapper.models import (
    Map,
    MapContribution,
    MapPresence,
    MapSystem,
    Route,
    Signature,
    SystemSovereignty,
    TaskHeartbeat,
    TrackedCharacter,
    WormholeConnection,
    WormholeType,
)

logger = logging.getLogger(__name__)


def require_basic_access(request):
    """The `wh_mapper.basic_access` gate every endpoint needs first. Returns
    a (status, message) error tuple to return directly when denied, else
    None - same shape as get_visible_map's error half, so both compose the
    same way in a caller.
    """

    if not request.user.has_perm("wh_mapper.basic_access"):
        return 403, "Permission denied"
    return None


def require_admin_access(request):
    """The `wh_mapper.admin_access` gate for endpoints meant for map
    admins only (the app status page) - same (status, message)-or-None
    shape as require_basic_access. `admin_access` already gates
    can_edit_map/map_visible_to_user for "manage any map"; this is the
    same permission, just for something that isn't map-scoped at all.
    """

    if not request.user.has_perm("wh_mapper.admin_access"):
        return 403, "Permission denied"
    return None


def require_backseat_fc(request):
    """The `wh_mapper.backseat_fc` gate every fleet-tracking endpoint needs
    first - same (status, message) shape as require_basic_access, so both
    compose the same way in a caller. See the fleet-mass-tracking wayfinder
    map's tickets 02/11: this is deliberately a separate, narrower
    permission than basic_access - fleet composition/position is treated as
    more sensitive than ordinary map access."""

    if not request.user.has_perm("wh_mapper.backseat_fc"):
        return 403, "Permission denied"
    return None


def require_visible_map(request, map_id: int):
    """require_basic_access + get_visible_map, the pair almost every
    map-scoped endpoint needs, in the order they must run in (permission
    before existence, so an unprivileged user gets a uniform 403 rather than
    a 404 that would leak whether map_id exists). Returns (map_obj, error):
    error is a (status, message) tuple to return directly when non-None.
    """

    error = require_basic_access(request)
    if error:
        return None, error
    return get_visible_map(request, map_id)


def map_visible_to_user(user, map_id: int) -> bool:
    """Admin-access bypass, else Map.visible_to - the single predicate
    shared by get_visible_map (HTTP) and
    wh_mapper.consumers.MapConsumer.user_can_view_map_sync (websocket), so a
    future visibility rule change can't be applied to one path and silently
    miss the other.
    """

    if user.has_perm("wh_mapper.admin_access"):
        return Map.objects.filter(pk=map_id).exists()
    return Map.objects.visible_to(user).filter(pk=map_id).exists()


def get_visible_map(request, map_id: int):
    """Fetch a Map the requesting user is allowed to see, or return an
    (status, message) error tuple for the endpoint to return directly.

    Note: on this app, "visible" and "editable" are the same thing for
    everyday map content (systems/signatures/connections) - see
    can_edit_map's docstring for why.
    """

    map_obj = get_object_or_404(Map, pk=map_id)

    if not map_visible_to_user(request.user, map_id):
        return None, (404, "Map not found")

    return map_obj, None


def can_edit_map(request, map_obj: Map) -> bool:
    """Whether the requesting user may rename/delete the Map itself, and
    (deliberately, by product design) is also the *effective* gate on the
    map's actual content in practice: this app has no separate
    "read-only viewer" role for systems/signatures/connections. Anyone who
    can see a map at all - the owner, or anyone it's been shared with, by
    character/corporation/alliance/group - can add, edit, and delete its
    systems, signatures, and connections; see wh_mapper.api.systems/
    signatures/connections, which gate their mutation endpoints on
    get_visible_map alone. This mirrors how other real-time collaborative
    wormhole mappers (Tripwire, Pathfinder) treat "shared" access: sharing a
    map is sharing the ability to keep it updated together, not a
    read-only preview. Only the small set of actions gated here (rename,
    delete) and by can_edit_sharing (who it's shared with) stay owner-only.
    """

    if request.user.has_perm("wh_mapper.admin_access"):
        return True

    return map_obj.owner_id == request.user.id


def can_edit_sharing(request, map_obj: Map) -> bool:
    """Whether the requesting user may change who a map is shared with.

    Deliberately narrower than can_edit_map: reassigning a map's visibility
    is more sensitive than renaming/deleting it, so this is limited to the
    map's owner or an actual Django superuser - a `wh_mapper.admin_access`
    grant (which can cover a wider group, e.g. corp leadership) is not
    enough on its own. Anyone who can see the map at all may still *view*
    who it's shared with - see the list_shares endpoint - this only gates
    adding/removing a share.
    """

    return map_obj.owner_id == request.user.id or request.user.is_superuser


def map_last_updated(map_obj: Map):
    """The most recent map-content change - created_at alone never changes,
    so this is the max of created_at, any system's added_at, and any
    connection's or signature's updated_at. Falls back to created_at for a
    still-empty map (nothing added yet)."""

    candidates = [map_obj.created_at]

    latest_system = map_obj.systems.aggregate(latest=Max("added_at"))["latest"]
    if latest_system:
        candidates.append(latest_system)

    latest_connection = map_obj.connections.aggregate(latest=Max("updated_at"))["latest"]
    if latest_connection:
        candidates.append(latest_connection)

    latest_signature = Signature.objects.filter(map_system__map=map_obj).aggregate(
        latest=Max("updated_at")
    )["latest"]
    if latest_signature:
        candidates.append(latest_signature)

    return max(candidates)


def map_to_schema(map_obj: Map, request) -> dict:
    """Serialize a Map to MapOut shape"""

    return {
        "id": map_obj.id,
        "name": map_obj.name,
        "owner_id": map_obj.owner_id,
        "owner_name": map_obj.owner.username,
        "visibility": map_obj.visibility,
        "created_at": map_obj.created_at,
        "last_updated": map_last_updated(map_obj),
        "is_owner": map_obj.owner_id == request.user.id,
        "can_edit_sharing": can_edit_sharing(request, map_obj),
        "active_users": MapPresence.objects.filter(map=map_obj)
        .values("user_id")
        .distinct()
        .count(),
    }


def space_type_label(solar_system) -> str:
    """A human-readable space type for a solar system (Wormhole/Pochven/
    Abyssal Deadspace/High Sec/Low Sec/Null Sec/Unknown).

    `wormhole_class_id_raw` isn't a reliable "is this J-space" signal on its
    own - CCP's SDE sets it on every system, including k-space (e.g. 7/8/9
    for high/low/null sec, used for wormhole connection-compatibility rules),
    so a real low-sec system like Hophib has a non-null wormhole_class_id_raw
    without being a wormhole. J-space systems are identified by their ID
    range instead (`is_wh_space`), which is what actually distinguishes them.
    """

    if solar_system.is_wh_space:
        return "Wormhole"

    if solar_system.is_abyssal_deadspace:
        return "Abyssal Deadspace"

    if solar_system.constellation_id and solar_system.is_triglavian_space:
        return "Pochven"

    security_status = solar_system.security_status
    if security_status is None:
        return "Unknown"
    if security_status >= HIGH_SEC_SECURITY_THRESHOLD:
        return "High Sec"
    if security_status > 0.0:
        return "Low Sec"
    return "Null Sec"


def wormhole_class_id(solar_system) -> int | None:
    """A J-space system's wormhole class (1-6/12-18) - see
    WORMHOLE_REGION_LETTER_TO_CLASS's comment for why this doesn't just
    trust `wormhole_class_id_raw` (CCP's current SDE export leaves it null
    for nearly every real wormhole system). Falls back, in order: the raw
    SDE field when a future SDE snapshot does carry it; the hardcoded
    Drifter lookup (their shared region name can't be told apart by letter
    alone); the region-name-letter convention for everything else. None for
    k-space/abyssal (space_type_label already identifies those without this
    field) or for a J-space system whose region name is somehow missing.
    """

    if solar_system.wormhole_class_id_raw is not None:
        return solar_system.wormhole_class_id_raw
    if solar_system.id in DRIFTER_SYSTEM_CLASS:
        return DRIFTER_SYSTEM_CLASS[solar_system.id]
    if not solar_system.is_wh_space:
        return None

    constellation = solar_system.constellation
    region = constellation.region if constellation else None
    if not region or not region.name:
        return None
    return WORMHOLE_REGION_LETTER_TO_CLASS.get(region.name[0])


def solar_system_to_schema(solar_system, owner=None) -> dict:
    """Serialize an eve_sde.SolarSystem to SolarSystemOut shape.

    `owner` (who controls this space - see bulk_system_owners) is passed in
    rather than resolved here, so callers that need it for many systems at
    once (system_to_schema, via get_map_state) can batch-resolve it up front
    instead of this running one-off queries per system.
    """

    constellation = solar_system.constellation

    return {
        "id": solar_system.id,
        "name": solar_system.name,
        "security_status": solar_system.security_status,
        "wormhole_class_id": wormhole_class_id(solar_system),
        "visual_effect": solar_system.visual_effect,
        "constellation_name": constellation.name if constellation else None,
        "region_name": constellation.region.name if constellation else None,
        "space_type": space_type_label(solar_system),
        "owner": owner,
    }


def system_to_schema(system, owner=None) -> dict:
    """Serialize a MapSystem to MapSystemOut shape - see
    solar_system_to_schema for what `owner` is.

    `owner` isn't resolved here (see solar_system_to_schema): a caller
    serializing a single system (add_system, update_system,
    wh_mapper.tasks._grow_map_for_character) must pass one explicitly via
    single_system_owner, not leave it defaulted to None - that default
    exists only for batch callers that resolve it themselves up front (see
    get_map_state/bulk_system_owners). Leaving it None on a single-system
    broadcast (system.added/system.updated) would overwrite a previously-
    correct owner with null in every other connected client's local state,
    since the frontend replaces the whole system object on that event.
    """

    return {
        "id": system.id,
        "map_id": system.map_id,
        "solar_system": solar_system_to_schema(system.solar_system, owner=owner),
        "label": system.label,
        "x": system.x,
        "y": system.y,
        "pinned": system.pinned,
        "added_by_id": system.added_by_id,
        "added_at": system.added_at,
    }


def single_system_owner(solar_system):
    """bulk_system_owners for exactly one eve_sde.SolarSystem - for callers
    serializing a single MapSystem (add_system, update_system,
    wh_mapper.tasks._grow_map_for_character) that don't have a whole map's
    worth of systems to batch-resolve up front. Still just 3 queries, same
    as bulk_system_owners with one system in it - not resolved once per
    caller."""

    return bulk_system_owners([solar_system]).get(solar_system.id)


def bulk_system_owners(solar_systems) -> dict:
    """Who controls each of the given eve_sde.SolarSystems - an NPC
    empire/pirate faction (high/low-sec and NPC-null, from the SDE's static
    faction_id_raw), a player alliance holding null-sec sovereignty (from
    the periodically-refreshed SystemSovereignty cache - see
    wh_mapper.tasks.refresh_system_sovereignty), or an NPC faction holding
    live Faction Warfare sovereignty (same cache, a different concept from
    the SDE's static faction ownership that happens to render the same way -
    see SystemSovereignty's docstring).

    Batched deliberately (3 queries total, regardless of how many systems
    are passed in) rather than resolved per-system, since this backs a
    whole map's system list at once (see get_map_state) - a per-system
    version of this would N+1 badly.

    Returns a dict keyed by solar_system.id, each value either None (no
    known owner - wormhole space, abyssal deadspace, or genuinely unclaimed
    null-sec) or a dict shaped like SystemOwnerOut.
    """

    solar_systems = list(solar_systems)
    system_ids = [s.id for s in solar_systems]

    sov_by_system = {
        row.solar_system_id: row
        for row in SystemSovereignty.objects.filter(solar_system_id__in=system_ids)
    }

    alliance_ids = {row.alliance_id for row in sov_by_system.values() if row.alliance_id}
    faction_ids = {row.faction_id for row in sov_by_system.values() if row.faction_id}
    faction_ids |= {s.faction_id_raw for s in solar_systems if s.faction_id_raw}

    alliances = {
        a.alliance_id: a for a in EveAllianceInfo.objects.filter(alliance_id__in=alliance_ids)
    }
    factions = {f.faction_id: f for f in EveFactionInfo.objects.filter(faction_id__in=faction_ids)}
    # A never-before-seen faction is a rare, one-time cost (EVE has ~25
    # factions total, forever cached locally after this) - unlike
    # alliances, which must stay a pure cached read since sovereignty
    # actually changes over time (see refresh_system_sovereignty). This is
    # the one live ESI call in what's otherwise a pure-DB read path (backs
    # get_map_state), so a failure here must degrade to "unknown owner"
    # rather than 500ing the whole map load.
    for faction_id in faction_ids - factions.keys():
        try:
            factions[faction_id] = EveFactionInfo.objects.get_or_create_esi(faction_id)
        except Exception:
            logger.warning("Failed to resolve faction %s from ESI", faction_id, exc_info=True)

    def alliance_owner(alliance) -> dict:
        return {
            "type": "alliance",
            "id": alliance.alliance_id,
            "name": alliance.alliance_name,
            "ticker": alliance.alliance_ticker,
            "icon_url": alliance.logo_url_64,
        }

    def faction_owner(faction) -> dict:
        return {
            "type": "faction",
            "id": faction.faction_id,
            "name": faction.faction_name,
            "ticker": None,
            "icon_url": faction.logo_url_64,
        }

    owners = {}
    for system in solar_systems:
        sov = sov_by_system.get(system.id)
        if sov and sov.alliance_id and sov.alliance_id in alliances:
            owners[system.id] = alliance_owner(alliances[sov.alliance_id])
        elif sov and sov.faction_id and sov.faction_id in factions:
            owners[system.id] = faction_owner(factions[sov.faction_id])
        elif system.faction_id_raw and system.faction_id_raw in factions:
            owners[system.id] = faction_owner(factions[system.faction_id_raw])
        else:
            owners[system.id] = None
    return owners


def wormhole_type_to_schema(wormhole_type) -> dict:
    """Serialize a WormholeType to WormholeTypeOut shape"""

    return {
        "code": wormhole_type.code,
        "leads_to_class": wormhole_type.leads_to_class,
        "max_mass": wormhole_type.max_mass,
        "max_jump_mass": wormhole_type.max_jump_mass,
        "max_stable_time": wormhole_type.max_stable_time,
    }


def signature_to_schema(signature) -> dict:
    """Serialize a Signature to SignatureOut shape"""

    wormhole_type = signature.wormhole_type

    return {
        "id": signature.id,
        "map_system_id": signature.map_system_id,
        "signature_id": signature.signature_id,
        # str()'d - a field left at its Django TextChoices default (never
        # explicitly assigned since creation) holds the enum member itself
        # in memory, not the plain string a DB round-trip would normalize it
        # to, and the Literal-typed schema field only accepts the latter.
        # Choices.__str__ returns the underlying value, so this is a no-op
        # for an already-plain string.
        "sig_type": str(signature.sig_type),
        "wormhole_type": wormhole_type_to_schema(wormhole_type) if wormhole_type else None,
        "life_status": str(signature.life_status),
        "life_status_marked_at": signature.life_status_marked_at,
        "is_hidden": signature.is_hidden,
        "updated_by_id": signature.updated_by_id,
        "updated_at": signature.updated_at,
    }


def apply_life_status(obj, new_life_status: str) -> None:
    """Set life_status on a Signature/WormholeConnection, stamping
    life_status_marked_at to match - see Signature.life_status_marked_at
    for why that needs its own timestamp distinct from updated_at. Only
    meaningful as a manual countdown anchor while the wormhole type is
    still unidentified (see LifeStatus) - once the real type takes over,
    life_status_marked_at is simply ignored.

    Stable is stamped too, not cleared - it counts down from
    UNKNOWN_STABLE_MAX_HOURS just like any other bucket (see
    LIFE_STATUS_BUCKET_HOURS below), so an unidentified wormhole marked
    stable still eventually ages out and gets pruned by
    wh_mapper.tasks.age_wormhole_connections instead of sitting frozen
    forever.
    """

    obj.life_status = new_life_status
    obj.life_status_marked_at = timezone.now()


# Ordered the same as constants.LIFE_STATUS_HOUR_BOUNDS - pairs each bucket
# with the hours-of-life-remaining it represents, both as a threshold (see
# life_status_for_remaining_hours) and, for a manually-picked bucket, as the
# assumed starting point for the countdown (see remaining_life_hours).
LIFE_STATUS_BUCKET_ORDER = [
    Signature.LifeStatus.LESS_THAN_48H,
    Signature.LifeStatus.LESS_THAN_24H,
    Signature.LifeStatus.LESS_THAN_12H,
    Signature.LifeStatus.LESS_THAN_4H,
    Signature.LifeStatus.LESS_THAN_1H,
]
LIFE_STATUS_BUCKET_HOURS = dict(zip(LIFE_STATUS_BUCKET_ORDER, LIFE_STATUS_HOUR_BOUNDS))
# Stable's own assumed starting point - not part of the ladder above (it's
# never a threshold life_status_for_remaining_hours checks against), but
# still needs an entry here so remaining_life_hours can count an
# unidentified "stable" pick down from it like any other manual bucket.
LIFE_STATUS_BUCKET_HOURS[Signature.LifeStatus.STABLE] = UNKNOWN_STABLE_MAX_HOURS


def life_status_for_remaining_hours(remaining_hours: float) -> str:
    """Map hours-of-life-remaining to a LifeStatus bucket - the smallest
    (tightest) bound the value still fits under wins, so this must check
    lt_1h before lt_4h before lt_12h etc. (checking largest-first would
    always match lt_48h for anything under 48h). STABLE if it's above all
    of them."""

    for bucket, bound in reversed(list(zip(LIFE_STATUS_BUCKET_ORDER, LIFE_STATUS_HOUR_BOUNDS))):
        if remaining_hours <= bound:
            return bucket
    return Signature.LifeStatus.STABLE


def remaining_life_hours(
    life_status: str, life_status_marked_at, wormhole_type, reference_time, now=None
):
    """Hours left before a Signature/WormholeConnection's expected collapse,
    or None if there's nothing to judge by (type unidentified and no manual
    bucket has ever been picked - i.e. genuinely just "stable").

    Two sources, in priority order:
    - The wormhole type's real max_stable_time, once identified
    - Failing that, a manually-picked life_status bucket
    """

    if now is None:
        now = timezone.now()

    if wormhole_type is not None and wormhole_type.max_stable_time is not None:
        elapsed_hours = (now - reference_time).total_seconds() / 3600
        return wormhole_type.max_stable_time / 60 - elapsed_hours

    if life_status_marked_at is not None and life_status in LIFE_STATUS_BUCKET_HOURS:
        elapsed_hours = (now - life_status_marked_at).total_seconds() / 3600
        return LIFE_STATUS_BUCKET_HOURS[life_status] - elapsed_hours

    return None


def connection_wormhole_type(connection):
    """The WormholeType backing a WormholeConnection, from whichever end's
    Signature has one set (a connection can be scanned from either side)."""

    if connection.top_signature and connection.top_signature.wormhole_type:
        return connection.top_signature.wormhole_type
    if connection.bottom_signature and connection.bottom_signature.wormhole_type:
        return connection.bottom_signature.wormhole_type
    return None


def signature_linked_connection(signature):
    """The WormholeConnection this Signature is attached to (either end),
    or None if it hasn't been linked to one yet."""

    return signature.connection_as_top.first() or signature.connection_as_bottom.first()


def signature_reference_time(signature):
    """Timestamp to measure a wormhole signature's age from.

    Prefers its linked WormholeConnection's created_at (immutable, set once)
    over the signature's own updated_at (bumped by *any* edit - e.g. fixing
    sig_type long after the wormhole was first scanned) whenever one exists
    - otherwise a signature edited recently could look artificially fresh
    (STABLE) while its connection, unaffected by that edit, correctly shows
    it aging toward EOL. Since both ends of the same physical wormhole
    should agree on its age, this is what keeps a signature and its linked
    connection's computed life_status in sync instead of drifting apart -
    see connection_effective_life_status and
    wh_mapper.tasks.age_wormhole_connections, and the frontend's mirroring
    effectiveLifeStatus.
    """

    connection = signature_linked_connection(signature)
    return connection.created_at if connection else signature.updated_at


def connection_effective_life_status(connection, now=None) -> str:
    """The connection's current life_status bucket, computed live via
    remaining_life_hours rather than trusting the stored field directly -
    keeps it accurate between wh_mapper.tasks.age_wormhole_connections runs,
    and mirrors the frontend's own live-ticking version of this calculation
    (wormholeClass.ts's effectiveLifeStatus)."""

    remaining = remaining_life_hours(
        connection.life_status,
        connection.life_status_marked_at,
        connection_wormhole_type(connection),
        connection.created_at,
        now,
    )
    if remaining is None:
        return connection.life_status
    return life_status_for_remaining_hours(remaining)


def mass_status_for_remaining_fraction(fraction: float) -> str:
    """Map a WormholeConnection's remaining-mass fraction (0-1) to a
    MassStatus bucket - fresh above MASS_STATUS_FRESH_FRACTION, critical at
    or below MASS_STATUS_CRITICAL_FRACTION, reduced in between. Matches the
    convention EVE's own client and community mapping tools already use -
    see the fleet-mass-tracking wayfinder map's ticket 06."""

    if fraction <= MASS_STATUS_CRITICAL_FRACTION:
        return WormholeConnection.MassStatus.CRITICAL
    if fraction <= MASS_STATUS_FRESH_FRACTION:
        return WormholeConnection.MassStatus.REDUCED
    return WormholeConnection.MassStatus.FRESH


def connection_effective_mass_status(connection) -> str:
    """The connection's current mass_status bucket, computed live from
    mass_crossed against its WormholeType's max_mass when known - mirrors
    connection_effective_life_status's fallback shape. Falls back to the
    stored (manual) mass_status when the wormhole type is unidentified, or
    identified but missing max_mass - see ticket 06."""

    wormhole_type = connection_wormhole_type(connection)
    if wormhole_type is None or wormhole_type.max_mass is None or wormhole_type.max_mass <= 0:
        return connection.mass_status

    remaining_fraction = max(0.0, (wormhole_type.max_mass - connection.mass_crossed) / wormhole_type.max_mass)
    return mass_status_for_remaining_fraction(remaining_fraction)


def record_mass_crossing(connection: WormholeConnection, mass_kg: float) -> bool:
    """Add `mass_kg` to a WormholeConnection's cumulative mass_crossed (via
    an F() update, so concurrent crossings on the same connection can't
    clobber each other) and report whether its *effective* mass_status
    bucket changed as a result - callers use this to decide whether to
    broadcast. See ticket 06/08."""

    before = connection_effective_mass_status(connection)
    WormholeConnection.objects.filter(pk=connection.pk).update(
        mass_crossed=F("mass_crossed") + mass_kg
    )
    connection.refresh_from_db(fields=["mass_crossed"])
    return connection_effective_mass_status(connection) != before


def ship_mass_kg(ship_type_id: int) -> float | None:
    """A ship hull's base mass (kg) from the SDE, or None if the type isn't
    known locally. ESI exposes no live fitted/cargo mass, so this base hull
    mass is the accepted approximation fleet mass-tracking deducts by - see
    the fleet-mass-tracking wayfinder map's destination-naming notes."""

    try:
        return ItemType.objects.get(pk=ship_type_id).mass
    except ItemType.DoesNotExist:
        return None


def resolve_fleet_character_name(character_id: int) -> str:
    """A fleet member's character name, resolving+caching a local
    EveCharacter row via ESI if this app has never seen them before (a
    regular fleet member, unlike the FC, has no reason to already have one) -
    mirrors EveAllianceInfo.objects.get_or_create_esi's
    lookup-then-create-on-miss shape used elsewhere in this codebase (see
    wh_mapper.tasks.refresh_system_sovereignty)."""

    character = EveCharacter.objects.get_character_by_id(character_id)
    if character is not None:
        return character.character_name

    try:
        return EveCharacter.objects.create_character(character_id).character_name
    except Exception:
        logger.warning("Could not resolve character name for %s", character_id)
        return str(character_id)


def connection_time_status(connection) -> str:
    """A traffic-light summary of how much *time* (not mass) a wormhole has
    left: green (plenty of time left), orange (time running out), red
    (close to/past its expected collapse), or unknown (no wormhole
    type/max_stable_time to judge by yet, and no manually-picked critical
    bucket either - a neutral "no data" state rather than the risky one).
    Unrelated to mass_status - a connection's mass and its remaining
    lifetime decay independently."""

    if connection_effective_life_status(connection) in (
        Signature.LifeStatus.LESS_THAN_4H,
        Signature.LifeStatus.LESS_THAN_1H,
    ):
        return "red"

    wormhole_type = connection_wormhole_type(connection)
    if wormhole_type is None or wormhole_type.max_stable_time is None:
        return "unknown"

    age_minutes = (timezone.now() - connection.created_at).total_seconds() / 60
    fraction_elapsed = age_minutes / wormhole_type.max_stable_time

    if fraction_elapsed < CONNECTION_TIME_STATUS_GREEN_THRESHOLD:
        return "green"
    if fraction_elapsed < CONNECTION_TIME_STATUS_ORANGE_THRESHOLD:
        return "orange"
    return "red"


def connection_to_schema(connection) -> dict:
    """Serialize a WormholeConnection to WormholeConnectionOut shape"""

    return {
        "id": connection.id,
        "map_id": connection.map_id,
        # str()'d - see signature_to_schema's comment on why: a field left
        # at its Django TextChoices default (e.g. life_status, never
        # settable at creation - only via a later update-connection call)
        # holds the enum member itself in memory, not the plain string a DB
        # round-trip would normalize it to.
        "connection_type": str(connection.connection_type),
        "top_system_id": connection.top_system_id,
        "bottom_system_id": connection.bottom_system_id,
        "top_system_solar_system_id": connection.top_system.solar_system_id,
        "bottom_system_solar_system_id": connection.bottom_system.solar_system_id,
        "top_signature_id": connection.top_signature_id,
        "bottom_signature_id": connection.bottom_signature_id,
        "top_signature": (
            signature_to_schema(connection.top_signature) if connection.top_signature else None
        ),
        "bottom_signature": (
            signature_to_schema(connection.bottom_signature)
            if connection.bottom_signature
            else None
        ),
        "life_status": str(connection.life_status),
        "life_status_marked_at": connection.life_status_marked_at,
        # Computed live from mass_crossed (see connection_effective_mass_status),
        # not the raw stored field - mirrors connection_time_status already
        # being a derived value alongside the raw life_status above. See the
        # fleet-mass-tracking wayfinder map's ticket 06.
        "mass_status": str(connection_effective_mass_status(connection)),
        "ship_size_limit": str(connection.ship_size_limit),
        "time_status": connection_time_status(connection),
        "created_by_id": connection.created_by_id,
        "created_at": connection.created_at,
        "updated_at": connection.updated_at,
    }


def user_display_name(user) -> str | None:
    """The name to credit a user by - their main character if one is set,
    else their plain username. Same fallback
    _contributors_for_connection_ids uses for route-level credit."""

    if user is None:
        return None
    character = getattr(getattr(user, "profile", None), "main_character", None)
    return character.character_name if character else user.username


def map_contribution_to_schema(contribution) -> dict:
    """Serialize a MapContribution to MapContributionOut shape"""

    return {
        "id": contribution.id,
        "verb": str(contribution.verb),
        "character_id": contribution.character_id,
        "name": (
            contribution.character.character_name
            if contribution.character_id
            else (user_display_name(contribution.user) or "Unknown")
        ),
        "created_at": contribution.created_at,
    }


def stargate_connects(solar_system_a, solar_system_b) -> bool:
    """Whether a real in-game stargate links these two eve_sde SolarSystems
    (either direction) - used to auto-detect k-space stargate connections
    rather than requiring the mapper to draw them by hand."""

    return Stargate.objects.filter(
        Q(solar_system=solar_system_a, destination=solar_system_b)
        | Q(solar_system=solar_system_b, destination=solar_system_a)
    ).exists()


def _canonicalize_connection_pair(system_a, system_b, top_signature, bottom_signature):
    """Order a (system_a, system_b) pair by pk, swapping their matching
    top_/bottom_ signature along with them, so (a, b) and (b, a) always
    land on the same top_system/bottom_system assignment instead of being
    treated as two distinct pairs.

    Raises ValueError if `system_a` and `system_b` are the same MapSystem -
    a connection must join two distinct systems.
    """

    if system_a.pk == system_b.pk:
        raise ValueError("A connection cannot link a system to itself")

    if system_b.pk < system_a.pk:
        return system_b, system_a, bottom_signature, top_signature
    return system_a, system_b, top_signature, bottom_signature


def get_or_create_connection(
    map_id: int,
    system_a,
    system_b,
    created_by,
    connection_type="wormhole",
    top_signature=None,
    bottom_signature=None,
    mass_status=WormholeConnection.MassStatus.UNKNOWN,
    ship_size_limit=WormholeConnection.ShipSize.UNKNOWN,
):
    """Find an existing WormholeConnection between two MapSystems on a Map
    (treating (a, b) and (b, a) as the same edge), or create one.

    Used for auto-detected connections (stargates, and the character
    auto-grow task) where a pair of systems should only ever have one
    connection between them. Manual wormhole connects should use
    `create_connection` instead, since duplicate wormholes between the same
    pair are legitimate. The create is guarded against a genuine race (two
    requests passing the initial lookup at the same time, e.g. two
    characters jumping through the same new gate at once) by falling back
    to a fetch on IntegrityError rather than letting the second request
    500.
    """

    system_a, system_b, top_signature, bottom_signature = _canonicalize_connection_pair(
        system_a, system_b, top_signature, bottom_signature
    )

    existing = WormholeConnection.objects.filter(
        map_id=map_id, top_system=system_a, bottom_system=system_b
    ).first()
    if existing:
        return existing, False

    try:
        connection = WormholeConnection.objects.create(
            map_id=map_id,
            top_system=system_a,
            bottom_system=system_b,
            connection_type=connection_type,
            top_signature=top_signature,
            bottom_signature=bottom_signature,
            mass_status=mass_status,
            ship_size_limit=ship_size_limit,
            created_by=created_by,
        )
    except IntegrityError:
        return (
            WormholeConnection.objects.get(
                map_id=map_id, top_system=system_a, bottom_system=system_b
            ),
            False,
        )
    return connection, True


def create_connection(
    map_id: int,
    system_a,
    system_b,
    created_by,
    connection_type="wormhole",
    top_signature=None,
    bottom_signature=None,
    mass_status=WormholeConnection.MassStatus.UNKNOWN,
    ship_size_limit=WormholeConnection.ShipSize.UNKNOWN,
):
    """Create a new WormholeConnection between two MapSystems on a Map,
    without deduplicating against any connection that already exists for
    the same pair - two separate wormholes really can connect the same two
    systems in-game. Only valid for non-stargate connection types; the
    model's unique constraint still enforces at most one stargate
    connection per pair, so stargate writes must go through
    `get_or_create_connection` instead.
    """

    system_a, system_b, top_signature, bottom_signature = _canonicalize_connection_pair(
        system_a, system_b, top_signature, bottom_signature
    )

    return WormholeConnection.objects.create(
        map_id=map_id,
        top_system=system_a,
        bottom_system=system_b,
        connection_type=connection_type,
        top_signature=top_signature,
        bottom_signature=bottom_signature,
        mass_status=mass_status,
        ship_size_limit=ship_size_limit,
        created_by=created_by,
    )


def record_contribution(connection, user, verb: str) -> None:
    """Log a bounty-attribution-worthy action on a wormhole connection (see
    wh_mapper.models.MapContribution) - a no-op for stargate/ansiblex
    connections (static/auto-detected, never "found" by anyone) or an
    unauthenticated actor (e.g. the character auto-grow task, which passes
    no user at all). `character` is snapshotted from the acting user's
    current main character at record time, not looked up live later.
    """

    if connection.connection_type != WormholeConnection.ConnectionType.WORMHOLE:
        return
    if user is None or not user.is_authenticated:
        return

    character = getattr(getattr(user, "profile", None), "main_character", None)
    MapContribution.objects.create(
        map_id=connection.map_id,
        connection=connection,
        verb=verb,
        character=character,
        user=user,
    )


def _contributors_for_connection_ids(connection_ids) -> list[dict]:
    """Aggregate MapContribution rows recorded against the given
    WormholeConnection ids into a per-character contributor list, for a
    route's bounty attribution. Sorted by contribution count descending,
    then name. Falls back to the acting account's username when no main
    character was set at record time - same fallback map_to_schema's
    owner_name uses for a Map's owner."""

    connection_ids = [cid for cid in connection_ids if cid is not None]
    if not connection_ids:
        return []

    contributions = MapContribution.objects.filter(
        connection_id__in=connection_ids
    ).select_related("character", "user")

    counts: dict[tuple, dict] = {}
    for contribution in contributions:
        if contribution.character_id is not None:
            key = ("character", contribution.character_id)
            name = contribution.character.character_name
        elif contribution.user_id is not None:
            key = ("user", contribution.user_id)
            name = contribution.user.username
        else:
            continue

        entry = counts.setdefault(
            key,
            {
                "character_id": contribution.character_id,
                "name": name,
                "contribution_count": 0,
            },
        )
        entry["contribution_count"] += 1

    return sorted(counts.values(), key=lambda entry: (-entry["contribution_count"], entry["name"]))


def auto_link_stargates(map_obj, new_system, user, broadcast: bool = True) -> int:
    """Auto-create a stargate connection between `new_system` and any other
    system already on the map that it's really linked to in-game - so k-space
    systems don't need their (fixed, known) gate connections drawn by hand.
    Returns how many new connections were created.

    `broadcast=False` skips the per-connection websocket broadcast - a bulk
    caller adding many systems at once (e.g. a whole-region import) should
    pass this and send one consolidated resync broadcast afterwards instead,
    since one broadcast per row can exceed the channel layer's per-channel
    capacity and get connected clients' messages dropped.

    Single-system version, for the "+Add system" flow - resolves
    `new_system`'s stargate adjacency to the rest of the map in one query,
    regardless of how many other systems are already there (like
    auto_link_stargates_bulk, just scoped to a single new system).
    """

    other_systems = (
        MapSystem.objects.filter(map=map_obj)
        .exclude(pk=new_system.pk)
        .select_related("solar_system")
    )
    others_by_solar_system_id = {o.solar_system_id: o for o in other_systems}
    if not others_by_solar_system_id:
        return 0

    solar_system_id = new_system.solar_system_id
    other_solar_system_ids = list(others_by_solar_system_id.keys())

    stargate_rows = Stargate.objects.filter(
        Q(solar_system_id=solar_system_id, destination_id__in=other_solar_system_ids)
        | Q(solar_system_id__in=other_solar_system_ids, destination_id=solar_system_id)
    ).values_list("solar_system_id", "destination_id")

    linked_solar_system_ids = {
        (b if a == solar_system_id else a) for a, b in stargate_rows
    }

    created_count = 0
    for other_solar_system_id in linked_solar_system_ids:
        other = others_by_solar_system_id[other_solar_system_id]
        connection, connection_created = get_or_create_connection(
            map_obj.id,
            new_system,
            other,
            user,
            connection_type=WormholeConnection.ConnectionType.STARGATE,
        )
        if connection_created:
            created_count += 1
            if broadcast:
                broadcast_map_event(
                    map_obj.id, "connection.added", connection_to_schema(connection)
                )

    return created_count


def auto_link_stargates_bulk(map_obj, new_systems, user, broadcast: bool = True) -> int:
    """Batch version of auto_link_stargates, for a whole-region import.

    Calling auto_link_stargates once per newly-added system is O(N) Stargate
    queries per call (one per other system already on the map), so importing
    N systems costs O(N^2) queries overall as the map grows mid-import. This
    instead resolves stargate adjacency for the entire batch in a single
    query, regardless of how many systems are involved.
    """

    new_systems = list(new_systems)
    if not new_systems:
        return 0

    all_systems = list(MapSystem.objects.filter(map=map_obj).select_related("solar_system"))
    systems_by_solar_system_id = {s.solar_system_id: s for s in all_systems}
    new_system_pks = {s.pk for s in new_systems}
    solar_system_ids = list(systems_by_solar_system_id.keys())

    stargate_links = Stargate.objects.filter(
        solar_system_id__in=solar_system_ids, destination_id__in=solar_system_ids
    ).values_list("solar_system_id", "destination_id")

    # A pair of MapSystems where at least one end is newly-added on this
    # import - a link between two systems that were already on the map
    # before this import isn't this function's job to create (it either
    # already exists, or was deliberately never auto-linked).
    linked_pairs = set()
    for solar_system_id, destination_id in stargate_links:
        system_a = systems_by_solar_system_id.get(solar_system_id)
        system_b = systems_by_solar_system_id.get(destination_id)
        if system_a is None or system_b is None or system_a.pk == system_b.pk:
            continue
        if system_a.pk not in new_system_pks and system_b.pk not in new_system_pks:
            continue
        pair = (system_a.pk, system_b.pk) if system_a.pk < system_b.pk else (system_b.pk, system_a.pk)
        linked_pairs.add(pair)

    systems_by_pk = {s.pk: s for s in all_systems}
    created_count = 0
    for system_a_pk, system_b_pk in linked_pairs:
        connection, connection_created = get_or_create_connection(
            map_obj.id,
            systems_by_pk[system_a_pk],
            systems_by_pk[system_b_pk],
            user,
            connection_type=WormholeConnection.ConnectionType.STARGATE,
        )
        if connection_created:
            created_count += 1
            if broadcast:
                broadcast_map_event(
                    map_obj.id, "connection.added", connection_to_schema(connection)
                )

    return created_count


def _is_kspace_system_id(system_id: int) -> bool:
    return not (WORMHOLE_SPACE_ID_MIN <= system_id < WORMHOLE_SPACE_ID_MAX)


def list_flat_regions():
    """Every "flat" Region with a real, static 2D layout
    (`SolarSystem.x_2d`/`y_2d`) suitable for bulk-populating a map - regular
    k-space plus Pochven (a fixed, normally-laid-out region, unlike J-space).
    J-space regions are grouped by wormhole class rather than laid out
    geographically, so they're excluded; a region's own
    `wormhole_class_id_raw` isn't a reliable flag for this (CCP leaves it
    null for at least one real k-space region, and sets it for Pochven even
    though Pochven does have a normal geographic layout), so this instead
    samples one of the region's actual solar system ids and checks its id
    range, the same reliable signal `space_type_label` uses per-system.
    """

    regions = Region.objects.annotate(
        sample_system_id=Min("constellation__solarsystem__id")
    )

    return [
        region
        for region in regions
        if region.sample_system_id is not None
        and _is_kspace_system_id(region.sample_system_id)
    ]


def is_region_flat(region) -> bool:
    """Single-region version of the `list_flat_regions` check, for
    validating a region_id passed directly to the import endpoint (not just
    relying on the frontend only offering flat regions in its picker)."""

    sample_system_id = (
        SolarSystem.objects.filter(constellation__region=region)
        .values_list("id", flat=True)
        .first()
    )
    if sample_system_id is None:
        return False

    return _is_kspace_system_id(sample_system_id)


def region_to_schema(region) -> dict:
    """Serialize an eve_sde.Region to RegionOut shape"""

    return {"id": region.id, "name": region.name}


def tracked_character_to_schema(tracked) -> dict:
    """Serialize a TrackedCharacter to TrackedCharacterOut shape"""

    return {
        "character_id": tracked.character.character_id,
        "character_name": tracked.character.character_name,
        "added_by_id": tracked.added_by_id,
        "is_online": tracked.is_active,
        "last_solar_system": (
            solar_system_to_schema(tracked.last_solar_system)
            if tracked.last_solar_system
            else None
        ),
        "last_seen_at": tracked.last_seen_at,
    }


def start_tracking_character(user, character) -> TrackedCharacter:
    """Create or reactivate a TrackedCharacter row for `character`, owned by
    `user`. Shared by the SSO grant view (wh_mapper.views.add_tracked_character)
    and the "toggle on" API endpoint for characters that already have a
    valid ESI token - assumes the caller has already verified ownership and
    token access.
    """

    tracked, _created = TrackedCharacter.objects.update_or_create(
        character=character, added_by=user, defaults={"is_active": True}
    )
    return tracked


def revoke_stale_map_access(map_obj: Map) -> None:
    """Force-close any already-open websocket connection to this map whose
    holder can no longer see it, after narrowing who a map is visible to -
    revoking a share, or flipping visibility back to private.

    MapConsumer.connect only checks access once, at connect time - without
    this, a revoked user's live socket would keep receiving every
    subsequent broadcast until they happened to disconnect on their own.
    Call after wh_mapper.api.sharing.remove_share and any wh_mapper.api.maps
    update that narrows Map.visibility.
    """

    # Imported here (not at module scope) to avoid a wh_mapper.consumers <->
    # wh_mapper.api.helpers import cycle - consumers.py has no need to import
    # this module, but Django's app loading order means importing consumers
    # at module scope here would occasionally run before it's registered.
    # AA WH Mapper App
    from wh_mapper.consumers import MapConsumer

    presences = MapPresence.objects.filter(map=map_obj).select_related("user")
    stale_channels = [
        presence.channel_name
        for presence in presences
        if not MapConsumer.user_can_view_map_sync(presence.user, map_obj.id)
    ]
    if stale_channels:
        revoke_map_access(stale_channels)


def route_visible_to_user(user, route_id: int) -> bool:
    """Link-based visibility (see wh_mapper.models.Route.Visibility) - the
    owner can always view; anyone else needs visibility=shared. No per-user
    ACL, deliberately - the single predicate shared by get_visible_route
    (HTTP) and wh_mapper.consumers.RouteConsumer.user_can_view_route_sync
    (websocket), mirroring map_visible_to_user's role for Map.
    """

    # AA WH Mapper App
    from wh_mapper.models import Route

    return Route.objects.filter(pk=route_id).filter(
        Q(owner=user) | Q(visibility=Route.Visibility.SHARED)
    ).exists()


def get_visible_route(request, route_id: int):
    """Fetch a Route the requesting user is allowed to see, or return an
    (status, message) error tuple - same 404-not-403 shape as
    get_visible_map, for the same reason (don't leak existence to a user
    who simply isn't allowed to see this one)."""

    # AA WH Mapper App
    from wh_mapper.models import Route

    route_obj = get_object_or_404(Route, pk=route_id)

    if not route_visible_to_user(request.user, route_id):
        return None, (404, "Route not found")

    return route_obj, None


def recompute_route(route) -> bool:
    """Recompute a Route's cached path and save if the result changed.
    Returns whether anything changed (so callers can decide whether to
    broadcast). Uses the route's own owner's visible-map graph, same as an
    on-demand lookup - see wh_mapper.models.Route's docstring on why this
    is scoped to the owner rather than per-viewer."""

    # AA WH Mapper App
    from wh_mapper.pathfinding import compute_route

    computation = compute_route(route.owner, route.start_system_id, route.end_system_id)
    payload = route_result_to_schema(computation)
    new_systems = payload["route"]["systems"] if payload["found"] else []
    new_legs = payload["route"]["legs"] if payload["found"] else []
    new_alternate = payload["alternate"]

    changed = (
        route.found != payload["found"]
        or route.systems != new_systems
        or route.legs != new_legs
        or route.alternate != new_alternate
    )

    route.found = payload["found"]
    route.systems = new_systems
    route.legs = new_legs
    route.alternate = new_alternate
    route.last_computed_at = timezone.now()
    route.save(update_fields=["found", "systems", "legs", "alternate", "last_computed_at"])

    return changed


def shared_route_to_schema(route, request) -> dict:
    """Serialize a persisted Route to SharedRouteOut shape. systems/legs
    are already the cached, wholesale-replaced JSON (see recompute_route) -
    no live computation here."""

    connection_ids = [leg.get("connection_id") for leg in route.legs]

    return {
        "id": route.id,
        "owner_id": route.owner_id,
        "start_system": solar_system_to_schema(route.start_system),
        "end_system": solar_system_to_schema(route.end_system),
        "visibility": str(route.visibility),
        "found": route.found,
        "systems": route.systems,
        "legs": route.legs,
        "alternate": route.alternate,
        "contributors": _contributors_for_connection_ids(connection_ids),
        "last_computed_at": route.last_computed_at,
        "is_owner": route.owner_id == request.user.id,
    }


def _route_result_to_detail_schema(result) -> dict | None:
    """Serialize a wh_mapper.pathfinding.RouteResult to RouteDetail shape,
    or None if not found.

    Batches owner resolution for every system in the route in one pass
    (bulk_system_owners), same reasoning as get_map_state - a per-system
    version would N+1 across the whole route. Each wormhole/ansiblex leg's
    `connection` is the same WormholeConnectionOut shape the Map view
    itself uses (batched the same way, one query for every leg's
    connection rather than one per leg) - reusing connection_to_schema
    directly means a route shows exactly the same wormhole detail (ship
    size, time_status, signature ids) the map does, with no separate
    route-specific serialization to keep in sync.
    """

    if not result.found:
        return None

    systems_by_id = {
        s.id: s
        for s in SolarSystem.objects.filter(
            id__in=result.system_ids
        ).select_related("constellation__region")
    }
    ordered_systems = [systems_by_id[system_id] for system_id in result.system_ids]
    owners = bulk_system_owners(ordered_systems)

    connection_ids = [leg.connection_id for leg in result.legs if leg.connection_id is not None]
    connections_by_id = {
        c.id: c
        for c in WormholeConnection.objects.filter(id__in=connection_ids).select_related(
            "top_signature__wormhole_type",
            "bottom_signature__wormhole_type",
            "top_system",
            "bottom_system",
        )
    }

    return {
        "systems": [
            solar_system_to_schema(s, owner=owners.get(s.id)) for s in ordered_systems
        ],
        "legs": [
            {
                "connection_type": leg.connection_type,
                "life_status": leg.life_status,
                "mass_status": leg.mass_status,
                "map_id": leg.map_id,
                "connection_id": leg.connection_id,
                "connection": (
                    connection_to_schema(connections_by_id[leg.connection_id])
                    if leg.connection_id is not None
                    and leg.connection_id in connections_by_id
                    else None
                ),
            }
            for leg in result.legs
        ],
        "contributors": _contributors_for_connection_ids(connection_ids),
    }


def route_result_to_schema(computation) -> dict:
    """Serialize a wh_mapper.pathfinding.RouteComputation to RouteOut shape.
    `alternate` is a strictly-shorter (fewer hops), risk-ignoring route the
    risk-weighted `route` passed over - surfaced so the user can judge the
    tradeoff themselves rather than the tool silently picking for them."""

    primary_detail = _route_result_to_detail_schema(computation.primary)
    if primary_detail is None:
        return {
            "found": False,
            "message": "No route found between these systems",
            "route": None,
            "alternate": None,
        }

    alternate_detail = (
        _route_result_to_detail_schema(computation.alternate) if computation.alternate else None
    )

    return {
        "found": True,
        "message": None,
        "route": primary_detail,
        "alternate": alternate_detail,
    }


def connection_flag_to_schema(flag) -> dict:
    """Serialize a ConnectionFlag to ConnectionFlagOut shape"""

    return {
        "id": flag.id,
        "connection_id": flag.connection_id,
        "flagged_by_id": flag.flagged_by_id,
        "flagged_by_name": str(flag.flagged_by),
        "suggested_life_status": flag.suggested_life_status,
        "suggested_mass_status": flag.suggested_mass_status,
        "suggests_collapsed": flag.suggests_collapsed,
        "created_at": flag.created_at,
    }


def trackable_character_to_schema(character, tracked=None) -> dict:
    """Serialize one of the requesting user's own characters to
    TrackableCharacterOut shape - `tracked` is its TrackedCharacter row if
    currently tracked, else None."""

    if tracked is not None:
        base = tracked_character_to_schema(tracked)
        base["is_tracked"] = True
        return base

    return {
        "character_id": character.character_id,
        "character_name": character.character_name,
        "is_tracked": False,
        "is_online": False,
        "last_solar_system": None,
        "last_seen_at": None,
    }


def apply_fleet_crossing_mass(
    user, old_system_id: int, new_system_id: int, mass_kg: float
) -> list[tuple[int, WormholeConnection]]:
    """Deduct `mass_kg` from every wormhole-type WormholeConnection matching
    the (old_system_id, new_system_id) pair across every Map visible to
    `user` - per the fleet-mass-tracking wayfinder map's ticket 08, this
    applies to *every* match found (even ambiguous duplicates - the same
    real hole charted on more than one visible map, or legitimate duplicate
    manual wormholes on one map), since this is a guide, not an
    authoritative ledger. If no connection matches the pair on any visible
    map, nothing happens - unlike the owned-character auto-grow flow, a
    fleet-mate's movement never auto-creates a system/connection on someone
    else's map.

    Returns (map_id, connection) for each connection whose effective
    mass_status changed, so the caller can decide what to broadcast.
    """

    visible_map_ids = Map.objects.visible_to(user).values_list("id", flat=True)

    map_systems_by_map: dict[int, dict[int, int]] = {}
    for row in MapSystem.objects.filter(
        map_id__in=visible_map_ids, solar_system_id__in=[old_system_id, new_system_id]
    ).values("map_id", "id", "solar_system_id"):
        map_systems_by_map.setdefault(row["map_id"], {})[row["solar_system_id"]] = row["id"]

    changed: list[tuple[int, WormholeConnection]] = []
    for map_id, system_lookup in map_systems_by_map.items():
        old_map_system_id = system_lookup.get(old_system_id)
        new_map_system_id = system_lookup.get(new_system_id)
        if old_map_system_id is None or new_map_system_id is None:
            continue

        connections = WormholeConnection.objects.filter(
            map_id=map_id, connection_type=WormholeConnection.ConnectionType.WORMHOLE
        ).filter(
            Q(top_system_id=old_map_system_id, bottom_system_id=new_map_system_id)
            | Q(top_system_id=new_map_system_id, bottom_system_id=old_map_system_id)
        ).select_related("top_signature__wormhole_type", "bottom_signature__wormhole_type")

        for connection in connections:
            if record_mass_crossing(connection, mass_kg):
                changed.append((map_id, connection))

    return changed


def available_fleet_character_to_schema(
    character: EveCharacter, owner_name: str, has_active_session: bool
) -> dict:
    """Serialize one character in the backseat-FC token pool to
    AvailableFleetCharacterOut shape - see the fleet-mass-tracking wayfinder
    map's ticket 12."""

    return {
        "character_id": character.character_id,
        "character_name": character.character_name,
        "owner_name": owner_name,
        "has_active_session": has_active_session,
    }


def fleet_member_to_schema(member, hop_distance: int | None) -> dict:
    """Serialize a FleetMemberState to FleetMemberOut shape. `hop_distance`
    is None for ticket 09's "unknown" (unreachable within the viewer's
    visible graph) state - `solar_system` itself is always resolved (ESI
    always reports a real solar_system_id for every member), which is why
    fleet_session_to_schema only includes members whose location has
    actually resolved locally."""

    ship_type_name = "Unknown"
    if member.ship_type_id is not None:
        ship_type_name = (
            ItemType.objects.filter(pk=member.ship_type_id)
            .values_list("name", flat=True)
            .first()
            or "Unknown"
        )

    return {
        "character_id": member.character_id,
        "character_name": member.character_name,
        "ship_type_name": ship_type_name,
        "solar_system": solar_system_to_schema(member.last_solar_system),
        "hop_distance": hop_distance,
    }


def fleet_session_to_schema(session, hop_distances: dict[int, int], viewer) -> dict:
    """Serialize a FleetTrackingSession (plus its live-computed per-member
    hop distances - see wh_mapper.pathfinding.bfs_hop_distances) to
    FleetSessionOut shape."""

    members = session.members.filter(last_solar_system__isnull=False).select_related(
        "last_solar_system"
    )

    return {
        "id": session.id,
        "fc_character_id": session.fc_character.character_id,
        "fc_character_name": session.fc_character.character_name,
        "fleet_id": session.fleet_id,
        "started_by_id": session.started_by_id,
        "started_at": session.started_at,
        "is_watcher": session.watchers.filter(user=viewer).exists(),
        "is_starter": session.started_by_id == viewer.id,
        "members": [
            fleet_member_to_schema(member, hop_distances.get(member.last_solar_system_id))
            for member in members
        ],
    }


def sde_status() -> dict:
    """Local eve_sde import health - see wh_mapper_seed_reference_map.py's
    docstring and wormhole_class_id above for the saga behind why this is
    worth surfacing on a dashboard rather than only discovered by manually
    running queries in a shell, as this project's own maintainer had to do
    once already. `total_jspace_systems`/`jspace_with_raw_wormhole_class`
    are the concrete version of that "is the class data actually there"
    question - expect the latter to stay tiny (CCP's own export barely
    covers it) even on a fully up to date import; that's normal, not a
    problem this page should flag.
    """

    eve_sde = EveSDE.get_solo()
    jspace_systems = SolarSystem.objects.filter(
        id__gte=WORMHOLE_SPACE_ID_MIN, id__lt=WORMHOLE_SPACE_ID_MAX
    )

    return {
        "build_number": eve_sde.build_number,
        "release_date": eve_sde.release_date,
        "last_check_date": eve_sde.last_check_date,
        "total_solar_systems": SolarSystem.objects.count(),
        "total_jspace_systems": jspace_systems.count(),
        "jspace_with_raw_wormhole_class": jspace_systems.filter(
            wormhole_class_id_raw__isnull=False
        ).count(),
    }


def task_heartbeat_status() -> list[dict]:
    """One row per periodic task this app schedules (TASK_EXPECTED_INTERVAL_
    SECONDS), merged with whatever TaskHeartbeat data actually exists -
    every task appears here even if it has never once run, rather than
    silently vanishing from the list (a task that's never run is exactly
    the kind of thing this page exists to surface). `stale` is a generous
    3x-the-expected-interval grace window, so a single slow tick doesn't
    read as broken.
    """

    heartbeats = {h.task_name: h for h in TaskHeartbeat.objects.all()}
    now = timezone.now()

    rows = []
    for task_name, expected_interval in TASK_EXPECTED_INTERVAL_SECONDS.items():
        heartbeat = heartbeats.get(task_name)
        stale = (
            heartbeat is None
            or (now - heartbeat.last_run_at).total_seconds() > expected_interval * 3
        )
        rows.append(
            {
                "task_name": task_name,
                "expected_interval_seconds": expected_interval,
                "last_run_at": heartbeat.last_run_at if heartbeat else None,
                "last_success": heartbeat.last_success if heartbeat else None,
                "last_error": heartbeat.last_error if heartbeat else "",
                "stale": stale,
            }
        )
    return rows


def usage_stats() -> dict:
    """Coarse app-wide activity counts - map counts by visibility, active
    tracked characters, and current live map presences (open websocket
    connections - see MapPresence's docstring for why its row count is a
    good proxy for "viewers right now")."""

    return {
        "total_maps": Map.objects.count(),
        "private_maps": Map.objects.filter(visibility=Map.Visibility.PRIVATE).count(),
        "shared_maps": Map.objects.filter(visibility=Map.Visibility.SHARED).count(),
        "active_tracked_characters": TrackedCharacter.objects.filter(is_active=True).count(),
        "live_map_presences": MapPresence.objects.count(),
    }


def wormhole_type_coverage() -> dict:
    """How many WormholeType rows actually have their derived fields
    populated - low numbers here mean wh_mapper_derive_wormhole_types needs
    a rerun (e.g. after a fresh SDE import), not that something's broken."""

    return {
        "total": WormholeType.objects.count(),
        "with_leads_to_class": WormholeType.objects.filter(
            leads_to_class__isnull=False
        ).count(),
        "with_max_mass": WormholeType.objects.filter(max_mass__isnull=False).count(),
        "with_max_jump_mass": WormholeType.objects.filter(
            max_jump_mass__isnull=False
        ).count(),
        "with_max_stable_time": WormholeType.objects.filter(
            max_stable_time__isnull=False
        ).count(),
    }


def admin_map_list() -> list[dict]:
    """Every current Map, for the admin status page - an admin-wide flat
    listing, unlike map_to_schema (scoped to one viewer's is_owner/
    can_edit_sharing, neither of which applies here). system_count/
    active_users are batched (one query each across every map) rather than
    queried per-map, same reasoning as bulk_system_owners - this list is
    meant to stay cheap even with a few hundred maps in it.
    """

    maps = list(Map.objects.select_related("owner").order_by("-created_at"))

    system_counts = dict(
        MapSystem.objects.values("map_id")
        .annotate(count=Count("id"))
        .values_list("map_id", "count")
    )
    presence_counts = dict(
        MapPresence.objects.values("map_id")
        .annotate(count=Count("user_id", distinct=True))
        .values_list("map_id", "count")
    )

    return [
        {
            "id": m.id,
            "name": m.name,
            "owner_name": m.owner.username,
            "visibility": m.visibility,
            "created_at": m.created_at,
            "last_updated": map_last_updated(m),
            "system_count": system_counts.get(m.id, 0),
            "active_users": presence_counts.get(m.id, 0),
        }
        for m in maps
    ]


def admin_route_list() -> list[dict]:
    """Every current (not yet pruned by wh_mapper.tasks.prune_stale_routes)
    shared Route, for the admin status page."""

    routes = Route.objects.select_related(
        "owner", "start_system", "end_system"
    ).order_by("-last_viewed_at")

    return [
        {
            "id": r.id,
            "owner_name": r.owner.username,
            "start_system_name": r.start_system.name,
            "end_system_name": r.end_system.name,
            "visibility": r.visibility,
            "found": r.found,
            "last_viewed_at": r.last_viewed_at,
            "created_at": r.created_at,
        }
        for r in routes
    ]


def app_status_to_schema() -> dict:
    """Serialize the whole admin status page's worth of data to
    AppStatusOut shape."""

    return {
        "sde": sde_status(),
        "tasks": task_heartbeat_status(),
        "usage": usage_stats(),
        "wormhole_types": wormhole_type_coverage(),
        "maps": admin_map_list(),
        "routes": admin_route_list(),
    }
