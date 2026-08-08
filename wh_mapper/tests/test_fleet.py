"""Tests for the fleet-mass-tracking feature - see the wayfinder map at
.scratch/fleet-mass-tracking/map.md."""

# Standard Library
from types import SimpleNamespace
from unittest.mock import patch

# Third Party
# Django EvE SDE
from eve_sde.models import ItemCategory, ItemGroup, ItemType

# Django
from django.test import TestCase

# AA WH Mapper App
from wh_mapper.api.helpers import (
    apply_fleet_crossing_mass,
    connection_effective_mass_status,
    mass_status_for_remaining_fraction,
    record_mass_crossing,
    ship_mass_kg,
)
from wh_mapper.constants import FLEET_SCOPES
from wh_mapper.models import (
    FleetMemberState,
    FleetTrackingSession,
    FleetTrackingWatcher,
    Map,
    MapSystem,
    Signature,
    WormholeConnection,
    WormholeType,
)
from wh_mapper.pathfinding import bfs_hop_distances, build_graph
from wh_mapper.tasks import _handle_fleet_poll_failure, poll_fleet_session
from wh_mapper.tests.factories import (
    make_esi_location_token,
    make_solar_system,
    make_user_with_character,
)


def make_ship_item_type(type_id: int, mass: float, name: str = "Test Ship") -> ItemType:
    category, _ = ItemCategory.objects.get_or_create(id=6, defaults={"name": "Ship"})
    group, _ = ItemGroup.objects.get_or_create(
        id=type_id + 1_000_000, defaults={"name": "Test Group", "category": category}
    )
    return ItemType.objects.create(id=type_id, name=name, group=group, mass=mass)


def make_wormhole_type(code: str, max_mass: float, key: int) -> WormholeType:
    category, _ = ItemCategory.objects.get_or_create(id=888100, defaults={"name": "Celestial"})
    group, _ = ItemGroup.objects.get_or_create(
        id=988100, defaults={"name": "Wormhole", "category": category}
    )
    item_type = ItemType.objects.create(id=40100000 + key, name=f"Wormhole {code}", group=group)
    return WormholeType.objects.create(item_type=item_type, code=code, max_mass=max_mass)


class TestMassStatusForRemainingFraction(TestCase):
    def test_above_fresh_threshold_is_fresh(self):
        self.assertEqual(mass_status_for_remaining_fraction(0.9), WormholeConnection.MassStatus.FRESH)

    def test_at_fresh_threshold_is_reduced(self):
        self.assertEqual(mass_status_for_remaining_fraction(0.5), WormholeConnection.MassStatus.REDUCED)

    def test_between_thresholds_is_reduced(self):
        self.assertEqual(mass_status_for_remaining_fraction(0.3), WormholeConnection.MassStatus.REDUCED)

    def test_at_critical_threshold_is_critical(self):
        self.assertEqual(mass_status_for_remaining_fraction(0.1), WormholeConnection.MassStatus.CRITICAL)

    def test_below_critical_threshold_is_critical(self):
        self.assertEqual(mass_status_for_remaining_fraction(0.0), WormholeConnection.MassStatus.CRITICAL)


