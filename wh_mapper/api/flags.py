# Third Party
from ninja import NinjaAPI

# Django
from django.shortcuts import get_object_or_404

# AA WH Mapper App
from wh_mapper.api import schema
from wh_mapper.api.helpers import (
    apply_life_status,
    connection_flag_to_schema,
    connection_to_schema,
    require_basic_access,
    require_visible_map,
)
from wh_mapper.broadcast import broadcast_map_event
from wh_mapper.models import ConnectionFlag, WormholeConnection


def _recompute_routes_for_map(map_id: int) -> None:
    """Deferred import - see wh_mapper.api.connections._recompute_routes_for_map
    for why this can't be a module-scope import."""

    # AA WH Mapper App
    from wh_mapper.tasks import recompute_routes_for_map

    recompute_routes_for_map.delay(map_id)


class ConnectionFlagApiEndpoints:
    """Suggested connection status changes from users without edit access
    to the underlying map - see wh_mapper.models.ConnectionFlag and the
    wayfinder map's ticket 11. A user *with* edit access should call the
    existing update/delete connection endpoints directly instead - these
    endpoints are specifically for the case where they can't."""

    tags = ["Flags"]

    def __init__(self, api: NinjaAPI):

        @api.post(
            "/connections/{connection_id}/flag/",
            response={200: schema.ConnectionFlagOut, 403: str, 404: str},
            tags=self.tags,
        )
        def create_connection_flag(
            request, connection_id: int, payload: schema.ConnectionFlagCreate
        ):
            # Deliberately require_basic_access only, not require_visible_map
            # on the connection's own map - a flag exists precisely for
            # users who may not have that map's visibility (e.g. a shared
            # Route viewer built from someone else's maps, per ticket 08).
            error = require_basic_access(request)
            if error:
                return error

            connection = get_object_or_404(WormholeConnection, pk=connection_id)

            flag, _ = ConnectionFlag.objects.update_or_create(
                connection=connection,
                flagged_by=request.user,
                defaults={
                    "suggested_life_status": payload.suggested_life_status,
                    "suggested_mass_status": payload.suggested_mass_status,
                    "suggests_collapsed": payload.suggests_collapsed,
                },
            )

            return connection_flag_to_schema(flag)

        @api.get(
            "/connections/{connection_id}/flags/",
            response={200: list[schema.ConnectionFlagOut], 403: str, 404: str},
            tags=self.tags,
        )
        def list_connection_flags(request, connection_id: int):
            error = require_basic_access(request)
            if error:
                return error

            connection = get_object_or_404(WormholeConnection, pk=connection_id)

            return [connection_flag_to_schema(f) for f in connection.flags.all()]

        @api.post(
            "/maps/{map_id}/connections/{connection_id}/flags/{flag_id}/accept/",
            response={200: schema.ConnectionFlagAcceptResult, 403: str, 404: str},
            tags=self.tags,
        )
        def accept_connection_flag(
            request, map_id: int, connection_id: int, flag_id: int
        ):
            """Applies the suggestion via the same logic the direct
            update/delete connection endpoints use, then deletes the flag -
            no history kept, per ticket 11."""

            map_obj, error = require_visible_map(request, map_id)
            if error:
                return error

            connection = get_object_or_404(
                WormholeConnection, pk=connection_id, map=map_obj
            )
            flag = get_object_or_404(ConnectionFlag, pk=flag_id, connection=connection)

            if flag.suggests_collapsed:
                flag.delete()
                connection.delete()
                broadcast_map_event(map_obj.id, "connection.removed", {"id": connection_id})
                _recompute_routes_for_map(map_obj.id)
                return {"deleted": True, "connection": None}

            if flag.suggested_life_status:
                apply_life_status(connection, flag.suggested_life_status)
            if flag.suggested_mass_status:
                connection.mass_status = flag.suggested_mass_status
            connection.save()
            flag.delete()

            out = connection_to_schema(connection)
            broadcast_map_event(map_obj.id, "connection.updated", out)
            _recompute_routes_for_map(map_obj.id)

            return {"deleted": False, "connection": out}

        @api.delete(
            "/maps/{map_id}/connections/{connection_id}/flags/{flag_id}/",
            response={204: None, 403: str, 404: str},
            tags=self.tags,
        )
        def dismiss_connection_flag(
            request, map_id: int, connection_id: int, flag_id: int
        ):
            map_obj, error = require_visible_map(request, map_id)
            if error:
                return error

            connection = get_object_or_404(
                WormholeConnection, pk=connection_id, map=map_obj
            )
            flag = get_object_or_404(ConnectionFlag, pk=flag_id, connection=connection)
            flag.delete()

            return 204, None


def setup(api: NinjaAPI) -> None:
    ConnectionFlagApiEndpoints(api)
