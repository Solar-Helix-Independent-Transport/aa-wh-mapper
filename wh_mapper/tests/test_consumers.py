"""Tests for wh_mapper's MapConsumer (websocket auth + broadcast)"""

# Standard Library
import asyncio
import json
from datetime import timedelta

# Third Party
from channels.auth import AuthMiddlewareStack
from channels.db import database_sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator

# Django
from django.test import Client, TransactionTestCase
from django.utils import timezone

# AA WH Mapper App
from wh_mapper.broadcast import broadcast_map_event, send_map_event_to_user
from wh_mapper.models import Map, MapPresence
from wh_mapper.routing import websocket_urlpatterns
from wh_mapper.tests.factories import make_user_with_character


class TestMapConsumer(TransactionTestCase):
    """TestMapConsumer"""

    def _run(self, coro):
        return asyncio.run(coro)

    def test_anonymous_connection_rejected(self):
        self._run(self._anonymous_connection_rejected())

    async def _anonymous_connection_rejected(self):
        owner, map_id = await database_sync_to_async(self._make_owner_and_map)()

        app = AuthMiddlewareStack(URLRouter(websocket_urlpatterns))
        communicator = WebsocketCommunicator(app, f"/ws/wh-mapper/maps/{map_id}/")
        # We accept() before close()ing so real ASGI servers (daphne) deliver
        # the custom close code to the client instead of collapsing it into a
        # bare HTTP 403 at the handshake - so connect() itself succeeds here,
        # and the rejection shows up as the very next outgoing message.
        connected, _ = await communicator.connect()
        self.assertTrue(connected)

        close_message = await communicator.receive_output(timeout=1)
        self.assertEqual(close_message["type"], "websocket.close")
        self.assertEqual(close_message["code"], 4401)

    def test_non_owner_without_share_rejected(self):
        self._run(self._non_owner_without_share_rejected())

    async def _non_owner_without_share_rejected(self):
        _owner, map_id = await database_sync_to_async(self._make_owner_and_map)()
        await database_sync_to_async(
            lambda: make_user_with_character("consumer_mallory", 300002)
        )()

        session_cookie = await database_sync_to_async(self._session_cookie_for)(
            "consumer_mallory"
        )

        app = AuthMiddlewareStack(URLRouter(websocket_urlpatterns))
        communicator = WebsocketCommunicator(
            app,
            f"/ws/wh-mapper/maps/{map_id}/",
            headers=[(b"cookie", f"sessionid={session_cookie}".encode())],
        )
        connected, _ = await communicator.connect()
        self.assertTrue(connected)

        close_message = await communicator.receive_output(timeout=1)
        self.assertEqual(close_message["type"], "websocket.close")
        self.assertEqual(close_message["code"], 4403)

    def test_owner_without_basic_access_rejected(self):
        self._run(self._owner_without_basic_access_rejected())

    async def _owner_without_basic_access_rejected(self):
        # An owner otherwise passes map visibility, so this only fails via
        # user_can_view_map_sync's own basic_access check.
        map_id = await database_sync_to_async(self._make_owner_without_basic_access)()
        session_cookie = await database_sync_to_async(self._session_cookie_for)(
            "consumer_no_access"
        )

        app = AuthMiddlewareStack(URLRouter(websocket_urlpatterns))
        communicator = WebsocketCommunicator(
            app,
            f"/ws/wh-mapper/maps/{map_id}/",
            headers=[(b"cookie", f"sessionid={session_cookie}".encode())],
        )
        connected, _ = await communicator.connect()
        self.assertTrue(connected)

        close_message = await communicator.receive_output(timeout=1)
        self.assertEqual(close_message["type"], "websocket.close")
        self.assertEqual(close_message["code"], 4403)

    def test_owner_connects_and_receives_broadcast(self):
        self._run(self._owner_connects_and_receives_broadcast())

    async def _owner_connects_and_receives_broadcast(self):
        _owner, map_id = await database_sync_to_async(self._make_owner_and_map)()
        session_cookie = await database_sync_to_async(self._session_cookie_for)(
            "consumer_owner"
        )

        app = AuthMiddlewareStack(URLRouter(websocket_urlpatterns))
        communicator = WebsocketCommunicator(
            app,
            f"/ws/wh-mapper/maps/{map_id}/",
            headers=[(b"cookie", f"sessionid={session_cookie}".encode())],
        )
        connected, _ = await communicator.connect()
        self.assertTrue(connected)

        await database_sync_to_async(broadcast_map_event)(
            map_id, "system.added", {"id": 1}
        )
        message = await communicator.receive_json_from(timeout=5)
        self.assertEqual(message, {"event": "system.added", "data": {"id": 1}})

        await communicator.disconnect()

    def test_ping_bumps_presence_last_seen_at(self):
        self._run(self._ping_bumps_presence_last_seen_at())

    async def _ping_bumps_presence_last_seen_at(self):
        _owner, map_id = await database_sync_to_async(self._make_owner_and_map)()
        session_cookie = await database_sync_to_async(self._session_cookie_for)(
            "consumer_owner"
        )

        app = AuthMiddlewareStack(URLRouter(websocket_urlpatterns))
        communicator = WebsocketCommunicator(
            app,
            f"/ws/wh-mapper/maps/{map_id}/",
            headers=[(b"cookie", f"sessionid={session_cookie}".encode())],
        )
        connected, _ = await communicator.connect()
        self.assertTrue(connected)

        stale_time = timezone.now() - timedelta(seconds=60)
        await database_sync_to_async(
            MapPresence.objects.filter(map_id=map_id).update
        )(last_seen_at=stale_time)

        await communicator.send_json_to({"type": "ping"})
        # give the consumer's receive_json a beat to land the DB write
        await asyncio.sleep(0.1)

        presence = await database_sync_to_async(MapPresence.objects.get)(map_id=map_id)
        self.assertGreater(presence.last_seen_at, stale_time)

        await communicator.disconnect()

    def test_send_map_event_to_user_only_reaches_that_user(self):
        self._run(self._send_map_event_to_user_only_reaches_that_user())

    async def _send_map_event_to_user_only_reaches_that_user(self):
        owner, map_id = await database_sync_to_async(self._make_owner_and_map)()
        await database_sync_to_async(self._make_shared_target)(map_id)

        app = AuthMiddlewareStack(URLRouter(websocket_urlpatterns))

        owner_cookie = await database_sync_to_async(self._session_cookie_for)("consumer_owner")
        owner_communicator = WebsocketCommunicator(
            app,
            f"/ws/wh-mapper/maps/{map_id}/",
            headers=[(b"cookie", f"sessionid={owner_cookie}".encode())],
        )
        connected, _ = await owner_communicator.connect()
        self.assertTrue(connected)

        other_cookie = await database_sync_to_async(self._session_cookie_for)("consumer_revoked")
        other_communicator = WebsocketCommunicator(
            app,
            f"/ws/wh-mapper/maps/{map_id}/",
            headers=[(b"cookie", f"sessionid={other_cookie}".encode())],
        )
        connected, _ = await other_communicator.connect()
        self.assertTrue(connected)

        await database_sync_to_async(send_map_event_to_user)(
            map_id, owner.id, "character.jump_needs_signature", {"connection_id": 1}
        )

        message = await owner_communicator.receive_json_from(timeout=5)
        self.assertEqual(
            message, {"event": "character.jump_needs_signature", "data": {"connection_id": 1}}
        )
        self.assertTrue(await other_communicator.receive_nothing(timeout=0.5))

        await owner_communicator.disconnect()
        await other_communicator.disconnect()

    def test_revoking_a_share_disconnects_the_live_socket(self):
        self._run(self._revoking_a_share_disconnects_the_live_socket())

    async def _revoking_a_share_disconnects_the_live_socket(self):
        # MapConsumer.connect only checks access once, at connect time - see
        # wh_mapper.api.helpers.revoke_stale_map_access, which this exercises
        # via the real remove_share endpoint rather than calling it directly,
        # so the test also covers that endpoint actually wiring this up.
        owner, map_id = await database_sync_to_async(self._make_owner_and_map)()
        target_character_id = await database_sync_to_async(self._make_shared_target)(map_id)

        session_cookie = await database_sync_to_async(self._session_cookie_for)(
            "consumer_revoked"
        )
        app = AuthMiddlewareStack(URLRouter(websocket_urlpatterns))
        communicator = WebsocketCommunicator(
            app,
            f"/ws/wh-mapper/maps/{map_id}/",
            headers=[(b"cookie", f"sessionid={session_cookie}".encode())],
        )
        connected, _ = await communicator.connect()
        self.assertTrue(connected)

        await database_sync_to_async(self._revoke_character_share)(map_id, target_character_id)

        close_message = await communicator.receive_output(timeout=1)
        self.assertEqual(close_message["type"], "websocket.close")
        self.assertEqual(close_message["code"], 4403)

    @staticmethod
    def _make_shared_target(map_id: int) -> int:
        target = make_user_with_character("consumer_revoked", 300003)
        owner_client = Client()
        assert owner_client.login(username="consumer_owner", password="test-password")
        owner_client.post(
            f"/wh-mapper/api/maps/{map_id}/share/",
            data=json.dumps(
                {"scope": "character", "target_id": target.profile.main_character.character_id}
            ),
            content_type="application/json",
        )
        return target.profile.main_character.character_id

    @staticmethod
    def _revoke_character_share(map_id: int, character_id: int) -> None:
        owner_client = Client()
        assert owner_client.login(username="consumer_owner", password="test-password")
        response = owner_client.delete(
            f"/wh-mapper/api/maps/{map_id}/share/character/{character_id}/"
        )
        assert response.status_code == 204

    @staticmethod
    def _make_owner_and_map():
        owner = make_user_with_character("consumer_owner", 300001)
        map_obj = Map.objects.create(name="Consumer Test Map", owner=owner)
        return owner, map_obj.id

    @staticmethod
    def _make_owner_without_basic_access() -> int:
        owner = make_user_with_character("consumer_no_access", 300004, perms=())
        map_obj = Map.objects.create(name="No Access Test Map", owner=owner)
        return map_obj.id

    @staticmethod
    def _session_cookie_for(username: str) -> str:
        client = Client()
        assert client.login(username=username, password="test-password")
        return client.cookies["sessionid"].value
