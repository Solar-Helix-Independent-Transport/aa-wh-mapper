"""Tests for wh_mapper.api.flags - suggested connection status changes"""

# Standard Library
import json

# Django
from django.test import TestCase

# AA WH Mapper App
from wh_mapper.models import ConnectionFlag, Map, MapSystem, WormholeConnection
from wh_mapper.tests.factories import make_solar_system, make_user_with_character


class TestConnectionFlagApi(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alice = make_user_with_character("flag_alice", 300401)
        cls.bob = make_user_with_character("flag_bob", 300402)
        cls.jita = make_solar_system("Jita")
        cls.amarr = make_solar_system("Amarr")

        cls.wh_map = Map.objects.create(name="Alice's Map", owner=cls.alice)
        top = MapSystem.objects.create(map=cls.wh_map, solar_system=cls.jita)
        bottom = MapSystem.objects.create(map=cls.wh_map, solar_system=cls.amarr)
        cls.connection = WormholeConnection.objects.create(
            map=cls.wh_map,
            connection_type=WormholeConnection.ConnectionType.WORMHOLE,
            top_system=top,
            bottom_system=bottom,
            life_status="stable",
            mass_status=WormholeConnection.MassStatus.FRESH,
        )

    def test_user_without_map_access_can_still_create_a_flag(self):
        self.client.login(username="flag_bob", password="test-password")

        response = self.client.post(
            f"/wh-mapper/api/connections/{self.connection.id}/flag/",
            data=json.dumps({"suggested_mass_status": "critical"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(ConnectionFlag.objects.filter(flagged_by=self.bob).count(), 1)

    def test_reflagging_upserts_rather_than_duplicating(self):
        self.client.login(username="flag_bob", password="test-password")

        self.client.post(
            f"/wh-mapper/api/connections/{self.connection.id}/flag/",
            data=json.dumps({"suggested_mass_status": "reduced"}),
            content_type="application/json",
        )
        self.client.post(
            f"/wh-mapper/api/connections/{self.connection.id}/flag/",
            data=json.dumps({"suggested_mass_status": "critical"}),
            content_type="application/json",
        )

        flags = ConnectionFlag.objects.filter(flagged_by=self.bob)
        self.assertEqual(flags.count(), 1)
        self.assertEqual(flags.first().suggested_mass_status, "critical")

    def test_list_flags(self):
        ConnectionFlag.objects.create(
            connection=self.connection, flagged_by=self.bob, suggested_mass_status="critical"
        )
        self.client.login(username="flag_alice", password="test-password")

        response = self.client.get(f"/wh-mapper/api/connections/{self.connection.id}/flags/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 1)

    def test_accept_mass_status_suggestion_applies_it_and_deletes_flag(self):
        flag = ConnectionFlag.objects.create(
            connection=self.connection, flagged_by=self.bob, suggested_mass_status="critical"
        )
        self.client.login(username="flag_alice", password="test-password")

        response = self.client.post(
            f"/wh-mapper/api/maps/{self.wh_map.id}/connections/"
            f"{self.connection.id}/flags/{flag.id}/accept/"
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertFalse(body["deleted"])
        self.assertEqual(body["connection"]["mass_status"], "critical")
        self.connection.refresh_from_db()
        self.assertEqual(self.connection.mass_status, "critical")
        self.assertFalse(ConnectionFlag.objects.filter(pk=flag.id).exists())

    def test_accept_collapsed_suggestion_deletes_connection_and_flag(self):
        flag = ConnectionFlag.objects.create(
            connection=self.connection, flagged_by=self.bob, suggests_collapsed=True
        )
        self.client.login(username="flag_alice", password="test-password")

        response = self.client.post(
            f"/wh-mapper/api/maps/{self.wh_map.id}/connections/"
            f"{self.connection.id}/flags/{flag.id}/accept/"
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["deleted"])
        self.assertIsNone(body["connection"])
        self.assertFalse(WormholeConnection.objects.filter(pk=self.connection.id).exists())
        self.assertFalse(ConnectionFlag.objects.filter(pk=flag.id).exists())

    def test_dismiss_deletes_flag_without_changing_connection(self):
        flag = ConnectionFlag.objects.create(
            connection=self.connection, flagged_by=self.bob, suggested_mass_status="critical"
        )
        self.client.login(username="flag_alice", password="test-password")

        response = self.client.delete(
            f"/wh-mapper/api/maps/{self.wh_map.id}/connections/"
            f"{self.connection.id}/flags/{flag.id}/"
        )

        self.assertEqual(response.status_code, 204)
        self.assertFalse(ConnectionFlag.objects.filter(pk=flag.id).exists())
        self.connection.refresh_from_db()
        self.assertEqual(self.connection.mass_status, WormholeConnection.MassStatus.FRESH)

    def test_accept_requires_map_access(self):
        flag = ConnectionFlag.objects.create(
            connection=self.connection, flagged_by=self.bob, suggested_mass_status="critical"
        )
        self.client.login(username="flag_bob", password="test-password")

        response = self.client.post(
            f"/wh-mapper/api/maps/{self.wh_map.id}/connections/"
            f"{self.connection.id}/flags/{flag.id}/accept/"
        )

        self.assertEqual(response.status_code, 404)
