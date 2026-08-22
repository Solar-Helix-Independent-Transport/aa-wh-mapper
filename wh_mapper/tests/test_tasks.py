"""Tests for wh_mapper's aging and location-tracking tasks"""

# Standard Library
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

# Third Party
# Django EvE SDE
from eve_sde.models import ItemCategory, ItemGroup, ItemType

# Django
from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone

# Alliance Auth
from allianceauth.eveonline.models import EveAllianceInfo, EveFactionInfo
from esi.exceptions import HTTPClientError, HTTPNotModified, HTTPServerError

# AA WH Mapper App
from wh_mapper.constants import (
    EVE_SCOUT_THERA_MAP_NAME,
    EVE_SCOUT_TURNUR_MAP_NAME,
    MAP_PRESENCE_STALE_AFTER_SECONDS,
    NEW_SYSTEM_OFFSET_X,
    THERA_SYSTEM_ID,
    TURNUR_SYSTEM_ID,
)
from wh_mapper.models import (
    Map,
    MapPresence,
    MapSystem,
    Signature,
    SystemSovereignty,
    TaskHeartbeat,
    TrackedCharacter,
    WormholeConnection,
    WormholeType,
)
from wh_mapper.tasks import (
    _apply_location_update,
    _character_is_online,
    age_wormhole_connections,
    poll_character_location,
    poll_tracked_character_locations,
    prune_stale_map_presence,
    refresh_system_sovereignty,
    sync_eve_scout_thera_turnur,
)
from wh_mapper.tests.factories import (
    make_solar_system,
    make_stargate,
    make_user_with_character,
)


