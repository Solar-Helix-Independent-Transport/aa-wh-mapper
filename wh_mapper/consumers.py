"""Websocket consumers"""

# Third Party
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

# Django
from django.contrib.auth.models import AnonymousUser
from django.utils import timezone

# AA WH Mapper App
from wh_mapper.constants import WS_CLOSE_FORBIDDEN, WS_CLOSE_UNAUTHENTICATED
from wh_mapper.models import MapPresence


def _group_name(map_id: int) -> str:
    """Channel layer group name for a given Map"""

    return f"wh_mapper_map_{map_id}"


def _route_group_name(route_id: int) -> str:
    """Channel layer group name for a given shared Route"""

    return f"wh_mapper_route_{route_id}"


class MapConsumer(AsyncJsonWebsocketConsumer):
    """Broadcasts live changes for a single Map to every connected viewer"""

    async def connect(self):
        self.map_id = int(self.scope["url_route"]["kwargs"]["map_id"])
        self.group_name = _group_name(self.map_id)

        user = self.scope.get("user")
        if user is None or isinstance(user, AnonymousUser) or not user.is_authenticated:
            # Rejecting before accept() collapses to a bare HTTP 403 at the
            # handshake over a real ASGI server (daphne) - the custom close
            # code only survives if we accept() first, then close().
            await self.accept()
            await self.close(code=WS_CLOSE_UNAUTHENTICATED)
            return

        if not await self.user_can_view_map(user, self.map_id):
            await self.accept()
            await self.close(code=WS_CLOSE_FORBIDDEN)
            return

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        # Presence gates ESI location polling (see wh_mapper/tasks.py) to
        # tracked characters whose owner is actually watching this map.
        await database_sync_to_async(self._create_presence)(user)

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
            await database_sync_to_async(self._delete_presence)()

    def _create_presence(self, user):
        MapPresence.objects.update_or_create(
            map_id=self.map_id,
            channel_name=self.channel_name,
            defaults={"user": user, "last_seen_at": timezone.now()},
        )

    def _delete_presence(self):
        MapPresence.objects.filter(
            map_id=self.map_id, channel_name=self.channel_name
        ).delete()

    def _touch_presence(self):
        MapPresence.objects.filter(
            map_id=self.map_id, channel_name=self.channel_name
        ).update(last_seen_at=timezone.now())

    async def receive_json(self, content, **kwargs):
        """Client heartbeat (see frontend/src/hooks/useMapSocket.ts) - the
        only inbound message this consumer expects. Bumps last_seen_at so
        wh_mapper.tasks.prune_stale_map_presence can tell this connection is
        still genuinely open rather than one whose disconnect() never fired.
        """

        if content.get("type") == "ping":
            await database_sync_to_async(self._touch_presence)()

    async def map_event(self, event):
        """Handler for messages sent via group_send(type='map.event', ...)"""

        await self.send_json(event["payload"])

    async def access_revoked(self, event):
        """Handler for a targeted access.revoked message (see
        wh_mapper.broadcast.revoke_map_access) - force-closes this specific
        connection because its access to the map was just cut, e.g. by a
        revoked share. Sent directly to this connection's channel, not via
        the map group, so it doesn't affect anyone else still watching.
        """

        await self.close(code=WS_CLOSE_FORBIDDEN)

    @staticmethod
    def user_can_view_map_sync(user, map_id: int) -> bool:
        """Whether `user` may currently hold (or keep) a live connection to
        Map `map_id` - basic_access is required first (also used directly by
        wh_mapper.api.helpers.revoke_stale_map_access, unlike connect() above
        which no longer needs a separate check now that this covers it),
        then the same map_visible_to_user predicate get_visible_map (HTTP)
        uses.
        """

        if not user.has_perm("wh_mapper.basic_access"):
            return False

        # Imported here (not at module scope) to avoid a wh_mapper.consumers
        # <-> wh_mapper.api.helpers import cycle - wh_mapper.broadcast (which
        # helpers.py imports at module scope) itself imports from this
        # module, so a module-scope import here would be circular.
        # AA WH Mapper App
        from wh_mapper.api.helpers import map_visible_to_user

        return map_visible_to_user(user, map_id)

    async def user_can_view_map(self, user, map_id: int) -> bool:
        return await database_sync_to_async(self.user_can_view_map_sync)(user, map_id)


class RouteConsumer(AsyncJsonWebsocketConsumer):
    """Broadcasts live recomputes for a single shared Route to every
    connected viewer - see wh_mapper.models.Route and the wayfinder map's
    ticket 08/09. No presence tracking (unlike MapConsumer) - a Route has
    no ESI polling to gate, so there's nothing that needs to know who's
    watching."""

    async def connect(self):
        self.route_id = int(self.scope["url_route"]["kwargs"]["route_id"])
        self.group_name = _route_group_name(self.route_id)

        user = self.scope.get("user")
        if user is None or isinstance(user, AnonymousUser) or not user.is_authenticated:
            await self.accept()
            await self.close(code=WS_CLOSE_UNAUTHENTICATED)
            return

        if not await self.user_can_view_route(user, self.route_id):
            await self.accept()
            await self.close(code=WS_CLOSE_FORBIDDEN)
            return

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def route_event(self, event):
        """Handler for messages sent via group_send(type='route.event', ...)"""

        await self.send_json(event["payload"])

    @staticmethod
    def user_can_view_route_sync(user, route_id: int) -> bool:
        """Link-based visibility (see wh_mapper.models.Route.Visibility):
        the owner can always view; anyone else needs basic_access plus
        visibility=shared - no per-user ACL, deliberately, per ticket 08.
        """

        if not user.has_perm("wh_mapper.basic_access"):
            return False

        # Imported here (not at module scope) - same wh_mapper.consumers <->
        # wh_mapper.api.helpers cycle MapConsumer's equivalent avoids.
        # AA WH Mapper App
        from wh_mapper.api.helpers import route_visible_to_user

        return route_visible_to_user(user, route_id)

    async def user_can_view_route(self, user, route_id: int) -> bool:
        return await database_sync_to_async(self.user_can_view_route_sync)(user, route_id)
