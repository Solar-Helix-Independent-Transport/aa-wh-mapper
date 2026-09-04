"""Tests for the wh_mapper django-ninja API"""

# Standard Library
import json

# Third Party
# Django EvE SDE
from eve_sde.models import (
    Constellation,
    ItemCategory,
    ItemGroup,
    ItemType,
    Region,
    SolarSystem,
)

# Django
from django.contrib.auth.models import Group
from django.test import TestCase

# Alliance Auth
from allianceauth.eveonline.models import (
    EveAllianceInfo,
    EveCorporationInfo,
    EveFactionInfo,
)

# AA WH Mapper App
from wh_mapper.constants import LOCATION_SCOPES
from wh_mapper.models import (
    Map,
    MapContribution,
    MapPresence,
    MapSystem,
    Signature,
    TrackedCharacter,
    WormholeConnection,
    WormholeType,
)
from wh_mapper.tests.factories import (
    make_esi_location_token,
    make_solar_system,
    make_stargate,
    make_user_with_character,
)


def make_wormhole_type(code: str, max_stable_time: float = 1600) -> None:
    """Seed a minimal Wormhole ItemType + dogma so wh_mapper_derive_wormhole_types
    (or a direct create, here) resolves via Signature.wormhole_type.
    """

    category = ItemCategory.objects.create(id=hash(code) % 100000 + 1, name="Celestial")
    group, _ = ItemGroup.objects.get_or_create(
        id=988, defaults={"name": "Wormhole", "category": category}
    )
    item_type = ItemType.objects.create(
        id=hash(code) % 1000000 + 30000000, name=f"Wormhole {code}", group=group
    )
    return WormholeType.objects.create(item_type=item_type, code=code, max_stable_time=max_stable_time)