class TestAgeWormholeConnections(TestCase):
    """TestAgeWormholeConnections"""

    @classmethod
    def setUpTestData(cls):
        cls.owner = make_user_with_character("task_owner", 400001)
        cls.map = Map.objects.create(name="Aging Map", owner=cls.owner)
        cls.top = make_solar_system("TaskTop", security_status=0.9)
        cls.bottom = make_solar_system(
            "TaskBottom", security_status=-1.0, wormhole_class_id_raw=3
        )
        cls.top_system = MapSystem.objects.create(map=cls.map, solar_system=cls.top)
        cls.bottom_system = MapSystem.objects.create(
            map=cls.map, solar_system=cls.bottom
        )

        category = ItemCategory.objects.create(id=400001, name="Celestial")
        group = ItemGroup.objects.create(id=988, name="Wormhole", category=category)
        item_type = ItemType.objects.create(id=40000001, name="Wormhole K162", group=group)
        cls.wormhole_type = WormholeType.objects.create(
            item_type=item_type, code="K162", max_stable_time=60
        )

    def _make_signature(self, **overrides):
        defaults = {
            "map_system": self.bottom_system,
            "signature_id": "ABC-123",
            "sig_type": Signature.SignatureType.WORMHOLE,
            "wormhole_type": self.wormhole_type,
            "life_status": Signature.LifeStatus.STABLE,
        }
        defaults.update(overrides)
        signature = Signature.objects.create(**defaults)
        return signature

    def test_known_type_signature_past_its_lifetime_is_pruned(self):
        signature = self._make_signature()
        Signature.objects.filter(pk=signature.pk).update(
            updated_at=timezone.now() - timedelta(minutes=61)
        )

        age_wormhole_connections()

        self.assertFalse(Signature.objects.filter(pk=signature.pk).exists())

    def test_fresh_known_type_signature_survives(self):
        signature = self._make_signature()

        age_wormhole_connections()

        self.assertTrue(Signature.objects.filter(pk=signature.pk).exists())

    def test_known_type_connection_past_its_lifetime_is_pruned(self):
        signature = self._make_signature()
        connection = WormholeConnection.objects.create(
            map=self.map,
            top_system=self.top_system,
            bottom_system=self.bottom_system,
            bottom_signature=signature,
        )
        WormholeConnection.objects.filter(pk=connection.pk).update(
            created_at=timezone.now() - timedelta(minutes=61)
        )

        age_wormhole_connections()

        self.assertFalse(WormholeConnection.objects.filter(pk=connection.pk).exists())

    def test_linked_signature_shares_its_connections_age_even_if_recently_edited(self):
        # Regression test: a signature linked to a connection must use the
        # connection's (immutable) created_at as its age reference, not its
        # own updated_at (which a recent, unrelated edit would have
        # refreshed) - otherwise the signature could look "stable" while its
        # connection (the same physical wormhole) is already long past its
        # lifetime.
        signature = self._make_signature()
        connection = WormholeConnection.objects.create(
            map=self.map,
            top_system=self.top_system,
            bottom_system=self.bottom_system,
            bottom_signature=signature,
        )
        WormholeConnection.objects.filter(pk=connection.pk).update(
            created_at=timezone.now() - timedelta(minutes=61)
        )
        # Simulate a recent, unrelated edit (e.g. fixing sig_type) bumping
        # updated_at well after the connection was actually created.
        Signature.objects.filter(pk=signature.pk).update(updated_at=timezone.now())

        age_wormhole_connections()

        self.assertFalse(Signature.objects.filter(pk=signature.pk).exists())

    def test_fresh_known_type_connection_survives(self):
        signature = self._make_signature()
        connection = WormholeConnection.objects.create(
            map=self.map,
            top_system=self.top_system,
            bottom_system=self.bottom_system,
            bottom_signature=signature,
        )

        age_wormhole_connections()

        self.assertTrue(WormholeConnection.objects.filter(pk=connection.pk).exists())

    def test_connection_without_wormhole_type_or_manual_pick_is_left_alone(self):
        connection = WormholeConnection.objects.create(
            map=self.map, top_system=self.top_system, bottom_system=self.bottom_system
        )
        WormholeConnection.objects.filter(pk=connection.pk).update(
            created_at=timezone.now() - timedelta(days=1)
        )

        age_wormhole_connections()

        self.assertTrue(WormholeConnection.objects.filter(pk=connection.pk).exists())

    def test_manual_bucket_signature_past_its_assumed_hours_is_pruned(self):
        signature = self._make_signature(
            wormhole_type=None, life_status=Signature.LifeStatus.LESS_THAN_1H
        )
        Signature.objects.filter(pk=signature.pk).update(
            life_status_marked_at=timezone.now() - timedelta(hours=1, minutes=1)
        )

        age_wormhole_connections()

        self.assertFalse(Signature.objects.filter(pk=signature.pk).exists())

    def test_manual_bucket_signature_within_its_assumed_hours_survives(self):
        signature = self._make_signature(
            wormhole_type=None, life_status=Signature.LifeStatus.LESS_THAN_48H
        )
        Signature.objects.filter(pk=signature.pk).update(
            life_status_marked_at=timezone.now() - timedelta(hours=47)
        )

        age_wormhole_connections()

        self.assertTrue(Signature.objects.filter(pk=signature.pk).exists())

    def test_manual_bucket_connection_past_its_assumed_hours_is_pruned(self):
        connection = WormholeConnection.objects.create(
            map=self.map,
            top_system=self.top_system,
            bottom_system=self.bottom_system,
            life_status=Signature.LifeStatus.LESS_THAN_1H,
        )
        WormholeConnection.objects.filter(pk=connection.pk).update(
            life_status_marked_at=timezone.now() - timedelta(hours=1, minutes=1)
        )

        age_wormhole_connections()

        self.assertFalse(WormholeConnection.objects.filter(pk=connection.pk).exists())

    def test_manual_bucket_connection_within_its_assumed_hours_survives(self):
        connection = WormholeConnection.objects.create(
            map=self.map,
            top_system=self.top_system,
            bottom_system=self.bottom_system,
            life_status=Signature.LifeStatus.LESS_THAN_48H,
        )
        WormholeConnection.objects.filter(pk=connection.pk).update(
            life_status_marked_at=timezone.now() - timedelta(hours=47)
        )

        age_wormhole_connections()

        self.assertTrue(WormholeConnection.objects.filter(pk=connection.pk).exists())


def _sov_result(entries):
    """Build a fake GetSovereigntySystems() result - `entries` is a list of
    (solar_system_id, variant) pairs, where variant is a SimpleNamespace
    with exactly one of `.alliance`/`.faction`/`.unclaimed` set.

    Each `claim` is wrapped in a `.root` layer, mirroring the real
    aiopenapi3/pydantic shape for an untagged oneOf (RootModel[Union[...]])
    - a live ESI response nests the actual variant one level deeper than
    the esi/stubs.pyi type names alone suggest, which
    wh_mapper.tasks.refresh_system_sovereignty must unwrap first."""

    return SimpleNamespace(
        solar_systems=[
            SimpleNamespace(solar_system_id=system_id, claim=SimpleNamespace(root=variant))
            for system_id, variant in entries
        ]
    )


