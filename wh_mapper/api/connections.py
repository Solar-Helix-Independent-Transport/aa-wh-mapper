# Third Party
from ninja import NinjaAPI

# Django
from django.shortcuts import get_object_or_404

# AA WH Mapper App
from wh_mapper.api import schema
from wh_mapper.api.helpers import (
    apply_life_status,
    connection_to_schema,
    create_connection,
    get_or_create_connection,
    require_visible_map,
)
from wh_mapper.broadcast import broadcast_map_event
from wh_mapper.models import MapSystem, Signature, WormholeConnection


class WormholeConnectionApiEndpoints:
    """WormholeConnection CRUD endpoints, nested under a Map"""

    tags = ["Connections"]

    def __init__(self, api: NinjaAPI):

        @api.post(
            "/maps/{map_id}/connections/",
            response={200: schema.WormholeConnectionOut, 400: str, 403: str, 404: str},
            tags=self.tags,
        )
        def add_connection(
            request, map_id: int, payload: schema.WormholeConnectionCreate
        ):
            map_obj, error = require_visible_map(request, map_id)
            if error:
                return error

            if payload.top_system_id == payload.bottom_system_id:
                return 400, "A connection cannot link a system to itself"

            top_system = get_object_or_404(
                MapSystem, pk=payload.top_system_id, map=map_obj
            )
            bottom_system = get_object_or_404(
                MapSystem, pk=payload.bottom_system_id, map=map_obj
            )

            top_signature = None
            if payload.top_signature_id is not None:
                top_signature = get_object_or_404(
                    Signature, pk=payload.top_signature_id, map_system=top_system
                )

            bottom_signature = None
            if payload.bottom_signature_id is not None:
                bottom_signature = get_object_or_404(
                    Signature, pk=payload.bottom_signature_id, map_system=bottom_system
                )

            if payload.connection_type == WormholeConnection.ConnectionType.STARGATE:
                # get_or_create_connection (rather than a plain .create())
                # so drawing a stargate connection between a pair of
                # systems that already have one - e.g. a double-submitted
                # click - reuses the existing row instead of creating a
                # duplicate edge; a k-space gate pairing is fixed and
                # singular in-game, see WormholeConnection's unique
                # constraint.
                connection, connection_created = get_or_create_connection(
                    map_obj.id,
                    top_system,
                    bottom_system,
                    request.user,
                    connection_type=payload.connection_type,
                    top_signature=top_signature,
                    bottom_signature=bottom_signature,
                    mass_status=payload.mass_status,
                    ship_size_limit=payload.ship_size_limit,
                )
            else:
                # Wormhole (and ansiblex) connections are never
                # deduplicated - two separate wormholes really can connect
                # the same pair of systems, so a manual connect always
                # creates a new row.
                connection = create_connection(
                    map_obj.id,
                    top_system,
                    bottom_system,
                    request.user,
                    connection_type=payload.connection_type,
                    top_signature=top_signature,
                    bottom_signature=bottom_signature,
                    mass_status=payload.mass_status,
                    ship_size_limit=payload.ship_size_limit,
                )
                connection_created = True

            out = connection_to_schema(connection)
            if connection_created:
                broadcast_map_event(map_obj.id, "connection.added", out)

            return out

        @api.patch(
            "/maps/{map_id}/connections/{connection_id}/",
            response={200: schema.WormholeConnectionOut, 403: str, 404: str},
            tags=self.tags,
        )
        def update_connection(
            request,
            map_id: int,
            connection_id: int,
            payload: schema.WormholeConnectionUpdate,
        ):
            map_obj, error = require_visible_map(request, map_id)
            if error:
                return error

            connection = get_object_or_404(
                WormholeConnection, pk=connection_id, map=map_obj
            )

            update_data = payload.dict(exclude_unset=True)
            if "life_status" in update_data:
                apply_life_status(connection, update_data.pop("life_status"))
            for field, value in update_data.items():
                setattr(connection, field, value)
            connection.save()

            out = connection_to_schema(connection)
            broadcast_map_event(map_obj.id, "connection.updated", out)

            return out

        @api.post(
            "/maps/{map_id}/connections/{connection_id}/signature/",
            response={200: schema.WormholeConnectionOut, 400: str, 403: str, 404: str},
            tags=self.tags,
        )
        def link_connection_signature(
            request,
            map_id: int,
            connection_id: int,
            payload: schema.ConnectionSignatureLink,
        ):
            map_obj, error = require_visible_map(request, map_id)
            if error:
                return error

            connection = get_object_or_404(
                WormholeConnection, pk=connection_id, map=map_obj
            )
            signature = get_object_or_404(
                Signature, pk=payload.signature_id, map_system__map=map_obj
            )

            if signature.map_system_id == connection.top_system_id:
                connection.top_signature = signature
            elif signature.map_system_id == connection.bottom_system_id:
                connection.bottom_signature = signature
            else:
                return 400, "Signature does not belong to either end of this connection"

            connection.save()

            out = connection_to_schema(connection)
            broadcast_map_event(map_obj.id, "connection.updated", out)

            return out

        @api.delete(
            "/maps/{map_id}/connections/{connection_id}/",
            response={204: None, 403: str, 404: str},
            tags=self.tags,
        )
        def remove_connection(request, map_id: int, connection_id: int):
            map_obj, error = require_visible_map(request, map_id)
            if error:
                return error

            connection = get_object_or_404(
                WormholeConnection, pk=connection_id, map=map_obj
            )
            connection.delete()

            broadcast_map_event(map_obj.id, "connection.removed", {"id": connection_id})

            return 204, None


def setup(api: NinjaAPI) -> None:
    """Register WormholeConnection endpoints"""

    WormholeConnectionApiEndpoints(api)
