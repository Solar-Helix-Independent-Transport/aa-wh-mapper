# Third Party
# Django EvE SDE
# Third Party
from eve_sde.models import SolarSystem
from ninja import NinjaAPI

# Django
from django.db.models import Q
from django.shortcuts import get_object_or_404

# AA WH Mapper App
from wh_mapper.api import schema
from wh_mapper.api.helpers import (
    auto_link_stargates,
    bulk_system_statics,
    require_basic_access,
    require_visible_map,
    require_writable_map,
    single_system_owner,
    single_system_statics,
    solar_system_to_schema,
    system_to_schema,
    user_display_name,
)
from wh_mapper.broadcast import broadcast_map_event
from wh_mapper.models import MapSystem, Signature, WormholeConnection


class MapSystemApiEndpoints:
    """MapSystem CRUD endpoints, nested under a Map"""

    tags = ["Systems"]

    def __init__(self, api: NinjaAPI):

        @api.get(
            "/solar-systems/search/{query}/",
            response={200: list[schema.SolarSystemOut], 403: str},
            tags=self.tags,
        )
        def search_solar_systems(request, query: str, limit: int = 10):
            error = require_basic_access(request)
            if error:
                return error

            systems = list(
                SolarSystem.objects.filter(name__icontains=query).select_related(
                    "constellation__region"
                )[:limit]
            )
            statics = bulk_system_statics([s.id for s in systems])

            return [solar_system_to_schema(s, statics=statics.get(s.id)) for s in systems]

        @api.post(
            "/maps/{map_id}/systems/",
            response={200: schema.MapSystemOut, 403: str, 404: str},
            tags=self.tags,
        )
        def add_system(request, map_id: int, payload: schema.MapSystemCreate):
            map_obj, error = require_writable_map(request, map_id)
            if error:
                return error

            solar_system = get_object_or_404(SolarSystem, pk=payload.solar_system_id)

            system, created = MapSystem.objects.get_or_create(
                map=map_obj,
                solar_system=solar_system,
                defaults={
                    "label": payload.label,
                    "x": payload.x,
                    "y": payload.y,
                    "pinned": payload.pinned,
                    "added_by": request.user,
                },
            )

            out = system_to_schema(
                system,
                owner=single_system_owner(solar_system),
                statics=single_system_statics(solar_system.id),
            )

            if created:
                broadcast_map_event(map_obj.id, "system.added", out)
                auto_link_stargates(map_obj, system, request.user)

            return out

        @api.patch(
            "/maps/{map_id}/systems/{system_id}/",
            response={200: schema.MapSystemOut, 403: str, 404: str},
            tags=self.tags,
        )
        def update_system(
            request, map_id: int, system_id: int, payload: schema.MapSystemUpdate
        ):
            map_obj, error = require_writable_map(request, map_id)
            if error:
                return error

            system = get_object_or_404(MapSystem, pk=system_id, map=map_obj)

            for field, value in payload.dict(exclude_unset=True).items():
                setattr(system, field, value)
            system.save()

            out = system_to_schema(
                system,
                owner=single_system_owner(system.solar_system),
                statics=single_system_statics(system.solar_system_id),
            )
            broadcast_map_event(map_obj.id, "system.updated", out)

            return out

        @api.get(
            "/maps/{map_id}/systems/{system_id}/details/",
            response={200: schema.SystemDetailOut, 403: str, 404: str},
            tags=self.tags,
        )
        def get_system_details(request, map_id: int, system_id: int):
            """The one piece of a system's detail view not already sitting
            in the frontend's own map state - see schema.SystemDetailOut."""

            map_obj, error = require_visible_map(request, map_id)
            if error:
                return error

            system = get_object_or_404(
                MapSystem.objects.select_related(
                    "added_by__profile__main_character"
                ),
                pk=system_id,
                map=map_obj,
            )

            return {"added_by_name": user_display_name(system.added_by)}

        @api.delete(
            "/maps/{map_id}/systems/{system_id}/",
            response={204: None, 400: str, 403: str, 404: str},
            tags=self.tags,
        )
        def remove_system(request, map_id: int, system_id: int):
            map_obj, error = require_writable_map(request, map_id)
            if error:
                return error

            system = get_object_or_404(MapSystem, pk=system_id, map=map_obj)
            # Pinned marks a system as a locked "home base" - unlock it
            # (PATCH pinned=false) before it can be removed, so it can't be
            # deleted by an accidental click.
            if system.pinned:
                return 400, "System is locked and can't be removed - unlock it first"

            # Captured before .delete() - Signature.map_system and
            # WormholeConnection.top_system/bottom_system are on_delete=CASCADE,
            # so removing this system silently removes these too at the DB
            # level. Connected clients need the ids to drop them from local
            # state as well (see mapEvents.ts's system.removed handler) -
            # without this, every other viewer keeps rendering a stale
            # connection/signature pointing at a system that no longer exists.
            removed_signature_ids = list(
                Signature.objects.filter(map_system=system).values_list("id", flat=True)
            )
            removed_connection_ids = list(
                WormholeConnection.objects.filter(
                    Q(top_system=system) | Q(bottom_system=system)
                ).values_list("id", flat=True)
            )

            system.delete()

            broadcast_map_event(
                map_obj.id,
                "system.removed",
                {
                    "id": system_id,
                    "removed_signature_ids": removed_signature_ids,
                    "removed_connection_ids": removed_connection_ids,
                },
            )

            return 204, None


def setup(api: NinjaAPI) -> None:
    """Register MapSystem endpoints"""

    MapSystemApiEndpoints(api)