class TestRefreshSystemSovereignty(TestCase):
    """TestRefreshSystemSovereignty"""

    def test_replaces_sovereignty_snapshot(self):
        SystemSovereignty.objects.create(solar_system_id=30000099, alliance_id=99000099)

        result = _sov_result(
            [
                (30000001, SimpleNamespace(alliance=SimpleNamespace(alliance_id=99000001))),
                (30000002, SimpleNamespace(faction=SimpleNamespace(faction_id=500001))),
                (30000003, SimpleNamespace(unclaimed=True)),
            ]
        )
        with (
            patch("wh_mapper.tasks.esi") as mock_esi,
            patch.object(EveAllianceInfo.objects, "get_or_create_esi") as mock_get_alliance,
            patch.object(EveFactionInfo.objects, "get_or_create_esi") as mock_get_faction,
        ):
            mock_esi.client.Sovereignty.GetSovereigntySystems.return_value.result.return_value = result
            refresh_system_sovereignty()

        # the stale row from before the refresh is gone, replaced wholesale
        self.assertFalse(SystemSovereignty.objects.filter(solar_system_id=30000099).exists())

        alliance_row = SystemSovereignty.objects.get(solar_system_id=30000001)
        self.assertEqual(alliance_row.alliance_id, 99000001)
        self.assertIsNone(alliance_row.faction_id)

        faction_row = SystemSovereignty.objects.get(solar_system_id=30000002)
        self.assertEqual(faction_row.faction_id, 500001)
        self.assertIsNone(faction_row.alliance_id)

        # unclaimed systems get no row at all
        self.assertFalse(SystemSovereignty.objects.filter(solar_system_id=30000003).exists())

        mock_get_alliance.assert_called_once_with(99000001)
        mock_get_faction.assert_called_once_with(500001)

    def test_second_run_replaces_rather_than_duplicates(self):
        result = _sov_result(
            [(30000001, SimpleNamespace(alliance=SimpleNamespace(alliance_id=99000001)))]
        )
        with (
            patch("wh_mapper.tasks.esi") as mock_esi,
            patch.object(EveAllianceInfo.objects, "get_or_create_esi"),
            patch.object(EveFactionInfo.objects, "get_or_create_esi"),
        ):
            mock_esi.client.Sovereignty.GetSovereigntySystems.return_value.result.return_value = result
            refresh_system_sovereignty()
            refresh_system_sovereignty()

        self.assertEqual(SystemSovereignty.objects.count(), 1)

    def test_esi_error_retries_instead_of_writing_anything(self):
        with (
            patch("wh_mapper.tasks.esi") as mock_esi,
            patch.object(EveAllianceInfo.objects, "get_or_create_esi") as mock_get_alliance,
        ):
            mock_esi.client.Sovereignty.GetSovereigntySystems.return_value.result.side_effect = (
                HTTPServerError(status_code=503, headers={}, data=None)
            )
            # self.retry() re-raises (there's no real broker/worker in this
            # test to actually schedule a retry against) - that's fine, the
            # point is it doesn't fall through and wipe/rewrite anything.
            with self.assertRaises(HTTPServerError):
                refresh_system_sovereignty()

        mock_get_alliance.assert_not_called()
        self.assertEqual(SystemSovereignty.objects.count(), 0)


