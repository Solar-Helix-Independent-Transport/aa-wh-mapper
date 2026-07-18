"""App Tasks"""

# Standard Library
import logging
from datetime import timedelta

# Third Party
from asgiref.sync import async_to_sync
from celery import shared_task
from channels.layers import get_channel_layer

# Django EvE SDE
from eve_sde.models import SolarSystem

# Django
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

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
    connection_to_schema,
    connection_wormhole_type,
    get_or_create_connection,
    remaining_life_hours,
    signature_reference_time,
    single_system_owner,
    stargate_connects,
    system_to_schema,
    tracked_character_to_schema,
)
from wh_mapper.broadcast import broadcast_map_event, send_map_event_to_user
from wh_mapper.constants import (
    LOCATION_SCOPES,
    MAP_PRESENCE_STALE_AFTER_SECONDS,
    NEW_SYSTEM_OFFSET_X,
    POLL_RESCHEDULE_SECONDS,
)
from wh_mapper.consumers import _group_name
from wh_mapper.models import (
    MapPresence,
    MapSystem,
    Signature,
    SystemSovereignty,
    TrackedCharacter,
    WormholeConnection,
)
from wh_mapper.providers import esi

logger = logging.getLogger(__name__)


@shared_task
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
def poll_tracked_character_locations(self):
    """Fan out one location lookup per distinct tracked character whose
    owner currently has any map open (has an active MapPresence row) -
    tracking a character does nothing while its owner isn't watching
    anything.

    Self-reschedules every `POLL_RESCHEDULE_SECONDS` while there's anyone to
    poll, so live viewers get near-real-time updates without needing a tight
    CELERYBEAT_SCHEDULE interval. Once nobody's watching, it stops
    rescheduling itself - schedule an initial call periodically (e.g. every
    minute) via CELERYBEAT_SCHEDULE in your AA install's local settings, as a
    fallback to pick tracking back up whenever presence returns.
    """

    online_user_ids = set(MapPresence.objects.values_list("user_id", flat=True))
    if not online_user_ids:
        return

    # Not filtered by is_active (that now tracks *character* online status,
    # not row deletion) - a character marked offline still needs to be
    # dispatched so poll_character_location can notice when they log back in.
    # Filtered by added_by_id at the DB (rather than fetching every
    # TrackedCharacter row and filtering in Python) - this reschedules
    # itself every POLL_RESCHEDULE_SECONDS while anyone's online, so an
    # unfiltered fetch would re-pull the whole table on every tick.
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

    self.apply_async(countdown=POLL_RESCHEDULE_SECONDS)


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
