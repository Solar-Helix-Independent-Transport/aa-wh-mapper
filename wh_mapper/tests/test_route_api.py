"""Tests for wh_mapper.api.route - the on-demand GET /route/ endpoint"""

# Django
from django.test import TestCase

# AA WH Mapper App
from wh_mapper.models import Map, MapSystem, Signature, WormholeConnection
from wh_mapper.tests.factories import (
    make_solar_system,
    make_stargate,
    make_user_with_character,
)


class TestRouteApi(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alice = make_user_with_character("route_alice", 300001)
        cls.no_perm_user = make_user_with_character("route_noperm", 300002, perms=())
        cls.jita = make_solar_system("Jita")
        cls.amarr = make_solar_system("Amarr")

    def setUp(self):
        self.client.login(username="route_alice", password="test-password")

    def test_permission_required(self):
        self.client.logout()
        self.client.login(username="route_noperm", password="test-password")
        response = self.client.get(
            f"/wh-mapper/api/route/?start_id={self.jita.id}&end_id={self.amarr.id}"
        )
        self.assertEqual(response.status_code, 403)

    def test_no_route_found(self):
        response = self.client.get(
            f"/wh-mapper/api/route/?start_id={self.jita.id}&end_id={self.amarr.id}"
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertFalse(body["found"])
        self.assertIsNone(body["route"])
        self.assertIn("No route found", body["message"])

    def test_direct_stargate_route(self):
        make_stargate(self.jita, self.amarr)
        make_stargate(self.amarr, self.jita)

        response = self.client.get(
            f"/wh-mapper/api/route/?start_id={self.jita.id}&end_id={self.amarr.id}"
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["found"])
        self.assertEqual(
            [s["id"] for s in body["route"]["systems"]], [self.jita.id, self.amarr.id]
        )
        self.assertEqual(len(body["route"]["legs"]), 1)
        leg = body["route"]["legs"][0]
        self.assertEqual(leg["connection_type"], "stargate")
        self.assertIsNone(leg["map_id"])
        self.assertIsNone(leg["connection_id"])

    def test_wormhole_leg_carries_the_same_detail_the_map_view_shows(self):
        wh_map = Map.objects.create(name="Test Map", owner=self.alice)
        top = MapSystem.objects.create(map=wh_map, solar_system=self.jita)
        bottom = MapSystem.objects.create(map=wh_map, solar_system=self.amarr)
        connection = WormholeConnection.objects.create(
            map=wh_map,
            connection_type=WormholeConnection.ConnectionType.WORMHOLE,
            top_system=top,
            bottom_system=bottom,
            mass_status=WormholeConnection.MassStatus.REDUCED,
            ship_size_limit=WormholeConnection.ShipSize.MEDIUM,
        )

        response = self.client.get(
            f"/wh-mapper/api/route/?start_id={self.jita.id}&end_id={self.amarr.id}"
        )

        self.assertEqual(response.status_code, 200)
        leg = response.json()["route"]["legs"][0]
        self.assertIsNotNone(leg["connection"])
        self.assertEqual(leg["connection"]["id"], connection.id)
        self.assertEqual(leg["connection"]["ship_size_limit"], "medium")
        self.assertEqual(leg["connection"]["mass_status"], "reduced")
        self.assertIn("time_status", leg["connection"])
        self.assertIn("top_signature_id", leg["connection"])
        # top_system_id/bottom_system_id are MapSystem ids (top.id/bottom.id
        # here), not the SolarSystem ids RouteDetail.systems[].id uses (the
        # frontend needs the latter to orient which end's signature goes
        # where - see RouteDiagram.tsx's traversesTopToBottom).
        self.assertEqual(leg["connection"]["top_system_id"], top.id)
        self.assertEqual(leg["connection"]["bottom_system_id"], bottom.id)
        self.assertEqual(
            leg["connection"]["top_system_solar_system_id"], self.jita.id
        )
        self.assertEqual(
            leg["connection"]["bottom_system_solar_system_id"], self.amarr.id
        )

    def test_wormhole_leg_carries_signature_detail(self):
        wh_map = Map.objects.create(name="Test Map", owner=self.alice)
        top = MapSystem.objects.create(map=wh_map, solar_system=self.jita)
        bottom = MapSystem.objects.create(map=wh_map, solar_system=self.amarr)
        signature = Signature.objects.create(
            map_system=top,
            signature_id="ABC-123",
            sig_type=Signature.SignatureType.WORMHOLE,
        )
        WormholeConnection.objects.create(
            map=wh_map,
            connection_type=WormholeConnection.ConnectionType.WORMHOLE,
            top_system=top,
            bottom_system=bottom,
            top_signature=signature,
        )

        response = self.client.get(
            f"/wh-mapper/api/route/?start_id={self.jita.id}&end_id={self.amarr.id}"
        )

        leg = response.json()["route"]["legs"][0]
        self.assertIsNotNone(leg["connection"]["top_signature"])
        self.assertEqual(leg["connection"]["top_signature"]["signature_id"], "ABC-123")
        self.assertIsNone(leg["connection"]["bottom_signature"])

    def test_stargate_leg_has_no_connection_detail(self):
        make_stargate(self.jita, self.amarr)
        make_stargate(self.amarr, self.jita)

        response = self.client.get(
            f"/wh-mapper/api/route/?start_id={self.jita.id}&end_id={self.amarr.id}"
        )

        leg = response.json()["route"]["legs"][0]
        self.assertIsNone(leg["connection"])

    def test_start_equals_end(self):
        response = self.client.get(
            f"/wh-mapper/api/route/?start_id={self.jita.id}&end_id={self.jita.id}"
        )
        body = response.json()
        self.assertTrue(body["found"])
        self.assertEqual([s["id"] for s in body["route"]["systems"]], [self.jita.id])
        self.assertEqual(body["route"]["legs"], [])
        self.assertIsNone(body["alternate"])

    def test_alternate_surfaces_a_shorter_riskier_route(self):
        kvn = make_solar_system("KVN-36")
        make_stargate(self.jita, kvn)
        make_stargate(kvn, self.jita)
        make_stargate(kvn, self.amarr)
        make_stargate(self.amarr, kvn)

        wh_map = Map.objects.create(name="Test Map", owner=self.alice)
        top = MapSystem.objects.create(map=wh_map, solar_system=self.jita)
        bottom = MapSystem.objects.create(map=wh_map, solar_system=self.amarr)
        WormholeConnection.objects.create(
            map=wh_map,
            connection_type=WormholeConnection.ConnectionType.WORMHOLE,
            top_system=top,
            bottom_system=bottom,
            life_status="lt_1h",
            mass_status=WormholeConnection.MassStatus.CRITICAL,
        )

        response = self.client.get(
            f"/wh-mapper/api/route/?start_id={self.jita.id}&end_id={self.amarr.id}"
        )

        body = response.json()
        self.assertEqual(
            [s["id"] for s in body["route"]["systems"]], [self.jita.id, kvn.id, self.amarr.id]
        )
        self.assertIsNotNone(body["alternate"])
        self.assertEqual(
            [s["id"] for s in body["alternate"]["systems"]], [self.jita.id, self.amarr.id]
        )
        self.assertEqual(body["alternate"]["legs"][0]["connection_type"], "wormhole")