class TestApplyLocationUpdate(TestCase):
    """TestApplyLocationUpdate"""

    @classmethod
    def setUpTestData(cls):
        cls.owner = make_user_with_character("location_owner", 410001)
        cls.map = Map.objects.create(name="Location Map", owner=cls.owner)
        cls.sys_a = make_solar_system("LocationA")
        cls.sys_b = make_solar_system("LocationB")

    def setUp(self):
        self.tracked = TrackedCharacter.objects.create(
            character=self.owner.profile.main_character, added_by=self.owner
        )
        MapPresence.objects.create(map=self.map, user=self.owner, channel_name="chan-apply")

    def test_first_poll_seeds_system_with_no_connection(self):
        _apply_location_update(self.tracked, self.sys_a)

        self.tracked.refresh_from_db()
        self.assertEqual(self.tracked.last_solar_system_id, self.sys_a.id)
        self.assertEqual(MapSystem.objects.filter(map=self.map).count(), 1)
        self.assertEqual(WormholeConnection.objects.filter(map=self.map).count(), 0)

    def test_jump_adds_system_and_connection(self):
        _apply_location_update(self.tracked, self.sys_a)
        _apply_location_update(self.tracked, self.sys_b)

        self.tracked.refresh_from_db()
        self.assertEqual(self.tracked.last_solar_system_id, self.sys_b.id)
        self.assertEqual(MapSystem.objects.filter(map=self.map).count(), 2)
        self.assertEqual(WormholeConnection.objects.filter(map=self.map).count(), 1)

    def test_jump_places_new_system_offset_right_and_level(self):
        _apply_location_update(self.tracked, self.sys_a)
        old_system = MapSystem.objects.get(map=self.map, solar_system=self.sys_a)
        old_system.x, old_system.y = 100, 200
        old_system.save(update_fields=["x", "y"])

        _apply_location_update(self.tracked, self.sys_b)

        new_system = MapSystem.objects.get(map=self.map, solar_system=self.sys_b)
        self.assertEqual(new_system.x, 100 + NEW_SYSTEM_OFFSET_X)
        self.assertEqual(new_system.y, 200)

    def test_jumping_back_does_not_duplicate_connection(self):
        _apply_location_update(self.tracked, self.sys_a)
        _apply_location_update(self.tracked, self.sys_b)
        _apply_location_update(self.tracked, self.sys_a)

        self.assertEqual(WormholeConnection.objects.filter(map=self.map).count(), 1)

    def test_no_change_only_updates_last_seen_at(self):
        _apply_location_update(self.tracked, self.sys_a)
        self.tracked.refresh_from_db()
        first_seen = self.tracked.last_seen_at

        _apply_location_update(self.tracked, self.sys_a)
        self.tracked.refresh_from_db()

        self.assertEqual(MapSystem.objects.filter(map=self.map).count(), 1)
        self.assertGreaterEqual(self.tracked.last_seen_at, first_seen)

    def test_jump_grows_every_map_owner_has_open(self):
        second_map = Map.objects.create(name="Second Open Map", owner=self.owner)
        MapPresence.objects.create(
            map=second_map, user=self.owner, channel_name="chan-apply-2"
        )

        _apply_location_update(self.tracked, self.sys_a)
        _apply_location_update(self.tracked, self.sys_b)

        self.assertEqual(MapSystem.objects.filter(map=self.map).count(), 2)
        self.assertEqual(WormholeConnection.objects.filter(map=self.map).count(), 1)
        self.assertEqual(MapSystem.objects.filter(map=second_map).count(), 2)
        self.assertEqual(WormholeConnection.objects.filter(map=second_map).count(), 1)

    def test_no_open_maps_still_updates_location_without_growing_anything(self):
        MapPresence.objects.filter(user=self.owner).delete()

        _apply_location_update(self.tracked, self.sys_a)

        self.tracked.refresh_from_db()
        self.assertEqual(self.tracked.last_solar_system_id, self.sys_a.id)
        self.assertEqual(MapSystem.objects.filter(map=self.map).count(), 0)

    def test_jump_through_wormhole_sends_signature_prompt_to_tracker_only(self):
        _apply_location_update(self.tracked, self.sys_a)

        with patch("wh_mapper.tasks.send_map_event_to_user") as mock_send:
            _apply_location_update(self.tracked, self.sys_b)

        connection = WormholeConnection.objects.get(map=self.map)
        old_map_system = MapSystem.objects.get(map=self.map, solar_system=self.sys_a)
        new_map_system = MapSystem.objects.get(map=self.map, solar_system=self.sys_b)
        mock_send.assert_called_once_with(
            self.map.id,
            self.tracked.added_by_id,
            "character.jump_needs_signature",
            {
                "connection_id": connection.id,
                "character_name": self.tracked.character.character_name,
                "old_map_system_id": old_map_system.id,
                "new_map_system_id": new_map_system.id,
            },
        )

    def test_jump_through_stargate_does_not_send_signature_prompt(self):
        make_stargate(self.sys_a, self.sys_b)
        _apply_location_update(self.tracked, self.sys_a)

        with patch("wh_mapper.tasks.send_map_event_to_user") as mock_send:
            _apply_location_update(self.tracked, self.sys_b)

        connection = WormholeConnection.objects.get(map=self.map)
        self.assertEqual(connection.connection_type, WormholeConnection.ConnectionType.STARGATE)
        mock_send.assert_not_called()


class TestPollTrackedCharacterLocations(TestCase):
    """TestPollTrackedCharacterLocations"""

    @classmethod
    def setUpTestData(cls):
        cls.online_user = make_user_with_character("poll_online", 420001)
        cls.offline_user = make_user_with_character("poll_offline", 420002)
        cls.online_map = Map.objects.create(name="Poll Online Map", owner=cls.online_user)
        cls.offline_map = Map.objects.create(name="Poll Offline Map", owner=cls.offline_user)

    def test_only_polls_characters_whose_owner_is_present(self):
        online_tracked = TrackedCharacter.objects.create(
            character=self.online_user.profile.main_character,
            added_by=self.online_user,
        )
        TrackedCharacter.objects.create(
            character=self.offline_user.profile.main_character,
            added_by=self.offline_user,
        )
        MapPresence.objects.create(
            map=self.online_map, user=self.online_user, channel_name="chan-1"
        )

        with (
            patch("wh_mapper.tasks.poll_character_location.apply_async") as mock_apply,
            patch(
                "wh_mapper.tasks.poll_tracked_character_locations.apply_async"
            ) as mock_reschedule,
        ):
            poll_tracked_character_locations()

        mock_apply.assert_called_once_with(args=[420001, [online_tracked.id]])
        mock_reschedule.assert_called_once_with(countdown=6)

    def test_no_presence_dispatches_nothing(self):
        TrackedCharacter.objects.create(
            character=self.online_user.profile.main_character,
            added_by=self.online_user,
        )

        with patch("wh_mapper.tasks.poll_character_location.apply_async") as mock_apply:
            poll_tracked_character_locations()

        mock_apply.assert_not_called()

    def test_no_work_does_not_self_reschedule(self):
        # presence exists, but no one online has a tracked character
        MapPresence.objects.create(
            map=self.online_map, user=self.online_user, channel_name="chan-2"
        )

        with (
            patch("wh_mapper.tasks.poll_character_location.apply_async"),
            patch(
                "wh_mapper.tasks.poll_tracked_character_locations.apply_async"
            ) as mock_reschedule,
        ):
            poll_tracked_character_locations()

        mock_reschedule.assert_not_called()

    def test_offline_characters_are_still_dispatched(self):
        # is_active now tracks *online* status, not row deletion - a
        # character confirmed offline last poll still needs to be dispatched
        # so poll_character_location can notice when they log back in.
        offline_tracked = TrackedCharacter.objects.create(
            character=self.online_user.profile.main_character,
            added_by=self.online_user,
            is_active=False,
        )
        MapPresence.objects.create(
            map=self.online_map, user=self.online_user, channel_name="chan-3"
        )

        with (
            patch("wh_mapper.tasks.poll_character_location.apply_async") as mock_apply,
            patch("wh_mapper.tasks.poll_tracked_character_locations.apply_async"),
        ):
            poll_tracked_character_locations()

        mock_apply.assert_called_once_with(args=[420001, [offline_tracked.id]])