class TestMapApi(TestCase):
    """TestMapApi"""

    @classmethod
    def setUpTestData(cls):
        cls.alice = make_user_with_character("api_alice", 200001)
        cls.bob = make_user_with_character("api_bob", 200002)
        cls.no_perm_user = make_user_with_character(
            "api_noperm", 200003, perms=()
        )
        cls.jita = make_solar_system("Jita", security_status=0.9)
        cls.j_system = make_solar_system(
            "J123456", id=31000001, security_status=-1.0, wormhole_class_id_raw=3
        )
        cls.amarr = make_solar_system("Amarr", security_status=0.9)

    def setUp(self):
        self.client.login(username="api_alice", password="test-password")

    def test_permission_required(self):
        self.client.logout()
        self.client.login(username="api_noperm", password="test-password")
        response = self.client.get("/wh-mapper/api/maps/")
        self.assertEqual(response.status_code, 403)

    def test_create_and_list_map(self):
        response = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "My Map", "visibility": "private"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        map_id = response.json()["id"]

        response = self.client.get("/wh-mapper/api/maps/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([m["id"] for m in response.json()], [map_id])

    def test_owner_name_uses_main_character_not_username(self):
        self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "My Map", "visibility": "private"}),
            content_type="application/json",
        )

        response = self.client.get("/wh-mapper/api/maps/")
        owner_names = [m["owner_name"] for m in response.json()]
        self.assertIn(self.alice.profile.main_character.character_name, owner_names)
        self.assertNotIn(self.alice.username, owner_names)

    def test_private_map_hidden_from_other_users(self):
        map_obj = Map.objects.create(name="Alice Only", owner=self.alice)

        self.client.logout()
        self.client.login(username="api_bob", password="test-password")
        response = self.client.get(f"/wh-mapper/api/maps/{map_obj.id}/")
        self.assertEqual(response.status_code, 404)

    def test_full_golden_path(self):
        make_wormhole_type("K162")

        response = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Chain"}),
            content_type="application/json",
        )
        map_id = response.json()["id"]

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.jita.id}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        top_system_id = response.json()["id"]

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.j_system.id}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        bottom_system_id = response.json()["id"]

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/{bottom_system_id}/signatures/",
            data=json.dumps(
                {
                    "signature_id": "ABC-123",
                    "sig_type": "wormhole",
                    "wormhole_type_code": "k162",
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["wormhole_type"]["code"], "K162")

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/",
            data=json.dumps(
                {"top_system_id": top_system_id, "bottom_system_id": bottom_system_id}
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        connection_id = response.json()["id"]
        self.assertEqual(response.json()["connection_type"], "wormhole")

        response = self.client.patch(
            f"/wh-mapper/api/maps/{map_id}/connections/{connection_id}/",
            data=json.dumps({"connection_type": "ansiblex"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["connection_type"], "ansiblex")

        response = self.client.get(f"/wh-mapper/api/maps/{map_id}/state/")
        self.assertEqual(response.status_code, 200)
        state = response.json()
        self.assertEqual(len(state["systems"]), 2)
        self.assertEqual(len(state["signatures"]), 1)
        self.assertEqual(len(state["connections"]), 1)
        self.assertEqual(state["current_user_id"], self.alice.id)

        by_name = {s["solar_system"]["name"]: s["solar_system"] for s in state["systems"]}
        self.assertEqual(by_name["Jita"]["space_type"], "High Sec")
        self.assertEqual(by_name["Jita"]["constellation_name"], "Jita Constellation")
        self.assertEqual(by_name["Jita"]["region_name"], "Jita Region")
        self.assertEqual(by_name["J123456"]["space_type"], "Wormhole")

    def test_update_connection_life_status_bucket_always_sets_marked_at(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "EOL Connection Map"}),
            content_type="application/json",
        ).json()["id"]
        top_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.jita.id}),
            content_type="application/json",
        ).json()["id"]
        bottom_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.j_system.id}),
            content_type="application/json",
        ).json()["id"]
        connection_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/",
            data=json.dumps({"top_system_id": top_id, "bottom_system_id": bottom_id}),
            content_type="application/json",
        ).json()["id"]

        response = self.client.patch(
            f"/wh-mapper/api/maps/{map_id}/connections/{connection_id}/",
            data=json.dumps({"life_status": "lt_4h"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["life_status"], "lt_4h")
        self.assertIsNotNone(body["life_status_marked_at"])

        response = self.client.patch(
            f"/wh-mapper/api/maps/{map_id}/connections/{connection_id}/",
            data=json.dumps({"life_status": "stable"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["life_status"], "stable")
        # Stable is stamped too (not cleared) - it counts down from
        # UNKNOWN_STABLE_MAX_HOURS like any other bucket rather than
        # sitting frozen forever - see apply_life_status.
        self.assertIsNotNone(body["life_status_marked_at"])

    def test_wormhole_connection_lifecycle_records_contributions(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Contribution Map"}),
            content_type="application/json",
        ).json()["id"]
        top_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.jita.id}),
            content_type="application/json",
        ).json()["id"]
        bottom_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.j_system.id}),
            content_type="application/json",
        ).json()["id"]

        connection_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/",
            data=json.dumps({"top_system_id": top_id, "bottom_system_id": bottom_id}),
            content_type="application/json",
        ).json()["id"]

        self.assertEqual(
            list(
                MapContribution.objects.filter(connection_id=connection_id).values_list(
                    "verb", "character_id"
                )
            ),
            [(MapContribution.Verb.ADDED, self.alice.profile.main_character_id)],
        )

        self.client.patch(
            f"/wh-mapper/api/maps/{map_id}/connections/{connection_id}/",
            data=json.dumps({"mass_status": "reduced"}),
            content_type="application/json",
        )

        self.assertEqual(
            list(
                MapContribution.objects.filter(connection_id=connection_id).order_by(
                    "id"
                ).values_list("verb", flat=True)
            ),
            [MapContribution.Verb.ADDED, MapContribution.Verb.UPDATED],
        )

    def test_stargate_connections_are_never_credited_as_contributions(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Stargate Contribution Map"}),
            content_type="application/json",
        ).json()["id"]
        top_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.jita.id}),
            content_type="application/json",
        ).json()["id"]
        bottom_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.amarr.id}),
            content_type="application/json",
        ).json()["id"]

        self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/",
            data=json.dumps(
                {
                    "top_system_id": top_id,
                    "bottom_system_id": bottom_id,
                    "connection_type": "stargate",
                }
            ),
            content_type="application/json",
        )

        self.assertFalse(MapContribution.objects.exists())

    def test_connection_details_returns_creator_name_and_contribution_history(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Details Map"}),
            content_type="application/json",
        ).json()["id"]
        top_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.jita.id}),
            content_type="application/json",
        ).json()["id"]
        bottom_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.j_system.id}),
            content_type="application/json",
        ).json()["id"]
        connection_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/",
            data=json.dumps({"top_system_id": top_id, "bottom_system_id": bottom_id}),
            content_type="application/json",
        ).json()["id"]
        self.client.patch(
            f"/wh-mapper/api/maps/{map_id}/connections/{connection_id}/",
            data=json.dumps({"mass_status": "reduced"}),
            content_type="application/json",
        )

        response = self.client.get(
            f"/wh-mapper/api/maps/{map_id}/connections/{connection_id}/details/"
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["created_by_name"], self.alice.profile.main_character.character_name)
        self.assertEqual(
            [c["verb"] for c in body["contributions"]],
            ["updated", "added"],
        )
        self.assertTrue(
            all(c["name"] == self.alice.profile.main_character.character_name for c in body["contributions"])
        )

    def test_connection_details_permission_required(self):
        self.client.logout()
        self.client.login(username="api_noperm", password="test-password")

        response = self.client.get(
            f"/wh-mapper/api/maps/1/connections/1/details/"
        )

        self.assertEqual(response.status_code, 403)

    def test_update_signature_life_status_bucket_always_sets_marked_at(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "EOL Signature Map"}),
            content_type="application/json",
        ).json()["id"]
        system_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.j_system.id}),
            content_type="application/json",
        ).json()["id"]
        signature_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/{system_id}/signatures/",
            data=json.dumps({"signature_id": "ABC-123", "sig_type": "wormhole"}),
            content_type="application/json",
        ).json()["id"]

        response = self.client.patch(
            f"/wh-mapper/api/maps/{map_id}/systems/{system_id}/signatures/{signature_id}/",
            data=json.dumps({"life_status": "lt_4h"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["life_status"], "lt_4h")
        self.assertIsNotNone(body["life_status_marked_at"])

        response = self.client.patch(
            f"/wh-mapper/api/maps/{map_id}/systems/{system_id}/signatures/{signature_id}/",
            data=json.dumps({"life_status": "stable"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["life_status"], "stable")
        # Stable is stamped too (not cleared) - see apply_life_status.
        self.assertIsNotNone(body["life_status_marked_at"])

    def test_signature_created_directly_with_bucket_sets_marked_at(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "EOL At Creation Map"}),
            content_type="application/json",
        ).json()["id"]
        system_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.j_system.id}),
            content_type="application/json",
        ).json()["id"]

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/{system_id}/signatures/",
            data=json.dumps(
                {"signature_id": "ABC-123", "sig_type": "wormhole", "life_status": "lt_4h"}
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["life_status"], "lt_4h")
        self.assertIsNotNone(body["life_status_marked_at"])

    def test_pinned_system_cannot_be_removed_until_unlocked(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Home Base Map"}),
            content_type="application/json",
        ).json()["id"]
        system_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.jita.id, "pinned": True}),
            content_type="application/json",
        ).json()["id"]

        response = self.client.delete(f"/wh-mapper/api/maps/{map_id}/systems/{system_id}/")
        self.assertEqual(response.status_code, 400)
        self.assertTrue(
            MapSystem.objects.filter(pk=system_id).exists(), "pinned system should not be deleted"
        )

        response = self.client.patch(
            f"/wh-mapper/api/maps/{map_id}/systems/{system_id}/",
            data=json.dumps({"pinned": False}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["pinned"])

        response = self.client.delete(f"/wh-mapper/api/maps/{map_id}/systems/{system_id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(MapSystem.objects.filter(pk=system_id).exists())

    def test_auto_layout_updates_unpinned_systems_and_skips_pinned(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Layout Map"}),
            content_type="application/json",
        ).json()["id"]
        movable_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.jita.id, "x": 0, "y": 0}),
            content_type="application/json",
        ).json()["id"]
        pinned_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps(
                {"solar_system_id": self.amarr.id, "x": 300, "y": 300, "pinned": True}
            ),
            content_type="application/json",
        ).json()["id"]

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/auto-layout/",
            data=json.dumps(
                {
                    "positions": [
                        {"id": movable_id, "x": 111, "y": 222},
                        # A stale position for the pinned system - must be
                        # ignored server-side, not just trusted to have been
                        # excluded by the client.
                        {"id": pinned_id, "x": 999, "y": 999},
                    ]
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["updated"], 1)

        movable = MapSystem.objects.get(pk=movable_id)
        self.assertEqual(movable.x, 111)
        self.assertEqual(movable.y, 222)

        pinned = MapSystem.objects.get(pk=pinned_id)
        self.assertEqual(pinned.x, 300)
        self.assertEqual(pinned.y, 300)

    def test_auto_layout_ignores_a_system_id_from_another_map(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Layout Map A"}),
            content_type="application/json",
        ).json()["id"]
        other_map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Layout Map B"}),
            content_type="application/json",
        ).json()["id"]
        other_system_id = self.client.post(
            f"/wh-mapper/api/maps/{other_map_id}/systems/",
            data=json.dumps({"solar_system_id": self.jita.id}),
            content_type="application/json",
        ).json()["id"]

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/auto-layout/",
            data=json.dumps({"positions": [{"id": other_system_id, "x": 1, "y": 1}]}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["updated"], 0)
        other_system = MapSystem.objects.get(pk=other_system_id)
        self.assertEqual(other_system.x, 0)
        self.assertEqual(other_system.y, 0)

    def test_system_details_returns_placer_name(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "System Details Map"}),
            content_type="application/json",
        ).json()["id"]
        system_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.jita.id}),
            content_type="application/json",
        ).json()["id"]

        response = self.client.get(
            f"/wh-mapper/api/maps/{map_id}/systems/{system_id}/details/"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["added_by_name"], self.alice.profile.main_character.character_name
        )

    def test_system_details_permission_required(self):
        self.client.logout()
        self.client.login(username="api_noperm", password="test-password")

        response = self.client.get("/wh-mapper/api/maps/1/systems/1/details/")

        self.assertEqual(response.status_code, 403)

    def test_map_state_includes_system_owner(self):
        EveFactionInfo.objects.create(faction_id=500011, faction_name="Caldari State")
        empire_system = make_solar_system(
            "Owned Empire System", security_status=0.9, faction_id_raw=500011
        )

        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Ownership Map"}),
            content_type="application/json",
        ).json()["id"]
        self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": empire_system.id}),
            content_type="application/json",
        )
        self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.j_system.id}),
            content_type="application/json",
        )

        state = self.client.get(f"/wh-mapper/api/maps/{map_id}/state/").json()
        by_name = {s["solar_system"]["name"]: s["solar_system"] for s in state["systems"]}

        self.assertEqual(
            by_name["Owned Empire System"]["owner"],
            {
                "type": "faction",
                "id": 500011,
                "name": "Caldari State",
                "ticker": None,
                "icon_url": EveFactionInfo.objects.get(faction_id=500011).logo_url_64,
            },
        )
        self.assertIsNone(by_name["J123456"]["owner"])

    def test_stargate_connection_can_be_created_directly(self):
        response = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Gate Map"}),
            content_type="application/json",
        )
        map_id = response.json()["id"]

        top_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.jita.id}),
            content_type="application/json",
        ).json()["id"]
        bottom_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.j_system.id}),
            content_type="application/json",
        ).json()["id"]

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/",
            data=json.dumps(
                {
                    "top_system_id": top_id,
                    "bottom_system_id": bottom_id,
                    "connection_type": "stargate",
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["connection_type"], "stargate")

    def test_adding_a_duplicate_stargate_connection_reuses_the_existing_one(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Duplicate Connection Map"}),
            content_type="application/json",
        ).json()["id"]

        top_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.jita.id}),
            content_type="application/json",
        ).json()["id"]
        bottom_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.j_system.id}),
            content_type="application/json",
        ).json()["id"]

        first = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/",
            data=json.dumps(
                {
                    "top_system_id": top_id,
                    "bottom_system_id": bottom_id,
                    "connection_type": "stargate",
                }
            ),
            content_type="application/json",
        ).json()

        # Same pair, opposite order - must resolve to the same row rather
        # than slip past as a distinct (bottom, top) edge. A real stargate
        # pairing is fixed and singular in-game, so stargate connections
        # stay deduplicated (unlike wormholes - see
        # test_adding_a_duplicate_wormhole_connection_creates_a_second_one).
        second = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/",
            data=json.dumps(
                {
                    "top_system_id": bottom_id,
                    "bottom_system_id": top_id,
                    "connection_type": "stargate",
                }
            ),
            content_type="application/json",
        ).json()

        self.assertEqual(first["id"], second["id"])
        self.assertEqual(WormholeConnection.objects.filter(map_id=map_id).count(), 1)

    def test_adding_a_duplicate_wormhole_connection_creates_a_second_one(self):
        # Two separate wormholes really can connect the same pair of
        # systems in-game, so manual wormhole connects (the default
        # connection_type) are never deduplicated against each other.
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Duplicate Wormhole Map"}),
            content_type="application/json",
        ).json()["id"]

        top_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.jita.id}),
            content_type="application/json",
        ).json()["id"]
        bottom_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.j_system.id}),
            content_type="application/json",
        ).json()["id"]

        first = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/",
            data=json.dumps({"top_system_id": top_id, "bottom_system_id": bottom_id}),
            content_type="application/json",
        ).json()
        second = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/",
            data=json.dumps({"top_system_id": bottom_id, "bottom_system_id": top_id}),
            content_type="application/json",
        ).json()

        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(WormholeConnection.objects.filter(map_id=map_id).count(), 2)

    def test_bulk_upsert_signatures_creates_then_updates_by_signature_id(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Bulk Sig Map"}),
            content_type="application/json",
        ).json()["id"]
        system_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.j_system.id}),
            content_type="application/json",
        ).json()["id"]

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/{system_id}/signatures/bulk/",
            data=json.dumps(
                {
                    "rows": [
                        {"signature_id": "ABC-123"},
                        {"signature_id": "DEF-456"},
                    ]
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        signatures = response.json()["signatures"]
        self.assertEqual(len(signatures), 2)
        self.assertEqual({s["sig_type"] for s in signatures}, {"unknown"})

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/{system_id}/signatures/bulk/",
            data=json.dumps(
                {
                    "rows": [
                        {"signature_id": "ABC-123", "sig_type": "wormhole"},
                        {"signature_id": "DEF-456", "sig_type": "combat"},
                    ]
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        by_sig_id = {s["signature_id"]: s["sig_type"] for s in response.json()["signatures"]}
        self.assertEqual(by_sig_id, {"ABC-123": "wormhole", "DEF-456": "combat"})

        response = self.client.get(f"/wh-mapper/api/maps/{map_id}/state/")
        self.assertEqual(len(response.json()["signatures"]), 2)

    def test_bulk_upsert_signatures_lazy_delete_removes_missing_signature(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Lazy Delete Map"}),
            content_type="application/json",
        ).json()["id"]
        system_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.j_system.id}),
            content_type="application/json",
        ).json()["id"]

        first = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/{system_id}/signatures/bulk/",
            data=json.dumps(
                {"rows": [{"signature_id": "ABC-123"}, {"signature_id": "DEF-456"}]}
            ),
            content_type="application/json",
        ).json()["signatures"]
        dropped_id = next(s["id"] for s in first if s["signature_id"] == "DEF-456")

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/{system_id}/signatures/bulk/",
            data=json.dumps({"rows": [{"signature_id": "ABC-123"}], "lazy_delete": True}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body["signatures"]), 1)
        self.assertEqual(body["removed_signature_ids"], [dropped_id])
        self.assertEqual(body["removed_connection_ids"], [])

        response = self.client.get(f"/wh-mapper/api/maps/{map_id}/state/")
        signatures = response.json()["signatures"]
        self.assertEqual(len(signatures), 1)
        self.assertEqual(signatures[0]["signature_id"], "ABC-123")

    def test_bulk_upsert_signatures_lazy_delete_also_removes_linked_connection(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Lazy Delete Connection Map"}),
            content_type="application/json",
        ).json()["id"]
        top_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.jita.id}),
            content_type="application/json",
        ).json()["id"]
        bottom_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.j_system.id}),
            content_type="application/json",
        ).json()["id"]

        connection_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/",
            data=json.dumps({"top_system_id": top_id, "bottom_system_id": bottom_id}),
            content_type="application/json",
        ).json()["id"]

        signature_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/{bottom_id}/signatures/bulk/",
            data=json.dumps({"rows": [{"signature_id": "ABC-123", "sig_type": "wormhole"}]}),
            content_type="application/json",
        ).json()["signatures"][0]["id"]

        self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/{connection_id}/signature/",
            data=json.dumps({"signature_id": signature_id}),
            content_type="application/json",
        )

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/{bottom_id}/signatures/bulk/",
            data=json.dumps({"rows": [], "lazy_delete": True}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["removed_signature_ids"], [signature_id])
        self.assertEqual(body["removed_connection_ids"], [connection_id])

        response = self.client.get(f"/wh-mapper/api/maps/{map_id}/state/")
        connection_ids = [c["id"] for c in response.json()["connections"]]
        self.assertNotIn(connection_id, connection_ids)

    def test_bulk_upsert_signatures_lazy_delete_false_by_default_does_not_remove(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Lazy Delete Off Map"}),
            content_type="application/json",
        ).json()["id"]
        system_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.j_system.id}),
            content_type="application/json",
        ).json()["id"]

        self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/{system_id}/signatures/bulk/",
            data=json.dumps(
                {"rows": [{"signature_id": "ABC-123"}, {"signature_id": "DEF-456"}]}
            ),
            content_type="application/json",
        )

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/{system_id}/signatures/bulk/",
            data=json.dumps({"rows": [{"signature_id": "ABC-123"}]}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["removed_signature_ids"], [])
        self.assertEqual(body["removed_connection_ids"], [])

        response = self.client.get(f"/wh-mapper/api/maps/{map_id}/state/")
        self.assertEqual(len(response.json()["signatures"]), 2)

    def test_bulk_upsert_signatures_lazy_delete_empty_rows_removes_all(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Lazy Delete Wipe Map"}),
            content_type="application/json",
        ).json()["id"]
        system_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.j_system.id}),
            content_type="application/json",
        ).json()["id"]

        seeded = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/{system_id}/signatures/bulk/",
            data=json.dumps(
                {"rows": [{"signature_id": "ABC-123"}, {"signature_id": "DEF-456"}]}
            ),
            content_type="application/json",
        ).json()["signatures"]
        seeded_ids = {s["id"] for s in seeded}

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/{system_id}/signatures/bulk/",
            data=json.dumps({"rows": [], "lazy_delete": True}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body["removed_signature_ids"]), seeded_ids)

        response = self.client.get(f"/wh-mapper/api/maps/{map_id}/state/")
        self.assertEqual(response.json()["signatures"], [])

    def test_bulk_upsert_signatures_removes_dangling_unpinned_far_system(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Dangling System Map"}),
            content_type="application/json",
        ).json()["id"]
        top_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.jita.id}),
            content_type="application/json",
        ).json()["id"]
        bottom_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.j_system.id}),
            content_type="application/json",
        ).json()["id"]

        connection_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/",
            data=json.dumps({"top_system_id": top_id, "bottom_system_id": bottom_id}),
            content_type="application/json",
        ).json()["id"]

        signature_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/{top_id}/signatures/bulk/",
            data=json.dumps({"rows": [{"signature_id": "ABC-123", "sig_type": "wormhole"}]}),
            content_type="application/json",
        ).json()["signatures"][0]["id"]

        self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/{connection_id}/signature/",
            data=json.dumps({"signature_id": signature_id}),
            content_type="application/json",
        )

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/{top_id}/signatures/bulk/",
            data=json.dumps(
                {"rows": [], "lazy_delete": True, "remove_dangling_systems": True}
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["removed_connection_ids"], [connection_id])
        self.assertEqual(body["removed_system_ids"], [bottom_id])

        response = self.client.get(f"/wh-mapper/api/maps/{map_id}/state/")
        system_ids = [s["id"] for s in response.json()["systems"]]
        self.assertNotIn(bottom_id, system_ids)

    def test_bulk_upsert_signatures_does_not_remove_pinned_dangling_system(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Pinned Dangling System Map"}),
            content_type="application/json",
        ).json()["id"]
        top_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.jita.id}),
            content_type="application/json",
        ).json()["id"]
        bottom_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.j_system.id, "pinned": True}),
            content_type="application/json",
        ).json()["id"]

        connection_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/",
            data=json.dumps({"top_system_id": top_id, "bottom_system_id": bottom_id}),
            content_type="application/json",
        ).json()["id"]

        signature_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/{top_id}/signatures/bulk/",
            data=json.dumps({"rows": [{"signature_id": "ABC-123", "sig_type": "wormhole"}]}),
            content_type="application/json",
        ).json()["signatures"][0]["id"]

        self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/{connection_id}/signature/",
            data=json.dumps({"signature_id": signature_id}),
            content_type="application/json",
        )

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/{top_id}/signatures/bulk/",
            data=json.dumps(
                {"rows": [], "lazy_delete": True, "remove_dangling_systems": True}
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["removed_system_ids"], [])

        response = self.client.get(f"/wh-mapper/api/maps/{map_id}/state/")
        system_ids = [s["id"] for s in response.json()["systems"]]
        self.assertIn(bottom_id, system_ids)

    def test_bulk_upsert_signatures_never_removes_the_pasted_system(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Never Remove Pasted System Map"}),
            content_type="application/json",
        ).json()["id"]
        top_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.jita.id}),
            content_type="application/json",
        ).json()["id"]
        bottom_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.j_system.id}),
            content_type="application/json",
        ).json()["id"]

        connection_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/",
            data=json.dumps({"top_system_id": top_id, "bottom_system_id": bottom_id}),
            content_type="application/json",
        ).json()["id"]

        # Signature lives on the system being pasted into (top_id), so this
        # is the paste that leaves top_id itself with zero connections.
        signature_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/{top_id}/signatures/bulk/",
            data=json.dumps({"rows": [{"signature_id": "ABC-123", "sig_type": "wormhole"}]}),
            content_type="application/json",
        ).json()["signatures"][0]["id"]

        self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/{connection_id}/signature/",
            data=json.dumps({"signature_id": signature_id}),
            content_type="application/json",
        )

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/{top_id}/signatures/bulk/",
            data=json.dumps(
                {"rows": [], "lazy_delete": True, "remove_dangling_systems": True}
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(top_id, response.json()["removed_system_ids"])

        response = self.client.get(f"/wh-mapper/api/maps/{map_id}/state/")
        system_ids = [s["id"] for s in response.json()["systems"]]
        self.assertIn(top_id, system_ids)

    def test_bulk_upsert_signatures_remove_dangling_systems_is_noop_without_lazy_delete(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "No Lazy Delete No Dangling Map"}),
            content_type="application/json",
        ).json()["id"]
        top_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.jita.id}),
            content_type="application/json",
        ).json()["id"]
        bottom_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.j_system.id}),
            content_type="application/json",
        ).json()["id"]

        connection_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/",
            data=json.dumps({"top_system_id": top_id, "bottom_system_id": bottom_id}),
            content_type="application/json",
        ).json()["id"]

        signature_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/{top_id}/signatures/bulk/",
            data=json.dumps({"rows": [{"signature_id": "ABC-123", "sig_type": "wormhole"}]}),
            content_type="application/json",
        ).json()["signatures"][0]["id"]

        self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/{connection_id}/signature/",
            data=json.dumps({"signature_id": signature_id}),
            content_type="application/json",
        )

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/{top_id}/signatures/bulk/",
            data=json.dumps(
                {"rows": [], "lazy_delete": False, "remove_dangling_systems": True}
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["removed_signature_ids"], [])
        self.assertEqual(body["removed_connection_ids"], [])
        self.assertEqual(body["removed_system_ids"], [])

        response = self.client.get(f"/wh-mapper/api/maps/{map_id}/state/")
        system_ids = [s["id"] for s in response.json()["systems"]]
        self.assertIn(bottom_id, system_ids)

    def test_link_connection_signature_sets_correct_side(self):
        make_wormhole_type("K162")
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Link Sig Map"}),
            content_type="application/json",
        ).json()["id"]
        top_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.jita.id}),
            content_type="application/json",
        ).json()["id"]
        bottom_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.j_system.id}),
            content_type="application/json",
        ).json()["id"]

        connection_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/",
            data=json.dumps({"top_system_id": top_id, "bottom_system_id": bottom_id}),
            content_type="application/json",
        ).json()["id"]

        bottom_signature_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/{bottom_id}/signatures/",
            data=json.dumps(
                {"signature_id": "ABC-123", "sig_type": "wormhole", "wormhole_type_code": "K162"}
            ),
            content_type="application/json",
        ).json()["id"]

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/{connection_id}/signature/",
            data=json.dumps({"signature_id": bottom_signature_id}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["bottom_signature_id"], bottom_signature_id)
        self.assertIsNone(response.json()["top_signature_id"])

        top_signature_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/{top_id}/signatures/",
            data=json.dumps({"signature_id": "XYZ-789", "sig_type": "wormhole"}),
            content_type="application/json",
        ).json()["id"]

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/{connection_id}/signature/",
            data=json.dumps({"signature_id": top_signature_id}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["top_signature_id"], top_signature_id)
        self.assertEqual(response.json()["bottom_signature_id"], bottom_signature_id)

    def test_link_connection_signature_rejects_signature_from_unrelated_system(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Reject Link Map"}),
            content_type="application/json",
        ).json()["id"]
        top_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.jita.id}),
            content_type="application/json",
        ).json()["id"]
        bottom_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.j_system.id}),
            content_type="application/json",
        ).json()["id"]
        third_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.amarr.id}),
            content_type="application/json",
        ).json()["id"]

        connection_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/",
            data=json.dumps({"top_system_id": top_id, "bottom_system_id": bottom_id}),
            content_type="application/json",
        ).json()["id"]

        unrelated_signature_id = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/{third_id}/signatures/",
            data=json.dumps({"signature_id": "AAA-111"}),
            content_type="application/json",
        ).json()["id"]

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/connections/{connection_id}/signature/",
            data=json.dumps({"signature_id": unrelated_signature_id}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_sharing_grants_access(self):
        response = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Shared Map", "visibility": "shared"}),
            content_type="application/json",
        )
        map_id = response.json()["id"]

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/share/",
            data=json.dumps({"scope": "character", "target_id": 200002}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)

        self.client.logout()
        self.client.login(username="api_bob", password="test-password")
        response = self.client.get(f"/wh-mapper/api/maps/{map_id}/")
        self.assertEqual(response.status_code, 200)

        # bob can see it but isn't the owner, so can't delete it
        response = self.client.delete(f"/wh-mapper/api/maps/{map_id}/")
        self.assertEqual(response.status_code, 403)


