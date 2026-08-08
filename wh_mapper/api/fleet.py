"""Backseat fleet-mass-tracking endpoints - see the fleet-mass-tracking
wayfinder map (.scratch/fleet-mass-tracking/map.md) for the design this
implements, particularly tickets 02/07/11/12."""

# Third Party
from ninja import NinjaAPI

# Django
from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404

# Alliance Auth
from allianceauth.eveonline.models import EveCharacter
from esi.errors import TokenError
from esi.exceptions import ESIErrorLimitException, HTTPClientError, HTTPServerError
from esi.models import Token

# AA WH Mapper App
from wh_mapper.api import schema
from wh_mapper.api.helpers import (
    available_fleet_character_to_schema,
    fleet_session_to_schema,
    require_backseat_fc,
    user_display_name,
)
from wh_mapper.broadcast import broadcast_fleet_event
from wh_mapper.constants import FLEET_SCOPES
from wh_mapper.models import (
    FleetMemberState,
    FleetTrackingSession,
    FleetTrackingWatcher,
)
from wh_mapper.pathfinding import bfs_hop_distances, build_graph
from wh_mapper.providers import esi
from wh_mapper.tasks import poll_fleet_session

User = get_user_model()


def _session_payload(session: FleetTrackingSession, viewer) -> dict:
    """FleetSessionOut for `session`, computing hop distances live from the
    FC's own last-known system (empty until the first poll lands)."""

    fc_state = (
        FleetMemberState.objects.filter(
            session=session, character_id=session.fc_character.character_id
        )
        .select_related("last_solar_system")
        .first()
    )
    hop_distances = {}
    if fc_state is not None and fc_state.last_solar_system_id is not None:
        hop_distances = bfs_hop_distances(
            build_graph(session.started_by), fc_state.last_solar_system_id
        )

    return fleet_session_to_schema(session, hop_distances, viewer)


class FleetApiEndpoints:
    """Listing the backseat token pool, and starting/stopping/watching
    fleet-tracking sessions - see wh_mapper.tasks.poll_fleet_session for the
    actual ESI polling this drives."""

    tags = ["Fleet"]

    def __init__(self, api: NinjaAPI):

        @api.get(
            "/fleet/available-characters/",
            response={200: list[schema.AvailableFleetCharacterOut], 403: str},
            tags=self.tags,
        )
        def list_available_characters(request):
            """Every character - account-wide, not scoped to the requesting
            user - with a valid, unexpired ESI token carrying FLEET_SCOPES.
            Granting the scope is itself what makes a character available
            here (ticket 02) - there's no separate opt-in step."""

            error = require_backseat_fc(request)
            if error:
                return error

            owner_user_id_by_character: dict[int, int] = {}
            for character_id, user_id in (
                Token.objects.filter()
                .require_scopes(FLEET_SCOPES)
                .require_valid()
                .values_list("character_id", "user_id")
                .distinct()
            ):
                owner_user_id_by_character.setdefault(character_id, user_id)

            characters = EveCharacter.objects.filter(
                character_id__in=owner_user_id_by_character.keys()
            )
            owners_by_id = {
                user.id: user
                for user in User.objects.filter(
                    id__in=set(owner_user_id_by_character.values())
                )
            }
            active_character_ids = set(
                FleetTrackingSession.objects.values_list(
                    "fc_character__character_id", flat=True
                )
            )

            result = [
                available_fleet_character_to_schema(
                    character,
                    user_display_name(
                        owners_by_id.get(owner_user_id_by_character.get(character.character_id))
                    )
                    or "Unknown",
                    character.character_id in active_character_ids,
                )
                for character in characters
            ]
            result.sort(key=lambda c: c["character_name"])

            return result

        @api.post(
            "/fleet/sessions/{character_id}/start/",
            response={200: schema.FleetSessionOut, 403: str, 404: str},
            tags=self.tags,
        )
        def start_session(request, character_id: int):
            """Start tracking `character_id`'s fleet, or attach as a
            watcher if someone else already started tracking it (ticket 07)
            - one active session per FC character at a time."""

            error = require_backseat_fc(request)
            if error:
                return error

            character = get_object_or_404(EveCharacter, character_id=character_id)

            existing = FleetTrackingSession.objects.filter(fc_character=character).first()
            if existing is not None:
                FleetTrackingWatcher.objects.get_or_create(
                    session=existing, user=request.user
                )
                return _session_payload(existing, request.user)

            token = Token.get_token(character_id, FLEET_SCOPES)
            if not token:
                return 403, "No valid fleet-read ESI token for this character"

            try:
                fleet_info = esi.client.Fleets.GetCharactersCharacterIdFleet(
                    character_id=character_id, token=token
                ).result()
            except (TokenError, ESIErrorLimitException, HTTPClientError, HTTPServerError):
                return 403, "Could not read this character's fleet"

            if getattr(fleet_info, "fleet_boss_id", None) != character_id:
                return 403, "This character is not currently a fleet boss"

            session = FleetTrackingSession.objects.create(
                fc_character=character,
                started_by=request.user,
                fleet_id=fleet_info.fleet_id,
            )
            poll_fleet_session.apply_async(args=[session.id])

            return _session_payload(session, request.user)

        @api.delete(
            "/fleet/sessions/{session_id}/",
            response={204: None, 403: str, 404: str},
            tags=self.tags,
        )
        def stop_session(request, session_id: int):
            error = require_backseat_fc(request)
            if error:
                return error

            session = get_object_or_404(FleetTrackingSession, pk=session_id)
            if session.started_by_id != request.user.id:
                return 403, "Only the operator who started this session can stop it"

            session.delete()
            broadcast_fleet_event(session_id, "fleet.session_ended", {"session_id": session_id})

            return 204, None

        @api.delete(
            "/fleet/sessions/{session_id}/watch/",
            response={204: None, 403: str, 404: str},
            tags=self.tags,
        )
        def stop_watching(request, session_id: int):
            """A watcher detaching from a session they didn't start -
            unlike stop_session above, this never ends it for anyone else."""

            error = require_backseat_fc(request)
            if error:
                return error

            get_object_or_404(FleetTrackingSession, pk=session_id)
            FleetTrackingWatcher.objects.filter(
                session_id=session_id, user=request.user
            ).delete()

            return 204, None

        @api.get(
            "/fleet/sessions/",
            response={200: list[schema.FleetSessionOut], 403: str},
            tags=self.tags,
        )
        def list_sessions(request):
            """Every currently-active session - visibility is gated purely
            by the backseat_fc permission (ticket 11), not per-session."""

            error = require_backseat_fc(request)
            if error:
                return error

            sessions = FleetTrackingSession.objects.select_related(
                "fc_character", "started_by"
            )

            return [_session_payload(session, request.user) for session in sessions]

        @api.get(
            "/fleet/sessions/{session_id}/",
            response={200: schema.FleetSessionOut, 403: str, 404: str},
            tags=self.tags,
        )
        def get_session(request, session_id: int):
            error = require_backseat_fc(request)
            if error:
                return error

            session = get_object_or_404(
                FleetTrackingSession.objects.select_related("fc_character", "started_by"),
                pk=session_id,
            )

            return _session_payload(session, request.user)


def setup(api: NinjaAPI) -> None:
    """Register fleet-tracking endpoints"""

    FleetApiEndpoints(api)