class TestPruneStaleMapPresence(TestCase):
    """TestPruneStaleMapPresence"""

    @classmethod
    def setUpTestData(cls):
        cls.user = make_user_with_character("prune_presence", 430001)
        cls.map = Map.objects.create(name="Prune Presence Map", owner=cls.user)

    def test_stale_row_is_deleted(self):
        stale = MapPresence.objects.create(
            map=self.map, user=self.user, channel_name="chan-stale"
        )
        stale.last_seen_at = timezone.now() - timedelta(
            seconds=MAP_PRESENCE_STALE_AFTER_SECONDS + 1
        )
        stale.save(update_fields=["last_seen_at"])

        with patch("wh_mapper.tasks.get_channel_layer", return_value=None):
            prune_stale_map_presence()

        self.assertFalse(MapPresence.objects.filter(pk=stale.pk).exists())

    def test_fresh_row_survives(self):
        fresh = MapPresence.objects.create(
            map=self.map, user=self.user, channel_name="chan-fresh"
        )

        with patch("wh_mapper.tasks.get_channel_layer", return_value=None):
            prune_stale_map_presence()

        self.assertTrue(MapPresence.objects.filter(pk=fresh.pk).exists())

    def test_stale_row_discards_its_channel_layer_group_membership(self):
        stale = MapPresence.objects.create(
            map=self.map, user=self.user, channel_name="chan-stale-group"
        )
        stale.last_seen_at = timezone.now() - timedelta(
            seconds=MAP_PRESENCE_STALE_AFTER_SECONDS + 1
        )
        stale.save(update_fields=["last_seen_at"])

        mock_layer = SimpleNamespace(group_discard=lambda *_args, **_kwargs: None)
        with patch("wh_mapper.tasks.get_channel_layer", return_value=mock_layer):
            with patch("wh_mapper.tasks.async_to_sync") as mock_async_to_sync:
                prune_stale_map_presence()

        mock_async_to_sync.assert_called_once_with(mock_layer.group_discard)


class TestCharacterIsOnline(TestCase):
    """TestCharacterIsOnline"""

    def test_online_true(self):
        with patch("wh_mapper.tasks.esi") as mock_esi:
            mock_esi.client.Location.GetCharactersCharacterIdOnline.return_value.result.return_value = (
                SimpleNamespace(online=True)
            )
            result = _character_is_online(500001, token=object(), last_known=False)

        self.assertIs(result, True)

    def test_online_false(self):
        with patch("wh_mapper.tasks.esi") as mock_esi:
            mock_esi.client.Location.GetCharactersCharacterIdOnline.return_value.result.return_value = (
                SimpleNamespace(online=False)
            )
            result = _character_is_online(500002, token=object(), last_known=True)

        self.assertIs(result, False)

    def test_not_modified_with_no_prior_state_returns_none(self):
        with patch("wh_mapper.tasks.esi") as mock_esi:
            mock_esi.client.Location.GetCharactersCharacterIdOnline.return_value.result.side_effect = (
                HTTPNotModified(status_code=304, headers={})
            )
            result = _character_is_online(500003, token=object(), last_known=None)

        self.assertIsNone(result)

    def test_not_modified_reuses_last_known_offline_state(self):
        with patch("wh_mapper.tasks.esi") as mock_esi:
            mock_esi.client.Location.GetCharactersCharacterIdOnline.return_value.result.side_effect = (
                HTTPNotModified(status_code=304, headers={})
            )
            result = _character_is_online(500004, token=object(), last_known=False)

        self.assertIs(result, False)

    def test_not_modified_reuses_last_known_online_state(self):
        with patch("wh_mapper.tasks.esi") as mock_esi:
            mock_esi.client.Location.GetCharactersCharacterIdOnline.return_value.result.side_effect = (
                HTTPNotModified(status_code=304, headers={})
            )
            result = _character_is_online(500005, token=object(), last_known=True)

        self.assertIs(result, True)

    def test_http_error_is_treated_as_unknown(self):
        with patch("wh_mapper.tasks.esi") as mock_esi:
            mock_esi.client.Location.GetCharactersCharacterIdOnline.return_value.result.side_effect = (
                HTTPServerError(status_code=503, headers={}, data=None)
            )
            result = _character_is_online(500006, token=object(), last_known=True)

        self.assertIsNone(result)