class TestListShares(TestCase):
    """TestListShares"""

    @classmethod
    def setUpTestData(cls):
        cls.owner = make_user_with_character("shares_owner", 250001)
        cls.target_character = make_user_with_character("shares_target", 250002).profile.main_character
        cls.corp = EveCorporationInfo.objects.create(
            corporation_id=250101, corporation_name="Shares Test Corp", corporation_ticker="STC"
        )
        cls.alliance = EveAllianceInfo.objects.create(
            alliance_id=250201, alliance_name="Shares Test Alliance", alliance_ticker="STA"
        )
        cls.group = Group.objects.create(name="Shares Test Group")
        cls.owner.groups.add(cls.group)

    def setUp(self):
        self.client.login(username="shares_owner", password="test-password")
        self.map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Named Shares Map", "visibility": "shared"}),
            content_type="application/json",
        ).json()["id"]

    def _share(self, scope: str, target_id: int):
        self.client.post(
            f"/wh-mapper/api/maps/{self.map_id}/share/",
            data=json.dumps({"scope": scope, "target_id": target_id}),
            content_type="application/json",
        )

    def test_resolves_names_for_every_scope(self):
        self._share("character", self.target_character.character_id)
        self._share("corporation", self.corp.corporation_id)
        self._share("alliance", self.alliance.alliance_id)
        self._share("group", self.group.id)

        shares = {
            (s["scope"], s["target_id"]): s["target_name"]
            for s in self.client.get(f"/wh-mapper/api/maps/{self.map_id}/shares/").json()
        }

        self.assertEqual(
            shares[("character", self.target_character.character_id)],
            self.target_character.character_name,
        )
        self.assertEqual(shares[("corporation", self.corp.corporation_id)], "Shares Test Corp")
        self.assertEqual(shares[("alliance", self.alliance.alliance_id)], "Shares Test Alliance")
        self.assertEqual(shares[("group", self.group.id)], "Shares Test Group")

    def test_unknown_character_id_falls_back_to_none(self):
        self._share("character", 999999999)

        shares = self.client.get(f"/wh-mapper/api/maps/{self.map_id}/shares/").json()

        self.assertEqual(len(shares), 1)
        self.assertIsNone(shares[0]["target_name"])

    def test_admin_access_alone_can_view_but_not_edit_sharing_on_someone_elses_map(self):
        # admin_access can rename/delete any map, and can still see who a
        # map is shared with (list_shares is only gated on visibility), but
        # actually changing that list is more sensitive - it's restricted to
        # the owner or an actual superuser, not just anyone with admin_access.
        make_user_with_character(
            "shares_admin", 250003, perms=("wh_mapper.basic_access", "wh_mapper.admin_access")
        )
        self.client.logout()
        self.client.login(username="shares_admin", password="test-password")

        response = self.client.get(f"/wh-mapper/api/maps/{self.map_id}/shares/")
        self.assertEqual(response.status_code, 200)

        response = self.client.post(
            f"/wh-mapper/api/maps/{self.map_id}/share/",
            data=json.dumps({"scope": "character", "target_id": self.target_character.character_id}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_superuser_can_view_and_edit_sharing_on_someone_elses_map(self):
        superuser = make_user_with_character("shares_superuser", 250004)
        superuser.is_superuser = True
        superuser.save(update_fields=["is_superuser"])
        self.client.logout()
        self.client.login(username="shares_superuser", password="test-password")

        response = self.client.get(f"/wh-mapper/api/maps/{self.map_id}/shares/")
        self.assertEqual(response.status_code, 200)

        response = self.client.post(
            f"/wh-mapper/api/maps/{self.map_id}/share/",
            data=json.dumps({"scope": "character", "target_id": self.target_character.character_id}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)

    def test_user_the_map_is_shared_with_can_view_but_not_edit_sharing(self):
        self._share("character", self.target_character.character_id)

        self.client.logout()
        self.client.login(username="shares_target", password="test-password")

        response = self.client.get(f"/wh-mapper/api/maps/{self.map_id}/shares/")
        self.assertEqual(response.status_code, 200)

        response = self.client.post(
            f"/wh-mapper/api/maps/{self.map_id}/share/",
            data=json.dumps({"scope": "character", "target_id": self.target_character.character_id}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_owner_can_view_and_edit_sharing_on_own_map(self):
        response = self.client.get(f"/wh-mapper/api/maps/{self.map_id}/shares/")
        self.assertEqual(response.status_code, 200)

        response = self.client.post(
            f"/wh-mapper/api/maps/{self.map_id}/share/",
            data=json.dumps({"scope": "character", "target_id": self.target_character.character_id}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)

        response = self.client.delete(
            f"/wh-mapper/api/maps/{self.map_id}/share/character/{self.target_character.character_id}/"
        )
        self.assertEqual(response.status_code, 204)


class TestGroupSharing(TestCase):
    """TestGroupSharing"""

    @classmethod
    def setUpTestData(cls):
        cls.owner = make_user_with_character("group_share_owner", 240001)
        cls.member = make_user_with_character("group_share_member", 240002)
        cls.non_member = make_user_with_character("group_share_non_member", 240003)

        cls.own_group = Group.objects.create(name="Owner's Group")
        cls.owner.groups.add(cls.own_group)
        cls.member.groups.add(cls.own_group)

        cls.other_group = Group.objects.create(name="Some Other Group")

    def setUp(self):
        self.client.login(username="group_share_owner", password="test-password")

    def test_group_search_is_scoped_to_the_requesting_user_s_own_groups(self):
        names = {
            g["group_name"]
            for g in self.client.get("/wh-mapper/api/groups/search/Group/").json()
        }
        self.assertIn("Owner's Group", names)
        self.assertNotIn("Some Other Group", names)

    def test_sharing_a_map_with_a_group_grants_access_to_its_members(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Group Shared Map", "visibility": "shared"}),
            content_type="application/json",
        ).json()["id"]

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/share/",
            data=json.dumps({"scope": "group", "target_id": self.own_group.id}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)

        self.client.logout()
        self.client.login(username="group_share_member", password="test-password")
        response = self.client.get(f"/wh-mapper/api/maps/{map_id}/")
        self.assertEqual(response.status_code, 200)

        self.client.logout()
        self.client.login(username="group_share_non_member", password="test-password")
        response = self.client.get(f"/wh-mapper/api/maps/{map_id}/")
        self.assertEqual(response.status_code, 404)

    def test_sharing_with_an_unknown_group_id_returns_404(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Bad Group Share Map", "visibility": "shared"}),
            content_type="application/json",
        ).json()["id"]

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/share/",
            data=json.dumps({"scope": "group", "target_id": 999999}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 404)

    def test_revoking_a_group_share_removes_access(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Revoked Group Map", "visibility": "shared"}),
            content_type="application/json",
        ).json()["id"]
        self.client.post(
            f"/wh-mapper/api/maps/{map_id}/share/",
            data=json.dumps({"scope": "group", "target_id": self.own_group.id}),
            content_type="application/json",
        )

        response = self.client.delete(
            f"/wh-mapper/api/maps/{map_id}/share/group/{self.own_group.id}/"
        )
        self.assertEqual(response.status_code, 204)

        self.client.logout()
        self.client.login(username="group_share_member", password="test-password")
        response = self.client.get(f"/wh-mapper/api/maps/{map_id}/")
        self.assertEqual(response.status_code, 404)


class TestStargateAutoLink(TestCase):
    """TestStargateAutoLink"""

    @classmethod
    def setUpTestData(cls):
        cls.alice = make_user_with_character("stargate_api_alice", 220001)
        cls.jita = make_solar_system("StargateApiJita")
        cls.perimeter = make_solar_system("StargateApiPerimeter")
        cls.amarr = make_solar_system("StargateApiAmarr")
        make_stargate(cls.jita, cls.perimeter)

    def setUp(self):
        self.client.login(username="stargate_api_alice", password="test-password")

    def test_adding_a_gate_connected_system_auto_links_it(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Gate Auto-Link Map"}),
            content_type="application/json",
        ).json()["id"]

        self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.jita.id}),
            content_type="application/json",
        )
        self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.perimeter.id}),
            content_type="application/json",
        )

        state = self.client.get(f"/wh-mapper/api/maps/{map_id}/state/").json()
        self.assertEqual(len(state["connections"]), 1)
        self.assertEqual(state["connections"][0]["connection_type"], "stargate")

    def test_adding_an_unconnected_system_does_not_create_a_connection(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "No Gate Map"}),
            content_type="application/json",
        ).json()["id"]

        self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.jita.id}),
            content_type="application/json",
        )
        self.client.post(
            f"/wh-mapper/api/maps/{map_id}/systems/",
            data=json.dumps({"solar_system_id": self.amarr.id}),
            content_type="application/json",
        )

        state = self.client.get(f"/wh-mapper/api/maps/{map_id}/state/").json()
        self.assertEqual(len(state["connections"]), 0)

    def test_re_adding_an_existing_system_does_not_duplicate_the_link(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Idempotent Gate Map"}),
            content_type="application/json",
        ).json()["id"]

        for _ in range(2):
            self.client.post(
                f"/wh-mapper/api/maps/{map_id}/systems/",
                data=json.dumps({"solar_system_id": self.jita.id}),
                content_type="application/json",
            )
            self.client.post(
                f"/wh-mapper/api/maps/{map_id}/systems/",
                data=json.dumps({"solar_system_id": self.perimeter.id}),
                content_type="application/json",
            )

        self.assertEqual(WormholeConnection.objects.filter(map_id=map_id).count(), 1)


