"""Broadcast map mutations to connected websocket clients"""

# Standard Library
import json

# Third Party
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

# Django
from django.core.serializers.json import DjangoJSONEncoder

# AA WH Mapper App
from wh_mapper.consumers import _fleet_group_name, _group_name, _route_group_name
from wh_mapper.models import MapPresence


def broadcast_fleet_event(session_id: int, event: str, data: dict) -> None:
    """Fan out a fleet-tracking session update to every client connected to
    that session - see wh_mapper.consumers.FleetSessionConsumer and the
    fleet-mass-tracking wayfinder map's ticket 12."""

    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    async_to_sync(channel_layer.group_send)(
        _fleet_group_name(session_id),
        {"type": "fleet.event", "payload": {"event": event, "data": _json_safe(data)}},
    )


def broadcast_route_event(route_id: int, event: str, data: dict) -> None:
    """Fan out a Route recompute to every client connected to that route -
    see wh_mapper.consumers.RouteConsumer and the wayfinder map's ticket 08.
    """

    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    async_to_sync(channel_layer.group_send)(
        _route_group_name(route_id),
        {"type": "route.event", "payload": {"event": event, "data": _json_safe(data)}},
    )


def broadcast_map_event(map_id: int, event: str, data: dict) -> None:
    """Fan out a map mutation to every client connected to that map."""

    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    async_to_sync(channel_layer.group_send)(
        _group_name(map_id),
        {"type": "map.event", "payload": {"event": event, "data": _json_safe(data)}},
    )


def send_map_event_to_user(map_id: int, user_id: int, event: str, data: dict) -> None:
    """Send a map event to only one user's own open connection(s) to a map
    (every tab they have it open in, if more than one) rather than every
    viewer - see wh_mapper.tasks._grow_map_for_character's
    character.jump_needs_signature prompt, which should only interrupt the
    user tracking the character that jumped, not everyone else who happens
    to have the same map open.
    """

    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    payload = {"type": "map.event", "payload": {"event": event, "data": _json_safe(data)}}
    channel_names = MapPresence.objects.filter(map_id=map_id, user_id=user_id).values_list(
        "channel_name", flat=True
    )
    for channel_name in channel_names:
        async_to_sync(channel_layer.send)(channel_name, payload)


def _json_safe(data: dict) -> dict:
    """The channel layer's msgpack serializer can't handle datetimes (or
    other non-JSON-primitive values) straight from a model - round-trip
    through Django's JSON encoder first, the same normalization ninja's HTTP
    response already does for these dicts.
    """

    return json.loads(json.dumps(data, cls=DjangoJSONEncoder))


def revoke_map_access(channel_names: list[str]) -> None:
    """Force-close specific already-connected clients on a map - used when a
    share is revoked or a map's visibility is narrowed (see
    wh_mapper.api.helpers.revoke_stale_map_access), so access is cut
    immediately rather than only at their next reconnect. Unlike
    broadcast_map_event, this targets individual channels directly rather
    than the whole map group.
    """

    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    for channel_name in channel_names:
        async_to_sync(channel_layer.send)(channel_name, {"type": "access.revoked"})