class TestPollCharacterLocation(TestCase):
    """TestPollCharacterLocation"""

    @classmethod
    def setUpTestData(cls):
        cls.owner = make_user_with_character("poll_char_owner", 430001)
        cls.map = Map.objects.create(name="Poll Char Map", owner=cls.owner)
        cls.sys_a = make_solar_system("PollCharSysA")

    def setUp(self):
        self.tracked = TrackedCharacter.objects.create(
            character=self.owner.profile.main_character, added_by=self.owner
        )
        MapPresence.objects.create(map=self.map, user=self.owner, channel_name="chan-poll-char")

    def test_confirmed_offline_skips_location_lookup(self):
        with (
            patch("wh_mapper.tasks.Token.get_token", return_value=object()),
            patch("wh_mapper.tasks._character_is_online", return_value=False),
            patch("wh_mapper.tasks.esi") as mock_esi,
        ):
            poll_character_location(430001, [self.tracked.id])

        mock_esi.client.Location.GetCharactersCharacterIdLocation.assert_not_called()

    def test_unknown_online_status_still_polls_location(self):
        with (
            patch("wh_mapper.tasks.Token.get_token", return_value=object()),
            patch("wh_mapper.tasks._character_is_online", return_value=None),
            patch("wh_mapper.tasks.esi") as mock_esi,
        ):
            mock_esi.client.Location.GetCharactersCharacterIdLocation.return_value.result.return_value = (
                SimpleNamespace(solar_system_id=self.sys_a.id)
            )
            poll_character_location(430001, [self.tracked.id])

        self.tracked.refresh_from_db()
        self.assertEqual(self.tracked.last_solar_system_id, self.sys_a.id)

    def test_location_not_modified_only_bumps_last_seen_at(self):
        self.tracked.last_solar_system = self.sys_a
        self.tracked.save(update_fields=["last_solar_system"])

        with (
            patch("wh_mapper.tasks.Token.get_token", return_value=object()),
            patch("wh_mapper.tasks._character_is_online", return_value=True),
            patch("wh_mapper.tasks.esi") as mock_esi,
        ):
            mock_esi.client.Location.GetCharactersCharacterIdLocation.return_value.result.side_effect = (
                HTTPNotModified(status_code=304, headers={})
            )
            poll_character_location(430001, [self.tracked.id])

        self.tracked.refresh_from_db()
        self.assertEqual(self.tracked.last_solar_system_id, self.sys_a.id)
        self.assertIsNotNone(self.tracked.last_seen_at)

    def test_location_http_error_does_not_raise(self):
        with (
            patch("wh_mapper.tasks.Token.get_token", return_value=object()),
            patch("wh_mapper.tasks._character_is_online", return_value=True),
            patch("wh_mapper.tasks.esi") as mock_esi,
        ):
            mock_esi.client.Location.GetCharactersCharacterIdLocation.return_value.result.side_effect = (
                HTTPClientError(status_code=404, headers={}, data=None)
            )
            poll_character_location(430001, [self.tracked.id])

        self.tracked.refresh_from_db()
        self.assertIsNone(self.tracked.last_solar_system_id)

    def test_going_offline_persists_is_active_false(self):
        self.assertTrue(self.tracked.is_active)

        with (
            patch("wh_mapper.tasks.Token.get_token", return_value=object()),
            patch("wh_mapper.tasks._character_is_online", return_value=False) as mock_online,
            patch("wh_mapper.tasks.esi") as mock_esi,
        ):
            poll_character_location(430001, [self.tracked.id])

        # last_known passed in was the row's current is_active (True)
        self.assertEqual(mock_online.call_args.args[0], 430001)
        self.assertIs(mock_online.call_args.args[2], True)
        mock_esi.client.Location.GetCharactersCharacterIdLocation.assert_not_called()

        self.tracked.refresh_from_db()
        self.assertFalse(self.tracked.is_active)

    def test_coming_back_online_persists_is_active_true(self):
        self.tracked.is_active = False
        self.tracked.save(update_fields=["is_active"])

        with (
            patch("wh_mapper.tasks.Token.get_token", return_value=object()),
            patch("wh_mapper.tasks._character_is_online", return_value=True),
            patch("wh_mapper.tasks.esi") as mock_esi,
        ):
            mock_esi.client.Location.GetCharactersCharacterIdLocation.return_value.result.return_value = (
                SimpleNamespace(solar_system_id=self.sys_a.id)
            )
            poll_character_location(430001, [self.tracked.id])

        self.tracked.refresh_from_db()
        self.assertTrue(self.tracked.is_active)
        self.assertEqual(self.tracked.last_solar_system_id, self.sys_a.id)

    def test_going_offline_broadcasts_character_removed_to_open_maps(self):
        with (
            patch("wh_mapper.tasks.Token.get_token", return_value=object()),
            patch("wh_mapper.tasks._character_is_online", return_value=False),
            patch("wh_mapper.tasks.esi"),
            patch("wh_mapper.tasks.broadcast_map_event") as mock_broadcast,
        ):
            poll_character_location(430001, [self.tracked.id])

        mock_broadcast.assert_called_once_with(
            self.map.id, "character.removed", {"character_id": 430001}
        )

    def test_coming_back_online_broadcasts_character_moved_to_open_maps(self):
        self.tracked.is_active = False
        self.tracked.save(update_fields=["is_active"])

        with (
            patch("wh_mapper.tasks.Token.get_token", return_value=object()),
            patch("wh_mapper.tasks._character_is_online", return_value=True),
            patch("wh_mapper.tasks.esi") as mock_esi,
            patch("wh_mapper.tasks.broadcast_map_event") as mock_broadcast,
        ):
            mock_esi.client.Location.GetCharactersCharacterIdLocation.return_value.result.return_value = (
                SimpleNamespace(solar_system_id=self.sys_a.id)
            )
            poll_character_location(430001, [self.tracked.id])

        # The online-state transition broadcasts once with the pre-poll
        # (possibly stale) payload; the subsequent location update then
        # broadcasts again once the fresh system is known.
        online_transition_calls = [
            call for call in mock_broadcast.call_args_list if call.args[1] == "character.moved"
        ]
        self.assertTrue(online_transition_calls)
        self.assertTrue(all(call.args[0] == self.map.id for call in online_transition_calls))


