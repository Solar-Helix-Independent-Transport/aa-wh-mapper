"""Tests for wh_mapper.api.route's shared/live Route endpoints and the
recompute_routes_for_map/prune_stale_routes Celery tasks."""

# Standard Library
import json
from datetime import timedelta
from unittest.mock import patch

# Django
from django.test import TestCase
from django.utils import timezone

# AA WH Mapper App
from wh_mapper.models import Map, MapSystem, Route, Signature, WormholeConnection
from wh_mapper.tasks import prune_stale_routes, recompute_routes_for_map
from wh_mapper.tests.factories import (
    make_solar_system,
    make_stargate,
    make_user_with_character,
)


class TestSharedRouteApi(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alice = make_user_with_character("shared_alice", 300101)
        cls.bob = make_user_with_character("shared_bob", 300102)
        cls.jita = make_solar_system("Jita")
        cls.amarr = make_solar_system("Amarr")
        make_stargate(cls.jita, cls.amarr)
        make_stargate(cls.amarr, cls.jita)

    def setUp(self):
        self.client.login(username="shared_alice", password="test-password")

    def test_share_route_creates_and_computes(self):
        response = self.client.post(
            "/wh-mapper/api/route/shared/",
            data=json.dumps({"start_id": self.jita.id, "end_id": self.amarr.id}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["found"])
        self.assertEqual(body["visibility"], "shared")
        self.assertTrue(body["is_owner"])
        self.assertEqual(len(body["systems"]), 2)

    def test_private_route_hidden_from_other_users(self):
        route = Route.objects.create(
            owner=self.alice,
            start_system=self.jita,
            end_system=self.amarr,
            visibility=Route.Visibility.PRIVATE,
        )
        self.client.logout()
        self.client.login(username="shared_bob", password="test-password")

        response = self.client.get(f"/wh-mapper/api/route/shared/{route.id}/")

        self.assertEqual(response.status_code, 404)

    def test_shared_route_visible_to_other_users(self):
        route = Route.objects.create(
            owner=self.alice,
            start_system=self.jita,
            end_system=self.amarr,
            visibility=Route.Visibility.SHARED,
        )
        self.client.logout()
        self.client.login(username="shared_bob", password="test-password")

        response = self.client.get(f"/wh-mapper/api/route/shared/{route.id}/")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertFalse(body["is_owner"])

    def test_get_shared_route_bumps_last_viewed_at(self):
        route = Route.objects.create(
            owner=self.alice,
            start_system=self.jita,
            end_system=self.amarr,
            visibility=Route.Visibility.SHARED,
        )
        original_last_viewed = route.last_viewed_at

        self.client.get(f"/wh-mapper/api/route/shared/{route.id}/")

        route.refresh_from_db()
        self.assertGreater(route.last_viewed_at, original_last_viewed)

    def test_only_owner_can_delete(self):
        route = Route.objects.create(
            owner=self.alice,
            start_system=self.jita,
            end_system=self.amarr,
            visibility=Route.Visibility.SHARED,
        )
        self.client.logout()
        self.client.login(username="shared_bob", password="test-password")

        response = self.client.delete(f"/wh-mapper/api/route/shared/{route.id}/")

        self.assertEqual(response.status_code, 403)
        self.assertTrue(Route.objects.filter(pk=route.id).exists())

    def test_owner_can_delete(self):
        route = Route.objects.create(
            owner=self.alice,
            start_system=self.jita,
            end_system=self.amarr,
            visibility=Route.Visibility.SHARED,
        )

        response = self.client.delete(f"/wh-mapper/api/route/shared/{route.id}/")

        self.assertEqual(response.status_code, 204)
        self.assertFalse(Route.objects.filter(pk=route.id).exists())


class TestRecomputeRoutesForMap(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alice = make_user_with_character("recompute_alice", 300201)
        cls.jita = make_solar_system("Jita")
        cls.amarr = make_solar_system("Amarr")
        cls.dodixie = make_solar_system("Dodixie")

    def test_recompute_updates_route_when_a_new_connection_appears(self):
        wh_map = Map.objects.create(name="Test Map", owner=self.alice)
        route = Route.objects.create(
            owner=self.alice,
            start_system=self.jita,
            end_system=self.amarr,
            visibility=Route.Visibility.SHARED,
        )
        self.assertFalse(route.found)

        map_system_jita = MapSystem.objects.create(map=wh_map, solar_system=self.jita)
        map_system_amarr = MapSystem.objects.create(map=wh_map, solar_system=self.amarr)
        WormholeConnection.objects.create(
            map=wh_map,
            connection_type=WormholeConnection.ConnectionType.WORMHOLE,
            top_system=map_system_jita,
            bottom_system=map_system_amarr,
            mass_status=WormholeConnection.MassStatus.FRESH,
        )

        changed_count = recompute_routes_for_map(wh_map.id)

        self.assertEqual(changed_count, 1)
        route.refresh_from_db()
        self.assertTrue(route.found)

    def test_route_owned_by_user_without_map_access_is_not_recomputed(self):
        bob = make_user_with_character("recompute_bob", 300202)
        wh_map = Map.objects.create(name="Bob's Map", owner=bob)
        route = Route.objects.create(
            owner=self.alice,
            start_system=self.jita,
            end_system=self.dodixie,
            visibility=Route.Visibility.SHARED,
        )

        changed_count = recompute_routes_for_map(wh_map.id)

        self.assertEqual(changed_count, 0)
        route.refresh_from_db()
        self.assertIsNone(route.last_computed_at)


class TestPruneStaleRoutes(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alice = make_user_with_character("prune_alice", 300301)
        cls.jita = make_solar_system("Jita")
        cls.amarr = make_solar_system("Amarr")

    def test_prunes_routes_past_the_stale_cutoff(self):
        stale_route = Route.objects.create(
            owner=self.alice,
            start_system=self.jita,
            end_system=self.amarr,
            visibility=Route.Visibility.SHARED,
        )
        Route.objects.filter(pk=stale_route.id).update(
            last_viewed_at=timezone.now() - timedelta(hours=49)
        )
        fresh_route = Route.objects.create(
            owner=self.alice,
            start_system=self.jita,
            end_system=self.amarr,
            visibility=Route.Visibility.SHARED,
        )

        pruned_count = prune_stale_routes()

        self.assertEqual(pruned_count, 1)
        self.assertFalse(Route.objects.filter(pk=stale_route.id).exists())
        self.assertTrue(Route.objects.filter(pk=fresh_route.id).exists())


class TestSignatureChangesPropagateToRoutes(TestCase):
    """Attaching/changing/removing a signature never touches routing
    weight, but it does change what a route leg shows for that connection
    (WormholeConnectionOut.top_signature/bottom_signature, and time_status
    once a wormhole type is identified) - see the wayfinder map's ticket 08
    recompute-trigger convention, extended to signature mutations.

    `.delay()` isn't actually eager in this test environment (no
    CELERY_TASK_ALWAYS_EAGER configured - the pre-existing recompute tests
    above call recompute_routes_for_map directly for that reason), so these
    verify the endpoints correctly *enqueue* the task rather than trying to
    observe its effect end-to-end.
    """

    @classmethod
    def setUpTestData(cls):
        cls.alice = make_user_with_character("sigrecompute_alice", 300601)
        cls.jita = make_solar_system("Jita")
        cls.amarr = make_solar_system("Amarr")

    def setUp(self):
        self.client.login(username="sigrecompute_alice", password="test-password")
        self.wh_map = Map.objects.create(name="Test Map", owner=self.alice)
        self.top = MapSystem.objects.create(map=self.wh_map, solar_system=self.jita)
        self.bottom = MapSystem.objects.create(map=self.wh_map, solar_system=self.amarr)
        self.connection = WormholeConnection.objects.create(
            map=self.wh_map,
            connection_type=WormholeConnection.ConnectionType.WORMHOLE,
            top_system=self.top,
            bottom_system=self.bottom,
        )

    def test_linking_a_signature_to_a_connection_enqueues_recompute(self):
        signature = Signature.objects.create(
            map_system=self.top,
            signature_id="ABC-123",
            sig_type=Signature.SignatureType.WORMHOLE,
        )

        with patch("wh_mapper.tasks.recompute_routes_for_map.delay") as mock_delay:
            response = self.client.post(
                f"/wh-mapper/api/maps/{self.wh_map.id}/connections/"
                f"{self.connection.id}/signature/",
                data=json.dumps({"signature_id": signature.id}),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        mock_delay.assert_called_once_with(self.wh_map.id)

    def test_updating_a_signature_enqueues_recompute(self):
        signature = Signature.objects.create(
            map_system=self.top,
            signature_id="ABC-123",
            sig_type=Signature.SignatureType.WORMHOLE,
        )

        with patch("wh_mapper.tasks.recompute_routes_for_map.delay") as mock_delay:
            response = self.client.patch(
                f"/wh-mapper/api/maps/{self.wh_map.id}/systems/{self.top.id}/"
                f"signatures/{signature.id}/",
                data=json.dumps({"life_status": "lt_4h"}),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        mock_delay.assert_called_once_with(self.wh_map.id)

    def test_removing_a_signature_enqueues_recompute(self):
        signature = Signature.objects.create(
            map_system=self.top,
            signature_id="ABC-123",
            sig_type=Signature.SignatureType.WORMHOLE,
        )

        with patch("wh_mapper.tasks.recompute_routes_for_map.delay") as mock_delay:
            response = self.client.delete(
                f"/wh-mapper/api/maps/{self.wh_map.id}/systems/{self.top.id}/"
                f"signatures/{signature.id}/"
            )

        self.assertEqual(response.status_code, 204)
        mock_delay.assert_called_once_with(self.wh_map.id)

    def test_bulk_upserting_signatures_enqueues_recompute(self):
        with patch("wh_mapper.tasks.recompute_routes_for_map.delay") as mock_delay:
            response = self.client.post(
                f"/wh-mapper/api/maps/{self.wh_map.id}/systems/{self.top.id}/"
                f"signatures/bulk/",
                data=json.dumps({"rows": [], "lazy_delete": False}),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        mock_delay.assert_called_once_with(self.wh_map.id)
