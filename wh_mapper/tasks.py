"""App Tasks"""

# Standard Library
import functools
import logging
import math
import traceback
from datetime import timedelta

# Third Party
import httpx
from asgiref.sync import async_to_sync
from celery import shared_task
from channels.layers import get_channel_layer

# Django EvE SDE
from eve_sde.models import SolarSystem

# Django
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

# Alliance Auth
from allianceauth.eveonline.models import EveAllianceInfo, EveFactionInfo
from allianceauth.services.tasks import QueueOnce
from esi.errors import TokenError
from esi.exceptions import (
    ESIErrorLimitException,
    HTTPClientError,
    HTTPNotModified,
    HTTPServerError,
)
from esi.models import Token

# AA WH Mapper App
from wh_mapper.api.helpers import (
    apply_fleet_crossing_mass,
    connection_to_schema,
    connection_wormhole_type,
    fleet_session_to_schema,
    get_or_create_connection,
    life_status_for_remaining_hours,
    recompute_route,
    remaining_life_hours,
    resolve_fleet_character_name,
    ship_mass_kg,
    signature_reference_time,
    single_system_owner,
    stargate_connects,
    system_to_schema,
    tracked_character_to_schema,
)
from wh_mapper.broadcast import (
    broadcast_fleet_event,
    broadcast_map_event,
    broadcast_route_event,
    send_map_event_to_user,
)
from wh_mapper.constants import (
    CHARACTER_LOCATION_POLL_RESCHEDULE_SECONDS,
    EVE_SCOUT_API_URL,
    EVE_SCOUT_HUB_RADIUS,
    EVE_SCOUT_THERA_MAP_NAME,
    EVE_SCOUT_TURNUR_MAP_NAME,
    FLEET_POLL_RESCHEDULE_SECONDS,
    FLEET_SCOPES,
    FLEET_SESSION_FAILURE_THRESHOLD,
    LOCATION_SCOPES,
    MAP_PRESENCE_STALE_AFTER_SECONDS,
    NEW_SYSTEM_OFFSET_X,
    ROUTE_STALE_AFTER_SECONDS,
    THERA_SYSTEM_ID,
    TURNUR_SYSTEM_ID,
)
from wh_mapper.consumers import _group_name
from wh_mapper.models import (
    FleetMemberState,
    FleetTrackingSession,
    Map,
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
from wh_mapper.pathfinding import bfs_hop_distances, build_graph
from wh_mapper.providers import esi

logger = logging.getLogger(__name__)


def record_task_heartbeat(task_name: str, success: bool = True, error: str = "") -> None:
    """Upsert a TaskHeartbeat row - see that model's docstring for why this
    exists instead of reading django-celery-beat's PeriodicTask."""

    TaskHeartbeat.objects.update_or_create(
        task_name=task_name,
        defaults={
            "last_run_at": timezone.now(),
            "last_success": success,
            "last_error": "" if success else error[:2000],
        },
    )


def track_heartbeat(task_name: str):
    """Decorator recording a TaskHeartbeat on every call of a periodic task
    - success or failure, the exception still propagates afterward so
    Celery's own retry/error handling (and QueueOnce, for the tasks that use
    it) behaves exactly as it would without this. Apply directly to the
    plain function, below @shared_task, so it wraps the real call rather
    than Celery's task-registration machinery."""

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            try:
                result = func(*args, **kwargs)
            except Exception as exc:
                record_task_heartbeat(task_name, success=False, error=traceback.format_exc())
                raise exc
            record_task_heartbeat(task_name, success=True)
            return result

        return wrapper

    return decorator


@shared_task
@track_heartbeat("age_wormhole_connections")
def age_wormhole_connections():
    """Delete any signature/connection whose expected remaining lifetime has
    run out - either because its wormhole type's real max_stable_time has
    fully elapsed, or (while the type is still unidentified) because the
    assumed hours behind its last manually-picked life_status bucket have
    elapsed since life_status_marked_at. This is what lets the map
    self-prune a long-collapsed wormhole without anyone having to notice and
    delete it by hand.

    life_status itself is *not* mutated/broadcast here on its way down
    through the bucket ladder (stable -> lt_48h -> ... -> lt_1h) - both the
    API layer (wh_mapper.api.helpers.connection_effective_life_status) and
    the frontend compute that live from the same inputs
    (wh_mapper.api.helpers.remaining_life_hours / wormholeClass.ts's
    effectiveLifeStatus), so there's nothing to keep in sync between task
    runs except the eventual delete.

    A signature linked to a connection shares that connection's created_at
    as its age reference (see wh_mapper.api.helpers.signature_reference_time)
    rather than its own updated_at, so the two always agree on how much life
    is left instead of one looking fresher just because it was edited more
    recently.

    Schedule this periodically (e.g. every few minutes) via
    CELERYBEAT_SCHEDULE in your AA install's local settings.
    """

    now = timezone.now()

    # Both candidate sets are fetched in full (list(), forcing evaluation)
    # before either loop deletes anything. A connection's select_related
    # top_signature/bottom_signature are then Python objects already held in
    # memory, not re-queried - so deleting an expired signature first
    # doesn't SET_NULL its connection's FK out from under the *connections*
    # query below before that query even runs (it would otherwise silently
    # drop that connection from consideration, since the query itself
    # filters on wormhole_type through those FKs).
    candidate_signatures = list(
        Signature.objects.filter(sig_type=Signature.SignatureType.WORMHOLE)
        .filter(
            Q(wormhole_type__max_stable_time__isnull=False)
            | Q(life_status_marked_at__isnull=False)
        )
        .select_related("wormhole_type", "map_system")
        # signature_reference_time (via signature_linked_connection) looks
        # up connection_as_top/connection_as_bottom per signature below -
        # prefetch both so that's a fixed number of queries total instead of
        # up to 2 extra queries per candidate signature.
        .prefetch_related("connection_as_top", "connection_as_bottom")
    )
    candidate_connections = list(
        WormholeConnection.objects.filter(
            Q(top_signature__wormhole_type__max_stable_time__isnull=False)
            | Q(bottom_signature__wormhole_type__max_stable_time__isnull=False)
            | Q(life_status_marked_at__isnull=False)
        ).select_related("top_signature__wormhole_type", "bottom_signature__wormhole_type")
    )

    for signature in candidate_signatures:
        remaining = remaining_life_hours(
            signature.life_status,
            signature.life_status_marked_at,
            signature.wormhole_type,
            signature_reference_time(signature),
            now,
        )
        if remaining is None or remaining > 0:
            continue

        map_id = signature.map_system.map_id
        signature_id = signature.id
        signature.delete()
        logger.info("Signature %s pruned - lifetime expired", signature_id)
        broadcast_map_event(map_id, "signature.removed", {"id": signature_id})

    for connection in candidate_connections:
        remaining = remaining_life_hours(
            connection.life_status,
            connection.life_status_marked_at,
            connection_wormhole_type(connection),
            connection.created_at,
            now,
        )
        if remaining is None or remaining > 0:
            continue

        map_id = connection.map_id
        connection_id = connection.id
        connection.delete()
        logger.info("Connection %s pruned - lifetime expired", connection_id)
        broadcast_map_event(map_id, "connection.removed", {"id": connection_id})


@shared_task(bind=True, base=QueueOnce, once={"graceful": True})
@track_heartbeat("refresh_system_sovereignty")
def refresh_system_sovereignty(self):
    """Replace the SystemSovereignty snapshot wholesale from ESI's public
    sovereignty map, then pre-warm EveAllianceInfo/EveFactionInfo for every
    alliance/faction id seen so wh_mapper.api.helpers.bulk_system_owners'
    per-request serialization is a pure local DB read, with no live-ESI call
    (and its latency/failure risk) in the request path.

    QueueOnce guards against two overlapping runs (a slow ESI call plus the
    next CELERYBEAT_SCHEDULE tick) interleaving their delete+recreate against
    each other - the delete+bulk_create itself is wrapped in a transaction
    so a concurrent *reader* never sees a briefly-empty table either.

    Schedule this periodically (e.g. hourly) via CELERYBEAT_SCHEDULE in your
    AA install's local settings.
    """

    try:
        result = esi.client.Sovereignty.GetSovereigntySystems().result(use_etag=False)
    except (ESIErrorLimitException, HTTPClientError, HTTPServerError) as error:
        self.retry(exc=error, countdown=60)

    rows = []
    alliance_ids = set()
    faction_ids = set()
    for entry in result.solar_systems:
        # `claim` is an untagged oneOf (alliance-claim / faction-claim /
        # unclaimed) - aiopenapi3/pydantic represents that as a RootModel
        # wrapper, so the actual variant lives at `.root`, not on `claim`
        # itself. From there, exactly one of `.alliance`/`.faction` exists
        # on the real object, so getattr's default correctly reads as "not
        # this variant" rather than raising, for the other one.
        claim = getattr(entry.claim, "root", entry.claim)
        alliance = getattr(claim, "alliance", None)
        faction = getattr(claim, "faction", None)
        if alliance is not None:
            rows.append(
                SystemSovereignty(
                    solar_system_id=entry.solar_system_id, alliance_id=alliance.alliance_id
                )
            )
            alliance_ids.add(alliance.alliance_id)
        elif faction is not None:
            rows.append(
                SystemSovereignty(
                    solar_system_id=entry.solar_system_id, faction_id=faction.faction_id
                )
            )
            faction_ids.add(faction.faction_id)
        # else unclaimed - no row (see SystemSovereignty's docstring)

    for alliance_id in alliance_ids:
        EveAllianceInfo.objects.get_or_create_esi(alliance_id)
    for faction_id in faction_ids:
        EveFactionInfo.objects.get_or_create_esi(faction_id)

    with transaction.atomic():
        SystemSovereignty.objects.all().delete()
        SystemSovereignty.objects.bulk_create(rows)

    logger.info(
        "Sovereignty refreshed: %s systems (%s alliances, %s factions)",
        len(rows),
        len(alliance_ids),
        len(faction_ids),
    )


@shared_task
@track_heartbeat("prune_stale_map_presence")
def prune_stale_map_presence():
    """Delete any MapPresence row whose last heartbeat (see
    MapConsumer.receive_json) is older than MAP_PRESENCE_STALE_AFTER_SECONDS.

    A row is normally deleted the moment its websocket's disconnect() fires
    (see MapConsumer.disconnect) - this only catches the case where that
    never happens, e.g. the ASGI worker crashed/restarted mid-connection, or
    the client's TCP connection dropped without the server noticing. Without
    this, such a row would sit there forever, permanently (and wrongly)
    counting its user as "watching" that map - see
    poll_tracked_character_locations and MapPresenceAdmin's online-users
    view, both of which rely on MapPresence reflecting who's actually
    connected right now.

    Schedule this periodically (e.g. every couple of minutes) via
    CELERYBEAT_SCHEDULE in your AA install's local settings, or run it on
    demand via `manage.py wh_mapper_prune_stale_map_presence`.

    Returns the number of rows pruned.
    """

    cutoff = timezone.now() - timedelta(seconds=MAP_PRESENCE_STALE_AFTER_SECONDS)
    stale = list(MapPresence.objects.filter(last_seen_at__lt=cutoff))
    if not stale:
        return 0

    channel_layer = get_channel_layer()
    for presence in stale:
        if channel_layer is not None:
            # Best-effort - if the channel is truly dead this is a no-op; if
            # it's somehow still registered (e.g. the crashed worker's group
            # membership hasn't hit its own expiry yet), this stops it from
            # lingering in the group indefinitely.
            async_to_sync(channel_layer.group_discard)(
                _group_name(presence.map_id), presence.channel_name
            )
        presence.delete()

    logger.info("Pruned %s stale MapPresence row(s)", len(stale))
    return len(stale)


@shared_task
def recompute_routes_for_map(map_id: int) -> int:
    """Recompute every active shared Route whose owner can currently see
    `map_id`, and broadcast the ones whose result changed.

    Called from every mutation site that changes a WormholeConnection on a
    map (see wh_mapper.api.connections), following this codebase's existing
    convention of explicit calls at mutation sites rather than Django
    signals (the same convention broadcast_map_event itself follows).
    Recomputes every one of that owner's active routes that *could* be
    affected, rather than precisely tracking which routes actually
    traversed this map - simpler, always correct, and per the wayfinder
    map's ticket 01 findings, computation is cheap enough that the
    occasional unnecessary recompute doesn't matter.

    Returns the number of routes that were actually broadcast (changed).
    """

    if not Map.objects.filter(pk=map_id).exists():
        return 0

    changed_count = 0
    for route in Route.objects.filter(visibility=Route.Visibility.SHARED).select_related("owner"):
        if not Map.objects.visible_to(route.owner).filter(pk=map_id).exists():
            continue

        changed = recompute_route(route)
        if changed:
            broadcast_route_event(route.id, "route.updated", {"found": route.found})
            changed_count += 1

    return changed_count


@shared_task
@track_heartbeat("prune_stale_routes")
def prune_stale_routes() -> int:
    """Delete any shared Route whose last_viewed_at is older than
    ROUTE_STALE_AFTER_SECONDS - mirrors prune_stale_map_presence's use of
    MapPresence.last_seen_at. A Route is meant to be a casual, disposable
    artifact (see wh_mapper.models.Route), not permanent storage.

    Schedule this periodically (e.g. hourly) via CELERYBEAT_SCHEDULE in
    your AA install's local settings.

    Returns the number of routes pruned.
    """

    cutoff = timezone.now() - timedelta(seconds=ROUTE_STALE_AFTER_SECONDS)
    stale_count, _ = Route.objects.filter(last_viewed_at__lt=cutoff).delete()
    if stale_count:
        logger.info("Pruned %s stale Route row(s)", stale_count)
    return stale_count


@shared_task(
    bind=True,
    base=QueueOnce,
    # unlock_before_run: this task requeues *itself* at the end of a run
    # (below) - with the default "hold the lock until the run finishes",
    # that self-requeue would immediately hit its own lock and no-op via
    # AlreadyQueued/graceful rejection. Releasing the lock at start instead
    # means QueueOnce only guards against a second copy being queued while
    # one is already waiting to start (e.g. an overlapping CELERYBEAT_SCHEDULE
    # tick), not against the deliberate self-reschedule chain.
    once={"graceful": True, "unlock_before_run": True},
)
@track_heartbeat("poll_tracked_character_locations")
def poll_tracked_character_locations(self):
    """Fan out one location lookup per distinct tracked character whose
    owner currently has any map open (has an active MapPresence row) -
    tracking a character does nothing while its owner isn't watching
    anything.

    Self-reschedules every `CHARACTER_LOCATION_POLL_RESCHEDULE_SECONDS` while
    there's anyone to poll, so live viewers get near-real-time updates
    without needing a tight CELERYBEAT_SCHEDULE interval. Once nobody's
    watching, it stops rescheduling itself - schedule an initial call
    periodically (e.g. every minute) via CELERYBEAT_SCHEDULE in your AA
    install's local settings, as a fallback to pick tracking back up
    whenever presence returns.
    """

    online_user_ids = set(MapPresence.objects.values_list("user_id", flat=True))
    if not online_user_ids:
        return

    # Not filtered by is_active (that now tracks *character* online status,
    # not row deletion) - a character marked offline still needs to be
    # dispatched so poll_character_location can notice when they log back in.
    # Filtered by added_by_id at the DB (rather than fetching every
    # TrackedCharacter row and filtering in Python) - this reschedules
    # itself every CHARACTER_LOCATION_POLL_RESCHEDULE_SECONDS while anyone's
    # online, so an unfiltered fetch would re-pull the whole table on every
    # tick.
    trackable = TrackedCharacter.objects.filter(added_by_id__in=online_user_ids).values_list(
        "id", "character__character_id", "added_by_id"
    )

    by_character_id: dict[int, list[int]] = {}
    for tracked_id, character_id, _added_by_id in trackable:
        by_character_id.setdefault(character_id, []).append(tracked_id)

    if not by_character_id:
        return

    for character_id, tracked_ids in by_character_id.items():
        poll_character_location.apply_async(args=[character_id, tracked_ids])

    self.apply_async(countdown=CHARACTER_LOCATION_POLL_RESCHEDULE_SECONDS)


@shared_task(
    base=QueueOnce,
    # Keyed on character_id alone (not tracked_character_ids, which can
    # legitimately differ between calls for the same character) - only one
    # in-flight ESI location lookup per character at a time.
    once={"graceful": True, "keys": ["character_id"]},
)
def poll_character_location(character_id: int, tracked_character_ids: list[int]):
    """Look up one character's current system via ESI and apply it to every
    TrackedCharacter row sharing that character (it may be tracked by more
    than one user at once).
    """

    token = Token.get_token(character_id, LOCATION_SCOPES)
    if not token:
        logger.info("No valid ESI location token for character %s, skipping", character_id)
        return

    tracked_rows = list(
        TrackedCharacter.objects.filter(id__in=tracked_character_ids).select_related(
            "last_solar_system", "character", "added_by"
        )
    )
    if not tracked_rows:
        return

    # Every row here shares the same character_id, so they're all reporting
    # on the same underlying EVE character and should agree on is_active -
    # use any one of them as "the" last confirmed online state.
    last_known_online = tracked_rows[0].is_active

    online = _character_is_online(character_id, token, last_known_online)
    if online is not None and online != last_known_online:
        TrackedCharacter.objects.filter(id__in=tracked_character_ids).update(is_active=online)
        for tracked in tracked_rows:
            tracked.is_active = online
            # Map viewers only ever learn about a character from websocket
            # broadcasts (see MapView.tsx) - without this, going offline
            # would never be reflected live, only after a full page reload.
            _broadcast_online_state_change(tracked, online)

    if online is False:
        # Confirmed offline - don't waste a location lookup, and leave
        # last_seen_at alone so the frontend's staleness check keeps working.
        logger.debug("Character %s is offline, skipping location lookup", character_id)
        return

    try:
        location = esi.client.Location.GetCharactersCharacterIdLocation(
            character_id=character_id, token=token
        ).result()
    except HTTPNotModified:
        # Location unchanged since our last successful fetch (either ESI
        # itself returned 304, or we're still within our own ETag cache) -
        # not an error, just nothing to update beyond last_seen_at.
        logger.debug("Location for character %s unchanged (304)", character_id)
        now = timezone.now()
        for tracked in tracked_rows:
            if tracked.last_solar_system_id is not None:
                tracked.last_seen_at = now
                tracked.save(update_fields=["last_seen_at"])
        return
    except TokenError as error:
        logger.info("ESI token error for character %s: %s", character_id, error)
        # A token error here (as opposed to _character_is_online's own
        # TokenError handling above, which just skips the location lookup
        # for one poll) usually means the grant was revoked - without
        # marking these rows offline, a revoked character would keep
        # showing its last-known online/location state on every map
        # forever, with zero signal that tracking silently died. Still
        # dispatched again by poll_tracked_character_locations regardless
        # (by design, to notice a fresh grant/re-login), so this just stops
        # it from misleadingly looking alive in the meantime.
        newly_offline = [tracked for tracked in tracked_rows if tracked.is_active]
        if newly_offline:
            TrackedCharacter.objects.filter(id__in=tracked_character_ids).update(
                is_active=False
            )
            for tracked in newly_offline:
                tracked.is_active = False
                _broadcast_online_state_change(tracked, False)
        return
    except ESIErrorLimitException as error:
        logger.warning("ESI error limited while polling character %s: %s", character_id, error)
        return
    except (HTTPClientError, HTTPServerError) as error:
        logger.warning(
            "ESI location lookup failed for character %s (HTTP %s): %s",
            character_id,
            error.status_code,
            error,
        )
        return
    except Exception:
        logger.exception("Unexpected error polling location for character %s", character_id)
        return

    new_system_id = location.solar_system_id

    try:
        new_system = SolarSystem.objects.get(pk=new_system_id)
    except SolarSystem.DoesNotExist:
        # ESI reported a solar_system_id our locally-imported SDE data
        # doesn't have (a partial/stale import) - resolved once here rather
        # than inside the per-row loop below, so this can't abort partway
        # through and leave some of tracked_rows unsynced for this poll.
        logger.warning(
            "Solar system %s (character %s) not found in local SDE data, skipping",
            new_system_id,
            character_id,
        )
        return

    for tracked in tracked_rows:
        _apply_location_update(tracked, new_system)


def _broadcast_online_state_change(tracked: TrackedCharacter, online: bool) -> None:
    """Tell every map `tracked`'s owner currently has open that this
    character just went online or offline, independent of any location
    change - a map viewer's state only ever updates via these broadcasts
    (see MapView.tsx), so without this an offline character would keep
    showing on the map indefinitely instead of disappearing live.
    """

    open_map_ids = MapPresence.objects.filter(
        user_id=tracked.added_by_id
    ).values_list("map_id", flat=True).distinct()

    for map_id in open_map_ids:
        if online:
            broadcast_map_event(map_id, "character.moved", tracked_character_to_schema(tracked))
        else:
            broadcast_map_event(
                map_id, "character.removed", {"character_id": tracked.character.character_id}
            )


def _character_is_online(character_id: int, token: Token, last_known: bool | None) -> bool | None:
    """Whether a character is currently logged in, via ESI's online
    endpoint - lets the caller skip a wasted location lookup for characters
    who are confirmed offline.

    On a 304 ("unchanged since your last fetch") this returns `last_known` -
    the online state already persisted on the character's TrackedCharacter
    row(s) - rather than losing that signal. Returns None ("unknown, proceed
    anyway") on any other error: those aren't a confirmation that the old
    state still holds, and we'd rather poll location unnecessarily once in a
    while than have a transient failure make a genuinely online character
    disappear from tracking.
    """

    try:
        online = esi.client.Location.GetCharactersCharacterIdOnline(
            character_id=character_id, token=token
        ).result()
    except HTTPNotModified:
        logger.debug("Online status for character %s unchanged (304)", character_id)
        return last_known
    except TokenError as error:
        logger.info(
            "ESI token error checking online status for character %s: %s",
            character_id,
            error,
        )
        return None
    except ESIErrorLimitException as error:
        logger.warning(
            "ESI error limited checking online status for character %s: %s",
            character_id,
            error,
        )
        return None
    except (HTTPClientError, HTTPServerError) as error:
        logger.warning(
            "ESI online lookup failed for character %s (HTTP %s): %s",
            character_id,
            error.status_code,
            error,
        )
        return None
    except Exception:
        logger.exception("Unexpected error checking online status for character %s", character_id)
        return None

    return online.online


def _apply_location_update(tracked: TrackedCharacter, new_system: SolarSystem) -> None:
    """Update one TrackedCharacter row for a freshly-polled solar system,
    auto-growing every map its owner currently has open (adding the new
    system/connection there if needed) and broadcasting the move to each.
    """

    now = timezone.now()

    if tracked.last_solar_system_id == new_system.id:
        tracked.last_seen_at = now
        tracked.save(update_fields=["last_seen_at"])
        return

    old_system = tracked.last_solar_system

    open_map_ids = list(
        MapPresence.objects.filter(user_id=tracked.added_by_id)
        .values_list("map_id", flat=True)
        .distinct()
    )
    for map_id in open_map_ids:
        _grow_map_for_character(map_id, tracked, old_system, new_system)

    tracked.last_solar_system = new_system
    tracked.last_seen_at = now
    tracked.save(update_fields=["last_solar_system", "last_seen_at"])

    for map_id in open_map_ids:
        broadcast_map_event(
            map_id, "character.moved", tracked_character_to_schema(tracked)
        )


def _grow_map_for_character(
    map_id: int,
    tracked: TrackedCharacter,
    old_system: SolarSystem | None,
    new_system: SolarSystem,
) -> None:
    """Auto-add the system a tracked character just jumped into (and a
    connection back to where they came from) to one map its owner has open.
    """

    old_map_system = None
    if old_system is not None:
        old_map_system = MapSystem.objects.filter(
            map_id=map_id, solar_system=old_system
        ).first()

    new_map_system, system_created = MapSystem.objects.get_or_create(
        map_id=map_id,
        solar_system=new_system,
        defaults={
            "added_by": tracked.added_by,
            **_position_near(old_map_system),
        },
    )
    if system_created:
        owner = single_system_owner(new_map_system.solar_system)
        broadcast_map_event(
            map_id, "system.added", system_to_schema(new_map_system, owner=owner)
        )

    if old_map_system is not None and old_map_system.id != new_map_system.id:
        connection_type = (
            WormholeConnection.ConnectionType.STARGATE
            if stargate_connects(old_map_system.solar_system, new_system)
            else WormholeConnection.ConnectionType.WORMHOLE
        )
        connection, connection_created = get_or_create_connection(
            map_id,
            old_map_system,
            new_map_system,
            tracked.added_by,
            connection_type=connection_type,
        )
        if connection_created:
            broadcast_map_event(
                map_id, "connection.added", connection_to_schema(connection)
            )
            # Stargates are always the same known gate - nothing to identify.
            # A fresh wormhole connection, though, was just created blind (no
            # signature link, no wormhole type) - prompt only the user
            # tracking this character to say which of the old system's
            # scanned signatures this was (they're the one who'd know), not
            # everyone else who happens to have the same map open.
            if connection_type == WormholeConnection.ConnectionType.WORMHOLE:
                send_map_event_to_user(
                    map_id,
                    tracked.added_by_id,
                    "character.jump_needs_signature",
                    {
                        "connection_id": connection.id,
                        "character_name": tracked.character.character_name,
                        "old_map_system_id": old_map_system.id,
                        "new_map_system_id": new_map_system.id,
                    },
                )


@shared_task(
    bind=True,
    base=QueueOnce,
    # Same unlock_before_run reasoning as poll_tracked_character_locations -
    # this requeues itself at the end of a run, so the lock must be released
    # at start rather than held for the run's duration.
    once={"graceful": True, "unlock_before_run": True},
)
def poll_fleet_tracking_sessions(self):
    """Fan out one poll per active FleetTrackingSession.

    Unlike poll_tracked_character_locations, this is never gated on
    MapPresence/viewers - per the fleet-mass-tracking wayfinder map's
    ticket 08, pausing here while a session is active would silently lose
    real mass-crossing state, unlike personal location tracking where a
    paused poll just means briefly stale display data.

    Self-reschedules every FLEET_POLL_RESCHEDULE_SECONDS while any session is
    active; schedule an initial call periodically (e.g. every minute) via
    CELERYBEAT_SCHEDULE in your AA install's local settings, as a fallback
    to pick polling back up whenever a session starts.
    """

    session_ids = list(FleetTrackingSession.objects.values_list("id", flat=True))
    if not session_ids:
        return

    for session_id in session_ids:
        poll_fleet_session.apply_async(args=[session_id])

    self.apply_async(countdown=FLEET_POLL_RESCHEDULE_SECONDS)


def _unwrap_esi_list(result, attr_name: str):
    """Some ESI operations wrap an array-typed response in a named
    container attribute (see refresh_system_sovereignty's
    `result.solar_systems`), others hand back the array/RootModel directly
    (see that same task's `.root` unwrapping for a oneOf variant) - this
    handles either shape defensively rather than assuming one, since the
    exact wrapping for GetFleetsFleetIdMembers wasn't pinned down by the
    fleet-mass-tracking wayfinder map's ESI research (ticket 05)."""

    if hasattr(result, attr_name):
        return getattr(result, attr_name)
    if hasattr(result, "root"):
        return result.root
    return result


def _fetch_fleet_members(character_id: int, token) -> tuple[int, list] | None:
    """GetCharactersCharacterIdFleet + GetFleetsFleetIdMembers, returning
    (fleet_id, members) or None on any failure - including `character_id`
    no longer being fleet boss (checked via fleet_boss_id, per ticket 05's
    finding that this pre-check is available) or the fleet having
    disbanded/being inaccessible (both surface as the same ambiguous 404 on
    the members endpoint, per that same research - there is no way to tell
    the two apart, so both are just "this session is no longer usable")."""

    try:
        fleet_info = esi.client.Fleets.GetCharactersCharacterIdFleet(
            character_id=character_id, token=token
        ).result()
    except (TokenError, ESIErrorLimitException, HTTPClientError, HTTPServerError) as error:
        logger.info("Fleet lookup failed for character %s: %s", character_id, error)
        return None
    except Exception:
        logger.exception("Unexpected error looking up fleet for character %s", character_id)
        return None

    if getattr(fleet_info, "fleet_boss_id", None) != character_id:
        logger.info("Character %s is no longer fleet boss", character_id)
        return None

    try:
        members_result = esi.client.Fleets.GetFleetsFleetIdMembers(
            fleet_id=fleet_info.fleet_id, token=token
        ).result()
    except (TokenError, ESIErrorLimitException, HTTPClientError, HTTPServerError) as error:
        logger.info("Fleet members lookup failed for fleet %s: %s", fleet_info.fleet_id, error)
        return None
    except Exception:
        logger.exception("Unexpected error fetching members for fleet %s", fleet_info.fleet_id)
        return None

    return fleet_info.fleet_id, list(_unwrap_esi_list(members_result, "members"))


@shared_task(
    base=QueueOnce,
    once={"graceful": True, "keys": ["session_id"]},
)
def poll_fleet_session(session_id: int):
    """Poll one FleetTrackingSession's live composition, detect per-member
    jumps against FleetMemberState, apply mass deductions for any wormhole
    crossing (see wh_mapper.api.helpers.apply_fleet_crossing_mass), and
    broadcast the refreshed state to every connected viewer.

    See the fleet-mass-tracking wayfinder map's tickets 07/08/09.
    """

    try:
        session = FleetTrackingSession.objects.select_related(
            "fc_character", "started_by"
        ).get(pk=session_id)
    except FleetTrackingSession.DoesNotExist:
        return

    character_id = session.fc_character.character_id
    token = Token.get_token(character_id, FLEET_SCOPES)

    result = _fetch_fleet_members(character_id, token) if token else None
    if result is None:
        _handle_fleet_poll_failure(session)
        return

    fleet_id, member_rows = result

    session.fleet_id = fleet_id
    session.consecutive_failures = 0
    session.last_polled_at = timezone.now()
    session.save(update_fields=["fleet_id", "consecutive_failures", "last_polled_at"])

    existing_states = {
        state.character_id: state
        for state in FleetMemberState.objects.filter(session=session)
    }

    fc_new_system_id = None
    seen_character_ids = set()
    changed_connections: list[tuple[int, WormholeConnection]] = []

    for row in member_rows:
        member_character_id = row.character_id
        new_system_id = row.solar_system_id
        ship_type_id = getattr(row, "ship_type_id", None)
        seen_character_ids.add(member_character_id)

        if member_character_id == character_id:
            fc_new_system_id = new_system_id

        try:
            new_system = SolarSystem.objects.get(pk=new_system_id)
        except SolarSystem.DoesNotExist:
            logger.warning(
                "Solar system %s (fleet member %s) not found in local SDE data, skipping",
                new_system_id,
                member_character_id,
            )
            continue

        state = existing_states.get(member_character_id)
        old_system_id = state.last_solar_system_id if state else None

        if state is None:
            state = FleetMemberState(
                session=session,
                character_id=member_character_id,
                character_name=resolve_fleet_character_name(member_character_id),
            )

        if old_system_id is not None and old_system_id != new_system_id:
            mass_kg = ship_mass_kg(ship_type_id) if ship_type_id else None
            if mass_kg:
                changed_connections.extend(
                    apply_fleet_crossing_mass(
                        session.started_by, old_system_id, new_system_id, mass_kg
                    )
                )

        state.ship_type_id = ship_type_id
        state.last_solar_system = new_system
        state.save()

    # Members who've left the fleet since the last poll - their state is
    # meaningless once they're no longer in it.
    FleetMemberState.objects.filter(session=session).exclude(
        character_id__in=seen_character_ids
    ).delete()

    for map_id, connection in changed_connections:
        broadcast_map_event(map_id, "connection.updated", connection_to_schema(connection))

    hop_distances = (
        bfs_hop_distances(build_graph(session.started_by), fc_new_system_id)
        if fc_new_system_id is not None
        else {}
    )
    payload = fleet_session_to_schema(session, hop_distances, session.started_by)
    broadcast_fleet_event(session.id, "fleet.updated", payload)


def _handle_fleet_poll_failure(session: FleetTrackingSession) -> None:
    """One failed poll for `session` - increments consecutive_failures, and
    auto-stops (deletes) the session once FLEET_SESSION_FAILURE_THRESHOLD
    consecutive failures have accumulated. See ticket 07."""

    session.consecutive_failures += 1
    if session.consecutive_failures < FLEET_SESSION_FAILURE_THRESHOLD:
        session.save(update_fields=["consecutive_failures"])
        return

    session_id = session.id
    logger.info(
        "Fleet tracking session %s auto-stopped after %s consecutive failed polls",
        session_id,
        session.consecutive_failures,
    )
    session.delete()
    broadcast_fleet_event(session_id, "fleet.session_ended", {"session_id": session_id})


def _position_near(map_system: MapSystem | None) -> dict:
    """Layout position for a newly auto-added system: NEW_SYSTEM_OFFSET_X
    to the right of, and level with, the system the character jumped from -
    or the origin if there isn't one (first-ever poll)."""

    if map_system is None:
        return {"x": 0, "y": 0}

    return {
        "x": map_system.x + NEW_SYSTEM_OFFSET_X,
        "y": map_system.y,
    }


def _eve_scout_owner():
    """The first superuser found, as owner of the two eve-scout reference
    Maps - Map.owner is a required FK, but ownership barely matters beyond
    satisfying it: these maps are read_only (see Map.read_only's docstring),
    nobody is expected to edit them by hand regardless of who "owns" one."""

    return get_user_model().objects.filter(is_superuser=True).order_by("id").first()


def _eve_scout_remaining_hours(row: dict, now) -> float:
    """row["remaining_hours"] when eve-scout provides it (not documented as
    always present); otherwise computed from the required expires_at."""

    remaining_hours = row.get("remaining_hours")
    if remaining_hours is not None:
        return float(remaining_hours)

    expires_at = parse_datetime(row["expires_at"])
    return (expires_at - now).total_seconds() / 3600


def _sync_eve_scout_hub(map_name: str, hub_system_id: int, rows: list[dict], owner) -> None:
    """Sync one eve-scout hub's (Thera's or Turnur's) current live
    signatures onto its own dedicated read_only reference Map - see
    sync_eve_scout_thera_turnur."""

    map_obj, _ = Map.objects.get_or_create(
        name=map_name,
        read_only=True,
        defaults={"owner": owner, "visibility": Map.Visibility.PRIVATE},
    )

    hub_system, _ = MapSystem.objects.get_or_create(
        map=map_obj,
        solar_system_id=hub_system_id,
        defaults={"x": 0.0, "y": 0.0, "added_by": None},
    )

    # Stable order (not eve-scout's own, which can reshuffle run to run) so
    # this read-only map - nobody can drag it straight - doesn't jump around
    # visually between polls; unscanned far ends (no in_system_name) sort by
    # their own signature id instead.
    rows = sorted(rows, key=lambda r: r.get("in_system_name") or r["out_signature"])

    now = timezone.now()
    seen_out_signatures = set()
    changed = False

    for index, row in enumerate(rows):
        out_signature = row["out_signature"].upper()
        seen_out_signatures.add(out_signature)

        far_system = None
        if row.get("in_system_id") is not None:
            angle = 2 * math.pi * index / len(rows)
            far_system, far_created = MapSystem.objects.get_or_create(
                map=map_obj,
                solar_system_id=row["in_system_id"],
                defaults={
                    "x": EVE_SCOUT_HUB_RADIUS * math.cos(angle),
                    "y": EVE_SCOUT_HUB_RADIUS * math.sin(angle),
                    "added_by": None,
                },
            )
            if far_created:
                changed = True

        # Per eve-scout's own docs, wh_type only describes the hub-side
        # signature when wh_exits_outward is true - otherwise the hub side
        # is actually the K162 end, and the real entrance type belongs to
        # whichever far-side signature nobody's reported to this feed.
        wormhole_type = None
        if row.get("wh_exits_outward") and row.get("wh_type"):
            wormhole_type = WormholeType.objects.filter(code__iexact=row["wh_type"]).first()

        life_status = life_status_for_remaining_hours(
            _eve_scout_remaining_hours(row, now)
        )

        signature, sig_created = Signature.objects.update_or_create(
            map_system=hub_system,
            signature_id=out_signature,
            defaults={
                "sig_type": Signature.SignatureType.WORMHOLE,
                "wormhole_type": wormhole_type,
                "life_status": life_status,
                "life_status_marked_at": now,
            },
        )
        if sig_created:
            changed = True

        if far_system is not None:
            ship_size = row.get("max_ship_size") or WormholeConnection.ShipSize.UNKNOWN
            _, connection_created = get_or_create_connection(
                map_obj.id,
                hub_system,
                far_system,
                None,
                connection_type=WormholeConnection.ConnectionType.WORMHOLE,
                top_signature=signature,
                ship_size_limit=ship_size,
            )
            if connection_created:
                changed = True

    # Prune anything eve-scout no longer reports as live for this hub - it
    # expired, was completed elsewhere, or was deleted upstream. top_/
    # bottom_signature on the resulting connection isn't reliably "top" (see
    # get_or_create_connection's pk-order canonicalization), so both sides
    # need checking; same for which end is the far system.
    stale_signatures = list(
        Signature.objects.filter(map_system=hub_system).exclude(
            signature_id__in=seen_out_signatures
        )
    )
    if stale_signatures:
        stale_signature_ids = [s.id for s in stale_signatures]
        removed_connections = list(
            WormholeConnection.objects.filter(map=map_obj).filter(
                Q(top_signature_id__in=stale_signature_ids)
                | Q(bottom_signature_id__in=stale_signature_ids)
            )
        )
        far_system_ids = {
            c.bottom_system_id if c.top_system_id == hub_system.id else c.top_system_id
            for c in removed_connections
        }
        WormholeConnection.objects.filter(
            id__in=[c.id for c in removed_connections]
        ).delete()
        Signature.objects.filter(id__in=stale_signature_ids).delete()

        for far_system_id in far_system_ids:
            still_connected = WormholeConnection.objects.filter(
                Q(top_system_id=far_system_id) | Q(bottom_system_id=far_system_id)
            ).exists()
            if not still_connected:
                MapSystem.objects.filter(id=far_system_id).delete()

        changed = True

    if changed:
        broadcast_map_event(map_obj.id, "map.resync", {})


@shared_task
@track_heartbeat("sync_eve_scout_thera_turnur")
def sync_eve_scout_thera_turnur():
    """Keep two dedicated, read-only reference Maps (see Map.read_only) in
    sync with eve-scout.com's public feed of live Thera/Turnur wormhole
    signatures - one Map per hub, each with just that hub's own connections.
    Users import from either onto their own maps via
    wh_mapper.api.maps' import-from-map endpoint (wh_mapper.api.helpers.
    import_map_content).

    eve-scout's API has no delta/incremental endpoint - every poll re-fetches
    the full current list of live signatures, so this always does a full
    upsert-then-prune sync rather than applying incremental changes.

    Schedule this periodically (e.g. every 5 minutes, matching the feed's
    own Cache-Control max-age) via CELERYBEAT_SCHEDULE in your AA install's
    local settings, or run it on demand via
    `manage.py wh_mapper_sync_eve_scout_thera_turnur`.
    """

    # Deliberately not caught here - track_heartbeat needs the exception to
    # propagate to correctly record this run as a failure (same reasoning
    # as refresh_system_sovereignty's self.retry(), which raises internally
    # for the same purpose); swallowing it would make a failed fetch look
    # like a silent no-op success on the status page.
    response = httpx.get(EVE_SCOUT_API_URL, timeout=10)
    response.raise_for_status()

    owner = _eve_scout_owner()
    if owner is None:
        logger.warning(
            "No superuser found to own the eve-scout reference maps - skipping sync"
        )
        return

    rows = response.json()
    thera_rows = [row for row in rows if row.get("out_system_id") == THERA_SYSTEM_ID]
    turnur_rows = [row for row in rows if row.get("out_system_id") == TURNUR_SYSTEM_ID]

    _sync_eve_scout_hub(EVE_SCOUT_THERA_MAP_NAME, THERA_SYSTEM_ID, thera_rows, owner)
    _sync_eve_scout_hub(EVE_SCOUT_TURNUR_MAP_NAME, TURNUR_SYSTEM_ID, turnur_rows, owner)
