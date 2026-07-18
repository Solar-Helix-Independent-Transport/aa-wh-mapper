# Third Party
from ninja import NinjaAPI

# Django
from django.shortcuts import get_object_or_404

# Alliance Auth
from allianceauth.authentication.models import CharacterOwnership
from allianceauth.eveonline.models import EveCharacter
from esi.models import Token

# AA WH Mapper App
from wh_mapper.api import schema
from wh_mapper.api.helpers import (
    require_basic_access,
    start_tracking_character,
    trackable_character_to_schema,
    tracked_character_to_schema,
)
from wh_mapper.broadcast import broadcast_map_event
from wh_mapper.constants import LOCATION_SCOPES
from wh_mapper.models import MapPresence, TrackedCharacter


class TrackingApiEndpoints:
    """Tracked-character listing/removal and the "toggle on" flow for
    already-authorized characters (not scoped to any one Map)."""

    tags = ["Tracking"]

    def __init__(self, api: NinjaAPI):

        @api.get(
            "/trackable-characters/",
            response={200: list[schema.TrackableCharacterOut], 403: str},
            tags=self.tags,
        )
        def list_trackable_characters(request):
            """Every character on the requesting user's own account that
            already has a valid ESI location token - whether currently
            tracked or not, so an untracked one can be toggled on without
            another EVE SSO round-trip. Characters with no token at all
            aren't listed here; those still go through the SSO grant link.
            """

            error = require_basic_access(request)
            if error:
                return error

            owned_character_ids = CharacterOwnership.objects.filter(
                user=request.user
            ).values_list("character__character_id", flat=True)

            tokened_character_ids = (
                Token.objects.filter(
                    user=request.user, character_id__in=owned_character_ids
                )
                .require_scopes(LOCATION_SCOPES)
                .require_valid()
                .values_list("character_id", flat=True)
                .distinct()
            )

            characters = EveCharacter.objects.filter(
                character_id__in=set(tokened_character_ids)
            )
            tracked_by_character_id = {
                t.character.character_id: t
                for t in TrackedCharacter.objects.filter(
                    added_by=request.user, character__in=characters
                ).select_related("character", "last_solar_system")
            }

            result = [
                trackable_character_to_schema(
                    character, tracked_by_character_id.get(character.character_id)
                )
                for character in characters
            ]
            result.sort(key=lambda c: c["character_name"])

            return result

        @api.post(
            "/trackable-characters/{character_id}/track/",
            response={200: schema.TrackedCharacterOut, 403: str, 404: str},
            tags=self.tags,
        )
        def start_tracking_existing_character(request, character_id: int):
            """Start tracking a character that already has a valid ESI
            token from a prior SSO grant - no new EVE login needed."""

            error = require_basic_access(request)
            if error:
                return error

            owns_character = CharacterOwnership.objects.filter(
                user=request.user, character__character_id=character_id
            ).exists()
            if not owns_character:
                return 404, "Character not found"

            has_token = (
                Token.objects.filter(user=request.user, character_id=character_id)
                .require_scopes(LOCATION_SCOPES)
                .require_valid()
                .exists()
            )
            if not has_token:
                return 403, "No valid ESI token for this character - grant access first"

            character = EveCharacter.objects.get(character_id=character_id)
            tracked = start_tracking_character(request.user, character)

            return tracked_character_to_schema(tracked)

        @api.delete(
            "/tracked-characters/{character_id}/",
            response={204: None, 403: str, 404: str},
            tags=self.tags,
        )
        def remove_tracked_character(request, character_id: int):
            error = require_basic_access(request)
            if error:
                return error

            tracked = get_object_or_404(
                TrackedCharacter, added_by=request.user, character__character_id=character_id
            )
            tracked.delete()

            open_map_ids = MapPresence.objects.filter(
                user=request.user
            ).values_list("map_id", flat=True).distinct()
            for map_id in open_map_ids:
                broadcast_map_event(
                    map_id, "character.removed", {"character_id": character_id}
                )

            return 204, None


def setup(api: NinjaAPI) -> None:
    """Register tracking endpoints"""

    TrackingApiEndpoints(api)