class TestConnectionEffectiveMassStatus(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = make_user_with_character("mass_status_owner", 500201)
        cls.map = Map.objects.create(name="Mass Status Map", owner=cls.owner)
        cls.top_system = MapSystem.objects.create(
            map=cls.map, solar_system=make_solar_system("MassStatusA")
        )
        cls.bottom_system = MapSystem.objects.create(
            map=cls.map, solar_system=make_solar_system("MassStatusB")
        )

    def test_unidentified_type_falls_back_to_manual_status(self):
        connection = WormholeConnection.objects.create(
            map=self.map,
            top_system=self.top_system,
            bottom_system=self.bottom_system,
            mass_status=WormholeConnection.MassStatus.REDUCED,
        )

        self.assertEqual(
            connection_effective_mass_status(connection), WormholeConnection.MassStatus.REDUCED
        )

    def test_identified_type_computes_from_mass_crossed(self):
        wormhole_type = make_wormhole_type("C247", max_mass=1_000_000, key=1)
        signature = Signature.objects.create(
            map_system=self.bottom_system,
            signature_id="XYZ-001",
            sig_type=Signature.SignatureType.WORMHOLE,
            wormhole_type=wormhole_type,
        )
        connection = WormholeConnection.objects.create(
            map=self.map,
            top_system=self.top_system,
            bottom_system=self.bottom_system,
            bottom_signature=signature,
            mass_crossed=920_000,  # 8% remaining
        )

        self.assertEqual(
            connection_effective_mass_status(connection), WormholeConnection.MassStatus.CRITICAL
        )


class TestRecordMassCrossing(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = make_user_with_character("record_crossing_owner", 500202)
        cls.map = Map.objects.create(name="Record Crossing Map", owner=cls.owner)
        cls.top_system = MapSystem.objects.create(
            map=cls.map, solar_system=make_solar_system("RecordCrossingA")
        )
        cls.bottom_system = MapSystem.objects.create(
            map=cls.map, solar_system=make_solar_system("RecordCrossingB")
        )

    def test_accumulates_and_reports_bucket_change(self):
        wormhole_type = make_wormhole_type("C248", max_mass=1_000_000, key=2)
        signature = Signature.objects.create(
            map_system=self.bottom_system,
            signature_id="XYZ-002",
            sig_type=Signature.SignatureType.WORMHOLE,
            wormhole_type=wormhole_type,
        )
        connection = WormholeConnection.objects.create(
            map=self.map,
            top_system=self.top_system,
            bottom_system=self.bottom_system,
            bottom_signature=signature,
        )

        # 400_000 crossed -> 60% remaining -> still fresh -> no bucket change
        changed = record_mass_crossing(connection, 400_000)
        self.assertFalse(changed)
        self.assertEqual(connection.mass_crossed, 400_000)

        # +200_000 more -> 40% remaining -> reduced -> bucket changed
        changed = record_mass_crossing(connection, 200_000)
        self.assertTrue(changed)
        self.assertEqual(connection.mass_crossed, 600_000)


class TestApplyFleetCrossingMass(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = make_user_with_character("crossing_owner", 500203)
        cls.system_a = make_solar_system("CrossingSystemA")
        cls.system_b = make_solar_system("CrossingSystemB")
        cls.system_c = make_solar_system("CrossingSystemC")

    def test_deducts_on_every_matching_connection_across_visible_maps(self):
        map_one = Map.objects.create(name="Crossing Map One", owner=self.owner)
        map_two = Map.objects.create(name="Crossing Map Two", owner=self.owner)

        m1_a = MapSystem.objects.create(map=map_one, solar_system=self.system_a)
        m1_b = MapSystem.objects.create(map=map_one, solar_system=self.system_b)
        connection_one = WormholeConnection.objects.create(
            map=map_one, top_system=m1_a, bottom_system=m1_b
        )

        m2_a = MapSystem.objects.create(map=map_two, solar_system=self.system_a)
        m2_b = MapSystem.objects.create(map=map_two, solar_system=self.system_b)
        connection_two = WormholeConnection.objects.create(
            map=map_two, top_system=m2_a, bottom_system=m2_b
        )

        changed = apply_fleet_crossing_mass(
            self.owner, self.system_a.id, self.system_b.id, 12_000_000
        )

        self.assertEqual({c.id for _map_id, c in changed}, set())  # both fresh->fresh, no bucket flip
        connection_one.refresh_from_db()
        connection_two.refresh_from_db()
        self.assertEqual(connection_one.mass_crossed, 12_000_000)
        self.assertEqual(connection_two.mass_crossed, 12_000_000)

    def test_no_matching_connection_does_nothing(self):
        changed = apply_fleet_crossing_mass(
            self.owner, self.system_a.id, self.system_c.id, 12_000_000
        )
        self.assertEqual(changed, [])

    def test_only_wormhole_type_connections_are_affected(self):
        map_obj = Map.objects.create(name="Crossing Stargate Map", owner=self.owner)
        top = MapSystem.objects.create(map=map_obj, solar_system=self.system_a)
        bottom = MapSystem.objects.create(map=map_obj, solar_system=self.system_b)
        stargate_connection = WormholeConnection.objects.create(
            map=map_obj,
            top_system=top,
            bottom_system=bottom,
            connection_type=WormholeConnection.ConnectionType.STARGATE,
        )

        changed = apply_fleet_crossing_mass(
            self.owner, self.system_a.id, self.system_b.id, 12_000_000
        )

        self.assertEqual(changed, [])
        stargate_connection.refresh_from_db()
        self.assertEqual(stargate_connection.mass_crossed, 0)


class TestShipMassKg(TestCase):
    def test_known_type_returns_mass(self):
        make_ship_item_type(600001, mass=13_000_000)
        self.assertEqual(ship_mass_kg(600001), 13_000_000)

    def test_unknown_type_returns_none(self):
        self.assertIsNone(ship_mass_kg(999999))


class TestBfsHopDistances(TestCase):
    def test_distances_from_source(self):
        graph = {
            1: [(2, 1.5, object())],
            2: [(1, 1.5, object()), (3, 1.0, object())],
            3: [(2, 1.0, object())],
        }
        distances = bfs_hop_distances(graph, 1)
        self.assertEqual(distances, {1: 0, 2: 1, 3: 2})

    def test_unreachable_node_absent(self):
        graph = {1: [(2, 1.0, object())], 3: [(4, 1.0, object())]}
        distances = bfs_hop_distances(graph, 1)
        self.assertNotIn(3, distances)
        self.assertNotIn(4, distances)


class TestPollFleetSession(TestCase):
    def setUp(self):
        self.operator = make_user_with_character(
            "poll_fleet_operator", 500301, perms=("wh_mapper.basic_access", "wh_mapper.backseat_fc")
        )
        self.fc_character = self.operator.profile.main_character
        make_esi_location_token(self.operator, self.fc_character.character_id, "FC Char", FLEET_SCOPES)

        self.system_a = make_solar_system("PollFleetSystemA")
        self.system_b = make_solar_system("PollFleetSystemB")

        self.map_obj = Map.objects.create(name="Poll Fleet Map", owner=self.operator)
        self.map_system_a = MapSystem.objects.create(map=self.map_obj, solar_system=self.system_a)
        self.map_system_b = MapSystem.objects.create(map=self.map_obj, solar_system=self.system_b)
        # Identified (max_mass=5.5M) so a 5M-kg crossing visibly flips the
        # bucket fresh->critical, giving record_mass_crossing/
        # apply_fleet_crossing_mass something to report as "changed".
        wormhole_type = make_wormhole_type("C249", max_mass=5_500_000, key=3)
        signature = Signature.objects.create(
            map_system=self.map_system_b,
            signature_id="POLL-001",
            sig_type=Signature.SignatureType.WORMHOLE,
            wormhole_type=wormhole_type,
        )
        self.connection = WormholeConnection.objects.create(
            map=self.map_obj,
            top_system=self.map_system_a,
            bottom_system=self.map_system_b,
            bottom_signature=signature,
        )

        self.session = FleetTrackingSession.objects.create(
            fc_character=self.fc_character, started_by=self.operator, fleet_id=42
        )
        make_ship_item_type(600100, mass=5_000_000, name="Test Frigate")
        FleetMemberState.objects.create(
            session=self.session,
            character_id=self.fc_character.character_id,
            character_name="FC Char",
            ship_type_id=600100,
            last_solar_system=self.system_a,
        )

    def test_crossing_deducts_mass_and_broadcasts(self):
        member_row = SimpleNamespace(
            character_id=self.fc_character.character_id,
            solar_system_id=self.system_b.id,
            ship_type_id=600100,
        )
        fleet_info = SimpleNamespace(fleet_boss_id=self.fc_character.character_id, fleet_id=42)

        with (
            patch("wh_mapper.tasks.esi") as mock_esi,
            patch("wh_mapper.tasks.broadcast_fleet_event") as mock_broadcast_fleet,
            patch("wh_mapper.tasks.broadcast_map_event") as mock_broadcast_map,
        ):
            mock_esi.client.Fleets.GetCharactersCharacterIdFleet.return_value.result.return_value = (
                fleet_info
            )
            mock_esi.client.Fleets.GetFleetsFleetIdMembers.return_value.result.return_value = (
                SimpleNamespace(members=[member_row])
            )

            poll_fleet_session(self.session.id)

        self.connection.refresh_from_db()
        self.assertEqual(self.connection.mass_crossed, 5_000_000)
        mock_broadcast_map.assert_called_once()
        mock_broadcast_fleet.assert_called_once()

        self.session.refresh_from_db()
        self.assertEqual(self.session.consecutive_failures, 0)

        state = FleetMemberState.objects.get(
            session=self.session, character_id=self.fc_character.character_id
        )
        self.assertEqual(state.last_solar_system_id, self.system_b.id)

    def test_no_longer_boss_counts_as_failure(self):
        fleet_info = SimpleNamespace(fleet_boss_id=999999, fleet_id=42)

        with patch("wh_mapper.tasks.esi") as mock_esi:
            mock_esi.client.Fleets.GetCharactersCharacterIdFleet.return_value.result.return_value = (
                fleet_info
            )
            poll_fleet_session(self.session.id)

        self.session.refresh_from_db()
        self.assertEqual(self.session.consecutive_failures, 1)

    def test_missing_token_counts_as_failure_without_calling_esi(self):
        FleetTrackingSession.objects.filter(pk=self.session.pk).update(fc_character=self.fc_character)
        with (
            patch("wh_mapper.tasks.Token.get_token", return_value=None),
            patch("wh_mapper.tasks.esi") as mock_esi,
        ):
            poll_fleet_session(self.session.id)

        mock_esi.client.Fleets.GetCharactersCharacterIdFleet.assert_not_called()
        self.session.refresh_from_db()
        self.assertEqual(self.session.consecutive_failures, 1)


class TestHandleFleetPollFailure(TestCase):
    def setUp(self):
        self.operator = make_user_with_character("poll_failure_operator", 500302)
        self.fc_character = self.operator.profile.main_character
        self.session = FleetTrackingSession.objects.create(
            fc_character=self.fc_character, started_by=self.operator, fleet_id=1
        )

    def test_below_threshold_increments_and_keeps_session(self):
        _handle_fleet_poll_failure(self.session)
        self.assertTrue(FleetTrackingSession.objects.filter(pk=self.session.pk).exists())
        self.session.refresh_from_db()
        self.assertEqual(self.session.consecutive_failures, 1)

    def test_reaching_threshold_deletes_session_and_broadcasts(self):
        self.session.consecutive_failures = 2  # FLEET_SESSION_FAILURE_THRESHOLD - 1
        self.session.save(update_fields=["consecutive_failures"])
        session_id = self.session.id  # captured before delete() clears self.session.pk

        with patch("wh_mapper.tasks.broadcast_fleet_event") as mock_broadcast:
            _handle_fleet_poll_failure(self.session)

        self.assertFalse(FleetTrackingSession.objects.filter(pk=session_id).exists())
        mock_broadcast.assert_called_once_with(
            session_id, "fleet.session_ended", {"session_id": session_id}
        )


class TestFleetApi(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.backseat = make_user_with_character(
            "fleet_api_backseat", 500401, perms=("wh_mapper.basic_access", "wh_mapper.backseat_fc")
        )
        cls.second_backseat = make_user_with_character(
            "fleet_api_second_backseat",
            500404,
            perms=("wh_mapper.basic_access", "wh_mapper.backseat_fc"),
        )
        cls.no_perm = make_user_with_character("fleet_api_noperm", 500402)
        cls.fc_owner = make_user_with_character("fleet_api_fc_owner", 500403)
        cls.fc_character = cls.fc_owner.profile.main_character
        make_esi_location_token(
            cls.fc_owner, cls.fc_character.character_id, "FC Char", FLEET_SCOPES
        )

    def setUp(self):
        self.client.login(username="fleet_api_backseat", password="test-password")

    def test_permission_required_for_available_characters(self):
        self.client.logout()
        self.client.login(username="fleet_api_noperm", password="test-password")
        response = self.client.get("/wh-mapper/api/fleet/available-characters/")
        self.assertEqual(response.status_code, 403)

    def test_available_characters_lists_fleet_scoped_tokens(self):
        response = self.client.get("/wh-mapper/api/fleet/available-characters/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        character_ids = [c["character_id"] for c in body]
        self.assertIn(self.fc_character.character_id, character_ids)

    def test_start_session_not_fleet_boss_returns_403(self):
        fleet_info = SimpleNamespace(fleet_boss_id=999999, fleet_id=1)
        with patch("wh_mapper.api.fleet.esi") as mock_esi:
            mock_esi.client.Fleets.GetCharactersCharacterIdFleet.return_value.result.return_value = (
                fleet_info
            )
            response = self.client.post(
                f"/wh-mapper/api/fleet/sessions/{self.fc_character.character_id}/start/"
            )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(FleetTrackingSession.objects.exists())

    def test_start_session_creates_and_polls(self):
        fleet_info = SimpleNamespace(
            fleet_boss_id=self.fc_character.character_id, fleet_id=77
        )
        with (
            patch("wh_mapper.api.fleet.esi") as mock_esi,
            patch("wh_mapper.api.fleet.poll_fleet_session.apply_async") as mock_apply,
        ):
            mock_esi.client.Fleets.GetCharactersCharacterIdFleet.return_value.result.return_value = (
                fleet_info
            )
            response = self.client.post(
                f"/wh-mapper/api/fleet/sessions/{self.fc_character.character_id}/start/"
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["fleet_id"], 77)
        session = FleetTrackingSession.objects.get(fc_character=self.fc_character)
        mock_apply.assert_called_once_with(args=[session.id])

    def test_starting_an_already_tracked_character_attaches_as_watcher(self):
        session = FleetTrackingSession.objects.create(
            fc_character=self.fc_character, started_by=self.fc_owner, fleet_id=5
        )
        with patch("wh_mapper.api.fleet.esi") as mock_esi:
            response = self.client.post(
                f"/wh-mapper/api/fleet/sessions/{self.fc_character.character_id}/start/"
            )

        self.assertEqual(response.status_code, 200)
        mock_esi.client.Fleets.GetCharactersCharacterIdFleet.assert_not_called()
        self.assertTrue(
            FleetTrackingWatcher.objects.filter(session=session, user=self.backseat).exists()
        )

    def test_only_starter_can_stop_session(self):
        # Started by self.backseat (logged in via setUp) - a second,
        # different backseat-permitted operator can't stop it, only the
        # original starter can (ticket 07).
        session = FleetTrackingSession.objects.create(
            fc_character=self.fc_character, started_by=self.backseat, fleet_id=5
        )

        self.client.logout()
        self.client.login(username="fleet_api_second_backseat", password="test-password")
        response = self.client.delete(f"/wh-mapper/api/fleet/sessions/{session.id}/")
        self.assertEqual(response.status_code, 403)
        self.assertTrue(FleetTrackingSession.objects.filter(pk=session.pk).exists())

        self.client.logout()
        self.client.login(username="fleet_api_backseat", password="test-password")
        response = self.client.delete(f"/wh-mapper/api/fleet/sessions/{session.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(FleetTrackingSession.objects.filter(pk=session.pk).exists())

    def test_list_and_get_session(self):
        session = FleetTrackingSession.objects.create(
            fc_character=self.fc_character, started_by=self.fc_owner, fleet_id=5
        )

        response = self.client.get("/wh-mapper/api/fleet/sessions/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 1)

        response = self.client.get(f"/wh-mapper/api/fleet/sessions/{session.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], session.id)