class TestSyncEveScoutTheraTurnur(TestCase):
    """TestSyncEveScoutTheraTurnur"""

    def setUp(self):
        self.owner = User.objects.create_superuser(
            "evescoutowner", "owner@example.com", "test-password"
        )
        self.thera_hub = make_solar_system(
            "Thera", id=THERA_SYSTEM_ID, security_status=None
        )
        self.turnur_hub = make_solar_system(
            "Turnur", id=TURNUR_SYSTEM_ID, security_status=0.5
        )
        self.thera_far = make_solar_system("EveScoutFarThera", security_status=0.5)
        self.turnur_far = make_solar_system("EveScoutFarTurnur", security_status=0.5)

        category = ItemCategory.objects.create(id=410001, name="Celestial")
        group = ItemGroup.objects.create(id=989, name="Wormhole", category=category)
        item_type = ItemType.objects.create(
            id=40010001, name="Wormhole P060", group=group
        )
        self.wormhole_type = WormholeType.objects.create(
            item_type=item_type, code="P060", max_stable_time=16
        )

    def _thera_row(self, **overrides):
        row = {
            "out_signature": "abc-123",
            "out_system_id": THERA_SYSTEM_ID,
            "out_system_name": "Thera",
            "in_system_id": self.thera_far.id,
            "in_system_name": self.thera_far.name,
            "wh_exits_outward": True,
            "wh_type": "P060",
            "max_ship_size": "large",
            "remaining_hours": 10,
        }
        row.update(overrides)
        return row

    def _turnur_row(self, **overrides):
        row = {
            "out_signature": "xyz-789",
            "out_system_id": TURNUR_SYSTEM_ID,
            "out_system_name": "Turnur",
            "in_system_id": self.turnur_far.id,
            "in_system_name": self.turnur_far.name,
            "wh_exits_outward": False,
            "wh_type": "K162",
            "max_ship_size": "xlarge",
            "remaining_hours": 2,
        }
        row.update(overrides)
        return row

    @patch("wh_mapper.tasks.httpx.get")
    def test_creates_thera_and_turnur_reference_maps(self, mock_get):
        mock_get.return_value.json.return_value = [
            self._thera_row(),
            self._turnur_row(),
        ]

        sync_eve_scout_thera_turnur()

        thera_map = Map.objects.get(name=EVE_SCOUT_THERA_MAP_NAME)
        turnur_map = Map.objects.get(name=EVE_SCOUT_TURNUR_MAP_NAME)
        self.assertTrue(thera_map.read_only)
        self.assertTrue(turnur_map.read_only)
        self.assertEqual(thera_map.owner_id, self.owner.id)
        self.assertEqual(turnur_map.owner_id, self.owner.id)

        self.assertEqual(MapSystem.objects.filter(map=thera_map).count(), 2)
        self.assertEqual(MapSystem.objects.filter(map=turnur_map).count(), 2)

        # wh_exits_outward=True - the given wh_type describes the hub-side
        # signature, so it gets resolved.
        thera_sig = Signature.objects.get(
            map_system__map=thera_map, signature_id="ABC-123"
        )
        self.assertEqual(thera_sig.wormhole_type_id, self.wormhole_type.id)
        self.assertEqual(thera_sig.life_status, Signature.LifeStatus.LESS_THAN_12H)

        # wh_exits_outward=False - the hub side is actually the K162 end, so
        # no wormhole_type is resolved even though wh_type was given.
        turnur_sig = Signature.objects.get(
            map_system__map=turnur_map, signature_id="XYZ-789"
        )
        self.assertIsNone(turnur_sig.wormhole_type_id)
        self.assertEqual(turnur_sig.life_status, Signature.LifeStatus.LESS_THAN_4H)

        thera_connection = WormholeConnection.objects.get(map=thera_map)
        self.assertEqual(thera_connection.ship_size_limit, "large")
        thera_connection_system_ids = {
            thera_connection.top_system.solar_system_id,
            thera_connection.bottom_system.solar_system_id,
        }
        self.assertEqual(
            thera_connection_system_ids, {THERA_SYSTEM_ID, self.thera_far.id}
        )

        turnur_connection = WormholeConnection.objects.get(map=turnur_map)
        self.assertEqual(turnur_connection.ship_size_limit, "xlarge")

    @patch("wh_mapper.tasks.httpx.get")
    def test_second_poll_prunes_signatures_no_longer_live(self, mock_get):
        mock_get.return_value.json.return_value = [self._thera_row()]
        sync_eve_scout_thera_turnur()

        thera_map = Map.objects.get(name=EVE_SCOUT_THERA_MAP_NAME)
        self.assertEqual(Signature.objects.filter(map_system__map=thera_map).count(), 1)
        self.assertEqual(WormholeConnection.objects.filter(map=thera_map).count(), 1)
        self.assertEqual(MapSystem.objects.filter(map=thera_map).count(), 2)

        # eve-scout's feed no longer reports this signature - it expired,
        # completed, or was deleted upstream.
        mock_get.return_value.json.return_value = []
        sync_eve_scout_thera_turnur()

        self.assertEqual(Signature.objects.filter(map_system__map=thera_map).count(), 0)
        self.assertEqual(WormholeConnection.objects.filter(map=thera_map).count(), 0)
        # The far-end system is pruned too (no remaining connections); the
        # hub system itself stays.
        self.assertEqual(MapSystem.objects.filter(map=thera_map).count(), 1)

    @patch("wh_mapper.tasks.httpx.get")
    def test_re_polling_the_same_signature_does_not_duplicate_anything(self, mock_get):
        mock_get.return_value.json.return_value = [self._thera_row()]
        sync_eve_scout_thera_turnur()
        sync_eve_scout_thera_turnur()

        thera_map = Map.objects.get(name=EVE_SCOUT_THERA_MAP_NAME)
        self.assertEqual(Signature.objects.filter(map_system__map=thera_map).count(), 1)
        self.assertEqual(WormholeConnection.objects.filter(map=thera_map).count(), 1)
        self.assertEqual(MapSystem.objects.filter(map=thera_map).count(), 2)

    @patch("wh_mapper.tasks.httpx.get")
    def test_fetch_failure_records_a_failed_heartbeat_and_creates_nothing(
        self, mock_get
    ):
        mock_get.return_value.raise_for_status.side_effect = Exception("boom")

        with self.assertRaises(Exception):
            sync_eve_scout_thera_turnur()

        self.assertFalse(Map.objects.filter(name=EVE_SCOUT_THERA_MAP_NAME).exists())
        heartbeat = TaskHeartbeat.objects.get(task_name="sync_eve_scout_thera_turnur")
        self.assertFalse(heartbeat.last_success)

    @patch("wh_mapper.tasks.httpx.get")
    def test_no_superuser_skips_sync_without_raising(self, mock_get):
        self.owner.delete()
        mock_get.return_value.json.return_value = [self._thera_row()]

        sync_eve_scout_thera_turnur()

        self.assertFalse(Map.objects.filter(name=EVE_SCOUT_THERA_MAP_NAME).exists())
