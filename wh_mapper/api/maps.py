# Third Party
from ninja import NinjaAPI

# AA WH Mapper App
from wh_mapper.api import schema
from wh_mapper.api.helpers import (
    bulk_system_owners,
    bulk_system_statics,
    can_edit_map,
    connection_to_schema,
    map_to_schema,
    require_basic_access,
    require_visible_map,
    revoke_stale_map_access,
    signature_to_schema,
    system_to_schema,
    tracked_character_to_schema,
)
from wh_mapper.broadcast import revoke_map_access
from wh_mapper.models import Map, MapPresence, Signature, TrackedCharacter


class MapApiEndpoints:
    """Map CRUD + state snapshot endpoints"""

    tags = ["Maps"]

    def __init__(self, api: NinjaAPI):

        @api.get("/maps/", response={200: list[schema.MapOut], 403: str}, tags=self.tags)
        def list_maps(request):
            error = require_basic_access(request)
            if error:
                return error

            maps = Map.objects.visible_to(request.user).select_related("owner")

            return [map_to_schema(m, request) for m in maps]

        @api.post("/maps/", response={200: schema.MapOut, 403: str}, tags=self.tags)
        def create_map(request, payload: schema.MapCreate):
            error = require_basic_access(request)
            if error:
                return error

            map_obj = Map.objects.create(
                name=payload.name, owner=request.user, visibility=payload.visibility
            )

            return map_to_schema(map_obj, request)

        @api.get(
            "/maps/{map_id}/",
            response={200: schema.MapOut, 403: str, 404: str},
            tags=self.tags,
        )
        def get_map(request, map_id: int):
            map_obj, error = require_visible_map(request, map_id)
            if error:
                return error

            return map_to_schema(map_obj, request)

        @api.patch(
            "/maps/{map_id}/",
            response={200: schema.MapOut, 403: str, 404: str},
            tags=self.tags,
        )
        def update_map(request, map_id: int, payload: schema.MapUpdate):
            map_obj, error = require_visible_map(request, map_id)
            if error:
                return error

            if not can_edit_map(request, map_obj):
                return 403, "Permission denied"

            for field, value in payload.dict(exclude_unset=True).items():
                setattr(map_obj, field, value)
            map_obj.save()

            # A private->shared flip can't strand anyone (visible_to only
            # grows), but shared->private can - drop anyone already
            # connected who visible_to would now refuse.
            revoke_stale_map_access(map_obj)

            return map_to_schema(map_obj, request)

        @api.delete(
            "/maps/{map_id}/", response={204: None, 403: str, 404: str}, tags=self.tags
        )
        def delete_map(request, map_id: int):
            map_obj, error = require_visible_map(request, map_id)
            if error:
                return error

            if not can_edit_map(request, map_obj):
                return 403, "Permission denied"

            # Captured before delete() - MapPresence rows cascade-delete
            # with the Map, so there'd be nothing left to query afterwards.
            connected_channels = list(
                MapPresence.objects.filter(map=map_obj).values_list(
                    "channel_name", flat=True
                )
            )

            map_obj.delete()

            revoke_map_access(connected_channels)

            return 204, None

        @api.get(
            "/maps/{map_id}/state/",
            response={200: schema.MapStateOut, 403: str, 404: str},
            tags=self.tags,
        )
        def get_map_state(request, map_id: int):
            map_obj, error = require_visible_map(request, map_id)
            if error:
                return error

            systems = list(
                map_obj.systems.select_related("solar_system__constellation__region")
            )
            signatures = Signature.objects.filter(
                map_system__map=map_obj
            ).select_related("wormhole_type")
            connections = map_obj.connections.select_related(
                "top_signature__wormhole_type",
                "bottom_signature__wormhole_type",
                "top_system",
                "bottom_system",
            )
            # Global tracking: a character shows up on this map only while
            # it's currently online (is_active - see wh_mapper.tasks), its
            # owner has *this* map open (has a MapPresence row here), and
            # its last known system is actually one of this map's systems -
            # see wh_mapper.tasks._apply_location_update, which keeps that
            # last part true as characters move.
            present_user_ids = MapPresence.objects.filter(map=map_obj).values_list(
                "user_id", flat=True
            )
            system_ids = [s.solar_system_id for s in systems]
            tracked_characters = TrackedCharacter.objects.filter(
                is_active=True,
                added_by_id__in=present_user_ids,
                last_solar_system_id__in=system_ids,
            ).select_related("character", "last_solar_system__constellation__region")

            # Batched once for the whole map (see bulk_system_owners/
            # bulk_system_statics) rather than resolved per system, to avoid
            # N+1 queries.
            owners = bulk_system_owners([s.solar_system for s in systems])
            statics = bulk_system_statics(system_ids)

            return {
                "map": map_to_schema(map_obj, request),
                "systems": [
                    system_to_schema(
                        s,
                        owner=owners.get(s.solar_system_id),
                        statics=statics.get(s.solar_system_id),
                    )
                    for s in systems
                ],
                "signatures": [signature_to_schema(s) for s in signatures],
                "connections": [connection_to_schema(c) for c in connections],
                "tracked_characters": [
                    tracked_character_to_schema(t) for t in tracked_characters
                ],
                "current_user_id": request.user.id,
            }


def setup(api: NinjaAPI) -> None:
    """Register map endpoints"""

    MapApiEndpoints(api)