class TestRegionImport(TestCase):
    """TestRegionImport"""

    @classmethod
    def setUpTestData(cls):
        cls.alice = make_user_with_character("region_api_alice", 230001)

        cls.region = Region.objects.create(id=910001, name="Flat Import Region")
        constellation = Constellation.objects.create(
            id=910002, name="Flat Import Constellation", region=cls.region
        )
        cls.sys_a = SolarSystem.objects.create(
            id=910003, name="FlatImportA", constellation=constellation,
            security_status=0.5, x_2d=0.0, y_2d=0.0,
        )
        cls.sys_b = SolarSystem.objects.create(
            id=910004, name="FlatImportB", constellation=constellation,
            security_status=0.5, x_2d=100.0, y_2d=50.0,
        )
        make_stargate(cls.sys_a, cls.sys_b)

        cls.wh_region = Region.objects.create(id=910005, name="Fake WH Region")
        wh_constellation = Constellation.objects.create(
            id=910006, name="Fake WH Constellation", region=cls.wh_region
        )
        SolarSystem.objects.create(
            id=31000040, name="FakeWhSystem", constellation=wh_constellation,
            security_status=-1.0, wormhole_class_id_raw=3,
        )

    def setUp(self):
        self.client.login(username="region_api_alice", password="test-password")

    def test_flat_region_appears_in_region_list(self):
        names = [r["name"] for r in self.client.get("/wh-mapper/api/regions/").json()]
        self.assertIn("Flat Import Region", names)

    def test_wormhole_region_does_not_appear_in_region_list(self):
        names = [r["name"] for r in self.client.get("/wh-mapper/api/regions/").json()]
        self.assertNotIn("Fake WH Region", names)

    def test_universe_regions_graph_includes_flat_excludes_wh(self):
        response = self.client.get("/wh-mapper/api/universe/regions-graph/")
        self.assertEqual(response.status_code, 200)
        data = response.json()

        node_ids = {n["id"] for n in data["nodes"]}
        self.assertIn(self.region.id, node_ids)
        self.assertNotIn(self.wh_region.id, node_ids)

        matching_edges = [
            e
            for e in data["edges"]
            if {e["source"], e["target"]} == {
                self.sys_a.constellation.region_id,
                self.sys_b.constellation.region_id
            }
        ]
        # sys_a/sys_b are in the same region, so their stargate produces no
        # cross-region edge.
        self.assertEqual(matching_edges, [])

    def test_importing_a_region_adds_its_systems_and_links_them(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Region Import Map"}),
            content_type="application/json",
        ).json()["id"]

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/import-region/",
            data=json.dumps({"region_id": self.region.id}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"systems_added": 2, "connections_added": 1})

        state = self.client.get(f"/wh-mapper/api/maps/{map_id}/state/").json()
        self.assertEqual(len(state["systems"]), 2)
        self.assertEqual(len(state["connections"]), 1)
        self.assertEqual(state["connections"][0]["connection_type"], "stargate")

        by_name = {s["solar_system"]["name"]: s for s in state["systems"]}
        self.assertNotEqual(by_name["FlatImportA"]["x"], by_name["FlatImportB"]["x"])

    def test_re_importing_the_same_region_does_not_duplicate_anything(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Idempotent Region Import Map"}),
            content_type="application/json",
        ).json()["id"]

        for _ in range(2):
            response = self.client.post(
                f"/wh-mapper/api/maps/{map_id}/import-region/",
                data=json.dumps({"region_id": self.region.id}),
                content_type="application/json",
            )

        self.assertEqual(response.json(), {"systems_added": 0, "connections_added": 0})
        state = self.client.get(f"/wh-mapper/api/maps/{map_id}/state/").json()
        self.assertEqual(len(state["systems"]), 2)
        self.assertEqual(len(state["connections"]), 1)

    def test_importing_a_wormhole_region_is_rejected(self):
        map_id = self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Rejected Region Import Map"}),
            content_type="application/json",
        ).json()["id"]

        response = self.client.post(
            f"/wh-mapper/api/maps/{map_id}/import-region/",
            data=json.dumps({"region_id": self.wh_region.id}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 404)


class TestReadOnlyMap(TestCase):
    """TestReadOnlyMap - Map.read_only's enforcement (require_writable_map)
    and auto-visibility (MapQuerySet.visible_to)."""

    @classmethod
    def setUpTestData(cls):
        # The map's own owner isn't special-cased either - only
        # admin_access bypasses read_only, so this user is used purely to
        # satisfy Map.owner's FK, never logged in as.
        cls.owner = make_user_with_character("readonly_owner", 240001)
        cls.viewer = make_user_with_character("readonly_viewer", 240002)
        cls.admin = make_user_with_character(
            "readonly_admin",
            240003,
            perms=("wh_mapper.basic_access", "wh_mapper.admin_access"),
        )

        cls.sys_a = make_solar_system("ReadOnlyA", security_status=0.5)
        cls.sys_b = make_solar_system("ReadOnlyB", security_status=0.5)

        cls.map = Map.objects.create(
            name="Read Only Map", owner=cls.owner, read_only=True
        )
        cls.map_system_a = MapSystem.objects.create(map=cls.map, solar_system=cls.sys_a)
        cls.map_system_b = MapSystem.objects.create(map=cls.map, solar_system=cls.sys_b)
        cls.connection = WormholeConnection.objects.create(
            map=cls.map, top_system=cls.map_system_a, bottom_system=cls.map_system_b
        )
        cls.signature = Signature.objects.create(
            map_system=cls.map_system_a, signature_id="ABC-123"
        )

    def setUp(self):
        self.client.login(username="readonly_viewer", password="test-password")

    def test_visible_to_every_basic_access_user_with_no_share(self):
        response = self.client.get("/wh-mapper/api/maps/")
        self.assertIn(self.map.id, [m["id"] for m in response.json()])

    def test_map_out_reports_read_only_and_cannot_write(self):
        data = self.client.get(f"/wh-mapper/api/maps/{self.map.id}/").json()
        self.assertTrue(data["read_only"])
        self.assertFalse(data["can_write"])

    def test_state_is_still_readable(self):
        response = self.client.get(f"/wh-mapper/api/maps/{self.map.id}/state/")
        self.assertEqual(response.status_code, 200)

    def test_add_system_is_rejected(self):
        response = self.client.post(
            f"/wh-mapper/api/maps/{self.map.id}/systems/",
            data=json.dumps({"solar_system_id": make_solar_system("ReadOnlyC").id}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_remove_system_is_rejected(self):
        response = self.client.delete(
            f"/wh-mapper/api/maps/{self.map.id}/systems/{self.map_system_a.id}/"
        )
        self.assertEqual(response.status_code, 403)

    def test_auto_layout_is_rejected(self):
        response = self.client.post(
            f"/wh-mapper/api/maps/{self.map.id}/systems/auto-layout/",
            data=json.dumps(
                {"positions": [{"id": self.map_system_a.id, "x": 1, "y": 1}]}
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_add_connection_is_rejected(self):
        response = self.client.post(
            f"/wh-mapper/api/maps/{self.map.id}/connections/",
            data=json.dumps(
                {
                    "top_system_id": self.map_system_a.id,
                    "bottom_system_id": self.map_system_b.id,
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_update_connection_is_rejected(self):
        response = self.client.patch(
            f"/wh-mapper/api/maps/{self.map.id}/connections/{self.connection.id}/",
            data=json.dumps({"mass_status": "fresh"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_add_signature_is_rejected(self):
        response = self.client.post(
            f"/wh-mapper/api/maps/{self.map.id}/systems/{self.map_system_b.id}/signatures/",
            data=json.dumps({"signature_id": "XYZ-789"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_update_signature_is_rejected(self):
        response = self.client.patch(
            f"/wh-mapper/api/maps/{self.map.id}/systems/{self.map_system_a.id}"
            f"/signatures/{self.signature.id}/",
            data=json.dumps({"is_hidden": True}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_remove_signature_is_rejected(self):
        response = self.client.delete(
            f"/wh-mapper/api/maps/{self.map.id}/systems/{self.map_system_a.id}"
            f"/signatures/{self.signature.id}/"
        )
        self.assertEqual(response.status_code, 403)

    def test_owner_without_admin_access_is_still_rejected(self):
        self.client.logout()
        self.client.login(username="readonly_owner", password="test-password")
        response = self.client.delete(
            f"/wh-mapper/api/maps/{self.map.id}/systems/{self.map_system_a.id}/"
        )
        self.assertEqual(response.status_code, 403)

    def test_admin_access_bypasses_read_only(self):
        self.client.logout()
        self.client.login(username="readonly_admin", password="test-password")

        data = self.client.get(f"/wh-mapper/api/maps/{self.map.id}/").json()
        self.assertTrue(data["can_write"])

        response = self.client.patch(
            f"/wh-mapper/api/maps/{self.map.id}/connections/{self.connection.id}/",
            data=json.dumps({"mass_status": "fresh"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)


class TestImportFromMap(TestCase):
    """TestImportFromMap"""

    @classmethod
    def setUpTestData(cls):
        cls.owner = make_user_with_character("import_map_owner", 250001)
        cls.alice = make_user_with_character("import_map_alice", 250002)

        cls.hub = make_solar_system("ImportHub", security_status=0.5)
        cls.far = make_solar_system("ImportFar", security_status=0.5)

        cls.source_map = Map.objects.create(
            name="Read Only Source", owner=cls.owner, read_only=True
        )
        cls.hub_system = MapSystem.objects.create(
            map=cls.source_map, solar_system=cls.hub, x=1.0, y=2.0
        )
        cls.far_system = MapSystem.objects.create(
            map=cls.source_map, solar_system=cls.far, x=3.0, y=4.0
        )
        cls.source_signature = Signature.objects.create(
            map_system=cls.hub_system,
            signature_id="ABC-123",
            sig_type="wormhole",
        )
        cls.source_connection = WormholeConnection.objects.create(
            map=cls.source_map,
            top_system=cls.hub_system,
            bottom_system=cls.far_system,
            top_signature=cls.source_signature,
            ship_size_limit="large",
        )

        cls.not_read_only_map = Map.objects.create(name="Not Read Only", owner=cls.alice)

    def setUp(self):
        self.client.login(username="import_map_alice", password="test-password")

    def _create_target_map(self) -> int:
        return self.client.post(
            "/wh-mapper/api/maps/",
            data=json.dumps({"name": "Import Target"}),
            content_type="application/json",
        ).json()["id"]

    def test_imports_systems_signatures_and_connections(self):
        target_map_id = self._create_target_map()

        response = self.client.post(
            f"/wh-mapper/api/maps/{target_map_id}/import-from-map/",
            data=json.dumps({"source_map_id": self.source_map.id}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"systems_added": 2, "connections_added": 1, "signatures_added": 1},
        )

        state = self.client.get(f"/wh-mapper/api/maps/{target_map_id}/state/").json()
        self.assertEqual(len(state["systems"]), 2)
        self.assertEqual(len(state["connections"]), 1)
        self.assertEqual(len(state["signatures"]), 1)
        self.assertEqual(state["connections"][0]["ship_size_limit"], "large")
        self.assertIsNotNone(state["signatures"][0]["id"])

    def test_re_importing_does_not_duplicate_anything(self):
        target_map_id = self._create_target_map()

        for _ in range(2):
            response = self.client.post(
                f"/wh-mapper/api/maps/{target_map_id}/import-from-map/",
                data=json.dumps({"source_map_id": self.source_map.id}),
                content_type="application/json",
            )

        self.assertEqual(
            response.json(),
            {"systems_added": 0, "connections_added": 0, "signatures_added": 0},
        )
        state = self.client.get(f"/wh-mapper/api/maps/{target_map_id}/state/").json()
        self.assertEqual(len(state["systems"]), 2)
        self.assertEqual(len(state["connections"]), 1)
        self.assertEqual(len(state["signatures"]), 1)

    def test_importing_from_a_non_read_only_map_is_rejected(self):
        target_map_id = self._create_target_map()

        response = self.client.post(
            f"/wh-mapper/api/maps/{target_map_id}/import-from-map/",
            data=json.dumps({"source_map_id": self.not_read_only_map.id}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_importing_into_a_read_only_target_is_rejected(self):
        response = self.client.post(
            f"/wh-mapper/api/maps/{self.source_map.id}/import-from-map/",
            data=json.dumps({"source_map_id": self.source_map.id}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)


class TestTrackingApi(TestCase):
    """TestTrackingApi"""

    @classmethod
    def setUpTestData(cls):
        cls.alice = make_user_with_character("tracking_api_alice2", 210001)
        cls.bob = make_user_with_character("tracking_api_bob2", 210002)
        cls.sys_a = make_solar_system("TrackingApiSys")

    def setUp(self):
        self.map = Map.objects.create(name="Tracking API Map", owner=self.alice, visibility="shared")
        make_esi_location_token(self.alice, 210001, "tracking_api_alice2 Char", LOCATION_SCOPES)
        self.tracked = TrackedCharacter.objects.create(
            character=self.alice.profile.main_character,
            added_by=self.alice,
            last_solar_system=self.sys_a,
        )
        self.client.login(username="tracking_api_alice2", password="test-password")

    def test_list_trackable_characters_includes_tracked_one(self):
        response = self.client.get("/wh-mapper/api/trackable-characters/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body), 1)
        self.assertEqual(body[0]["character_id"], 210001)
        self.assertEqual(body[0]["last_solar_system"]["name"], "TrackingApiSys")
        self.assertIs(body[0]["is_tracked"], True)
        self.assertIs(body[0]["is_online"], True)

    def test_list_trackable_characters_includes_offline_tracked_ones(self):
        self.tracked.is_active = False
        self.tracked.save(update_fields=["is_active"])

        response = self.client.get("/wh-mapper/api/trackable-characters/")

        body = response.json()
        self.assertEqual(len(body), 1)
        self.assertIs(body[0]["is_tracked"], True)
        self.assertIs(body[0]["is_online"], False)

    def test_list_trackable_characters_includes_untracked_character_with_token(self):
        self.tracked.delete()

        response = self.client.get("/wh-mapper/api/trackable-characters/")

        body = response.json()
        self.assertEqual(len(body), 1)
        self.assertEqual(body[0]["character_id"], 210001)
        self.assertIs(body[0]["is_tracked"], False)
        self.assertIs(body[0]["is_online"], False)

    def test_list_trackable_characters_excludes_characters_without_a_token(self):
        # Bob owns 210002 but has never granted an ESI location token for it.
        self.client.logout()
        self.client.login(username="tracking_api_bob2", password="test-password")

        response = self.client.get("/wh-mapper/api/trackable-characters/")

        self.assertEqual(response.json(), [])

    def test_start_tracking_existing_character_with_valid_token(self):
        self.tracked.delete()

        response = self.client.post("/wh-mapper/api/trackable-characters/210001/track/")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["character_id"], 210001)
        self.assertIs(body["is_online"], True)
        self.assertTrue(
            TrackedCharacter.objects.filter(
                character__character_id=210001, added_by=self.alice, is_active=True
            ).exists()
        )

    def test_start_tracking_character_without_token_is_rejected(self):
        # Alice owns 210001 (has a token) but not 210002.
        response = self.client.post("/wh-mapper/api/trackable-characters/210002/track/")

        self.assertEqual(response.status_code, 404)

    def test_cannot_start_tracking_someone_elses_character(self):
        make_esi_location_token(self.bob, 210002, "tracking_api_bob2 Char", LOCATION_SCOPES)

        response = self.client.post("/wh-mapper/api/trackable-characters/210002/track/")

        self.assertEqual(response.status_code, 404)
        self.assertFalse(TrackedCharacter.objects.filter(character__character_id=210002).exists())

    def test_state_endpoint_includes_tracked_character_when_owner_present_on_this_map(self):
        MapSystem.objects.create(map=self.map, solar_system=self.sys_a)
        MapPresence.objects.create(map=self.map, user=self.alice, channel_name="chan-state")

        response = self.client.get(f"/wh-mapper/api/maps/{self.map.id}/state/")
        self.assertEqual(response.status_code, 200)
        tracked = response.json()["tracked_characters"]
        self.assertEqual(len(tracked), 1)
        self.assertEqual(tracked[0]["character_id"], 210001)

    def test_state_endpoint_excludes_tracked_character_when_owner_not_present(self):
        MapSystem.objects.create(map=self.map, solar_system=self.sys_a)
        # alice isn't currently viewing this map (no MapPresence row)

        response = self.client.get(f"/wh-mapper/api/maps/{self.map.id}/state/")
        self.assertEqual(response.json()["tracked_characters"], [])

    def test_state_endpoint_excludes_offline_tracked_character(self):
        MapSystem.objects.create(map=self.map, solar_system=self.sys_a)
        MapPresence.objects.create(map=self.map, user=self.alice, channel_name="chan-state-offline")
        self.tracked.is_active = False
        self.tracked.save(update_fields=["is_active"])

        response = self.client.get(f"/wh-mapper/api/maps/{self.map.id}/state/")

        self.assertEqual(response.json()["tracked_characters"], [])

    def test_added_by_can_remove_own_tracked_character(self):
        response = self.client.delete("/wh-mapper/api/tracked-characters/210001/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(TrackedCharacter.objects.filter(pk=self.tracked.pk).exists())

    def test_cannot_remove_someone_elses_tracked_character(self):
        bob_tracked = TrackedCharacter.objects.create(
            character=self.bob.profile.main_character, added_by=self.bob
        )

        response = self.client.delete("/wh-mapper/api/tracked-characters/210002/")

        self.assertEqual(response.status_code, 404)
        self.assertTrue(TrackedCharacter.objects.filter(pk=bob_tracked.pk).exists())
