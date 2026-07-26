"""Tests for wh_mapper.api.helpers pure logic"""

# Standard Library
from datetime import timedelta
from unittest.mock import patch

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
from django.contrib.auth.models import AnonymousUser
from django.db import IntegrityError, connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

# Alliance Auth
from allianceauth.eveonline.models import EveAllianceInfo, EveFactionInfo

# AA WH Mapper App
from wh_mapper.api.helpers import (
    _contributors_for_connection_ids,
    apply_life_status,
    bulk_system_owners,
    connection_effective_life_status,
    connection_time_status,
    get_or_create_connection,
    life_status_for_remaining_hours,
    list_flat_regions,
    map_last_updated,
    record_contribution,
    remaining_life_hours,
    signature_reference_time,
    space_type_label,
    stargate_connects,
)
from wh_mapper.constants import UNKNOWN_STABLE_MAX_HOURS
from wh_mapper.models import (
    Map,
    MapContribution,
    MapSystem,
    Signature,
    SystemSovereignty,
    WormholeConnection,
    WormholeType,
)
from wh_mapper.tests.factories import (
    make_solar_system,
    make_stargate,
    make_user_with_character,
)


class TestApplyLifeStatus(TestCase):
    """TestApplyLifeStatus"""

    def test_marking_a_bucket_stamps_life_status_marked_at(self):
        signature = Signature(life_status=Signature.LifeStatus.STABLE)

        apply_life_status(signature, Signature.LifeStatus.LESS_THAN_4H)

        self.assertEqual(signature.life_status, Signature.LifeStatus.LESS_THAN_4H)
        self.assertIsNotNone(signature.life_status_marked_at)

    def test_marking_stable_stamps_life_status_marked_at(self):
        signature = Signature(
            life_status=Signature.LifeStatus.LESS_THAN_4H, life_status_marked_at=timezone.now()
        )

        apply_life_status(signature, Signature.LifeStatus.STABLE)

        self.assertEqual(signature.life_status, Signature.LifeStatus.STABLE)
        self.assertIsNotNone(signature.life_status_marked_at)

    def test_works_on_wormhole_connection_too(self):
        connection = WormholeConnection(life_status=Signature.LifeStatus.STABLE)

        apply_life_status(connection, Signature.LifeStatus.LESS_THAN_1H)

        self.assertEqual(connection.life_status, Signature.LifeStatus.LESS_THAN_1H)
        self.assertIsNotNone(connection.life_status_marked_at)


class TestLifeStatusForRemainingHours(TestCase):
    """TestLifeStatusForRemainingHours"""

    def test_plenty_of_time_left_is_stable(self):
        self.assertEqual(life_status_for_remaining_hours(72), Signature.LifeStatus.STABLE)

    def test_exactly_on_a_boundary_takes_that_bucket(self):
        self.assertEqual(life_status_for_remaining_hours(48), Signature.LifeStatus.LESS_THAN_48H)
        self.assertEqual(life_status_for_remaining_hours(24), Signature.LifeStatus.LESS_THAN_24H)
        self.assertEqual(life_status_for_remaining_hours(12), Signature.LifeStatus.LESS_THAN_12H)
        self.assertEqual(life_status_for_remaining_hours(4), Signature.LifeStatus.LESS_THAN_4H)
        self.assertEqual(life_status_for_remaining_hours(1), Signature.LifeStatus.LESS_THAN_1H)

    def test_between_boundaries_takes_the_larger_bucket(self):
        self.assertEqual(life_status_for_remaining_hours(30), Signature.LifeStatus.LESS_THAN_48H)
        self.assertEqual(life_status_for_remaining_hours(2), Signature.LifeStatus.LESS_THAN_4H)

    def test_negative_remaining_is_still_less_than_1h(self):
        self.assertEqual(life_status_for_remaining_hours(-5), Signature.LifeStatus.LESS_THAN_1H)


class TestRemainingLifeHours(TestCase):
    """TestRemainingLifeHours"""

    def setUp(self):
        category = ItemCategory.objects.create(id=888001, name="Celestial")
        group = ItemGroup.objects.create(id=988, name="Wormhole", category=category)
        item_type = ItemType.objects.create(id=40000888, name="Wormhole K162", group=group)
        self.wormhole_type = WormholeType.objects.create(
            item_type=item_type, code="K162", max_stable_time=1440
        )

    def test_known_type_computes_from_reference_time(self):
        now = timezone.now()
        reference_time = now - timedelta(hours=20)

        remaining = remaining_life_hours(
            Signature.LifeStatus.STABLE, None, self.wormhole_type, reference_time, now
        )

        self.assertAlmostEqual(remaining, 4, places=2)

    def test_known_type_ignores_manual_bucket_and_marked_at(self):
        now = timezone.now()
        reference_time = now - timedelta(hours=20)
        marked_at = now - timedelta(hours=47)

        remaining = remaining_life_hours(
            Signature.LifeStatus.LESS_THAN_1H, marked_at, self.wormhole_type, reference_time, now
        )

        self.assertAlmostEqual(remaining, 4, places=2)

    def test_unknown_type_falls_back_to_manual_bucket_and_marked_at(self):
        now = timezone.now()
        marked_at = now - timedelta(hours=20)

        remaining = remaining_life_hours(
            Signature.LifeStatus.LESS_THAN_48H, marked_at, None, now, now
        )

        self.assertAlmostEqual(remaining, 28, places=2)

    def test_unknown_type_and_no_manual_pick_is_none(self):
        now = timezone.now()

        remaining = remaining_life_hours(Signature.LifeStatus.STABLE, None, None, now, now)

        self.assertIsNone(remaining)

    def test_unidentified_stable_counts_down_from_the_assumed_max(self):
        now = timezone.now()
        marked_at = now - timedelta(hours=10)

        remaining = remaining_life_hours(Signature.LifeStatus.STABLE, marked_at, None, now, now)

        self.assertAlmostEqual(remaining, UNKNOWN_STABLE_MAX_HOURS - 10, places=2)


class TestConnectionEffectiveLifeStatus(TestCase):
    """TestConnectionEffectiveLifeStatus"""

    @classmethod
    def setUpTestData(cls):
        cls.owner = make_user_with_character("effective_status_owner", 500101)
        cls.map = Map.objects.create(name="Effective Status Map", owner=cls.owner)
        cls.top_system = MapSystem.objects.create(
            map=cls.map, solar_system=make_solar_system("EffectiveStatusA")
        )
        cls.bottom_system = MapSystem.objects.create(
            map=cls.map, solar_system=make_solar_system("EffectiveStatusB")
        )

    def test_known_type_computes_bucket_from_age(self):
        category = ItemCategory.objects.create(id=888002, name="Celestial")
        group = ItemGroup.objects.create(id=988, name="Wormhole", category=category)
        item_type = ItemType.objects.create(id=40000889, name="Wormhole K162", group=group)
        wormhole_type = WormholeType.objects.create(
            item_type=item_type, code="K162", max_stable_time=600
        )
        signature = Signature.objects.create(
            map_system=self.bottom_system,
            signature_id="ABC-123",
            sig_type=Signature.SignatureType.WORMHOLE,
            wormhole_type=wormhole_type,
        )
        connection = WormholeConnection.objects.create(
            map=self.map,
            top_system=self.top_system,
            bottom_system=self.bottom_system,
            bottom_signature=signature,
        )
        WormholeConnection.objects.filter(pk=connection.pk).update(
            created_at=timezone.now() - timedelta(hours=9)
        )
        connection.refresh_from_db()

        # max_stable_time=600min=10h, 9h elapsed -> 1h remaining -> lt_1h
        self.assertEqual(connection_effective_life_status(connection), Signature.LifeStatus.LESS_THAN_1H)

    def test_unknown_type_returns_manual_bucket_unchanged(self):
        connection = WormholeConnection.objects.create(
            map=self.map,
            top_system=self.top_system,
            bottom_system=self.bottom_system,
            life_status=Signature.LifeStatus.LESS_THAN_24H,
            life_status_marked_at=timezone.now(),
        )

        self.assertEqual(
            connection_effective_life_status(connection), Signature.LifeStatus.LESS_THAN_24H
        )

    def test_unidentified_stable_ages_into_the_ladder_over_time(self):
        connection = WormholeConnection.objects.create(
            map=self.map,
            top_system=self.top_system,
            bottom_system=self.bottom_system,
            life_status=Signature.LifeStatus.STABLE,
            life_status_marked_at=timezone.now() - timedelta(hours=UNKNOWN_STABLE_MAX_HOURS - 8),
        )

        # 8 of the assumed 48h remaining -> squarely in the lt_12h bucket,
        # not still "stable" - see apply_life_status's stamping-not-clearing
        # of life_status_marked_at for stable.
        self.assertEqual(
            connection_effective_life_status(connection), Signature.LifeStatus.LESS_THAN_12H
        )


class TestSignatureReferenceTime(TestCase):
    """TestSignatureReferenceTime"""

    @classmethod
    def setUpTestData(cls):
        cls.owner = make_user_with_character("reference_time_owner", 500201)
        cls.map = Map.objects.create(name="Reference Time Map", owner=cls.owner)
        cls.top_system = MapSystem.objects.create(
            map=cls.map, solar_system=make_solar_system("ReferenceTimeA")
        )
        cls.bottom_system = MapSystem.objects.create(
            map=cls.map, solar_system=make_solar_system("ReferenceTimeB")
        )

    def test_unlinked_signature_falls_back_to_its_own_updated_at(self):
        signature = Signature.objects.create(
            map_system=self.bottom_system,
            signature_id="ABC-123",
            sig_type=Signature.SignatureType.WORMHOLE,
        )

        self.assertEqual(signature_reference_time(signature), signature.updated_at)

    def test_linked_signature_uses_its_connections_created_at_instead(self):
        # The core of the bug this fixes: a signature edited (and so
        # updated_at-bumped) well after its connection was created must
        # still report the connection's created_at, not its own more-recent
        # updated_at.
        signature = Signature.objects.create(
            map_system=self.bottom_system,
            signature_id="ABC-123",
            sig_type=Signature.SignatureType.WORMHOLE,
        )
        connection = WormholeConnection.objects.create(
            map=self.map,
            top_system=self.top_system,
            bottom_system=self.bottom_system,
            bottom_signature=signature,
        )
        WormholeConnection.objects.filter(pk=connection.pk).update(
            created_at=timezone.now() - timedelta(hours=10)
        )
        connection.refresh_from_db()
        Signature.objects.filter(pk=signature.pk).update(updated_at=timezone.now())
        signature.refresh_from_db()

        self.assertEqual(signature_reference_time(signature), connection.created_at)

    def test_linked_as_top_signature_also_uses_the_connections_created_at(self):
        signature = Signature.objects.create(
            map_system=self.top_system,
            signature_id="XYZ-789",
            sig_type=Signature.SignatureType.WORMHOLE,
        )
        connection = WormholeConnection.objects.create(
            map=self.map,
            top_system=self.top_system,
            bottom_system=self.bottom_system,
            top_signature=signature,
        )

        self.assertEqual(signature_reference_time(signature), connection.created_at)


class TestBulkSystemOwners(TestCase):
    """TestBulkSystemOwners"""

    def test_empire_system_resolves_via_static_faction_id_raw(self):
        faction = EveFactionInfo.objects.create(faction_id=500001, faction_name="Caldari State")
        system = make_solar_system("Empire System", faction_id_raw=500001)

        owners = bulk_system_owners([system])

        self.assertEqual(
            owners[system.id],
            {
                "type": "faction",
                "id": 500001,
                "name": "Caldari State",
                "ticker": None,
                "icon_url": faction.logo_url_64,
            },
        )

    def test_null_sec_system_resolves_via_sovereignty_row(self):
        alliance = EveAllianceInfo.objects.create(
            alliance_id=99000001, alliance_name="Test Alliance", alliance_ticker="TEST"
        )
        system = make_solar_system("Sov System")
        SystemSovereignty.objects.create(solar_system_id=system.id, alliance_id=99000001)

        owners = bulk_system_owners([system])

        self.assertEqual(
            owners[system.id],
            {
                "type": "alliance",
                "id": 99000001,
                "name": "Test Alliance",
                "ticker": "TEST",
                "icon_url": alliance.logo_url_64,
            },
        )

    def test_sovereignty_row_takes_precedence_over_static_faction(self):
        alliance = EveAllianceInfo.objects.create(
            alliance_id=99000002, alliance_name="Precedence Alliance", alliance_ticker="PREC"
        )
        EveFactionInfo.objects.create(faction_id=500002, faction_name="Some Faction")
        system = make_solar_system("Precedence System", faction_id_raw=500002)
        SystemSovereignty.objects.create(solar_system_id=system.id, alliance_id=99000002)

        owners = bulk_system_owners([system])

        self.assertEqual(owners[system.id]["type"], "alliance")
        self.assertEqual(owners[system.id]["id"], alliance.alliance_id)

    def test_unclaimed_and_wormhole_systems_have_no_owner(self):
        unclaimed = make_solar_system("Unclaimed Null")
        wormhole = make_solar_system("J123456", id=31000001, wormhole_class_id_raw=3)

        owners = bulk_system_owners([unclaimed, wormhole])

        self.assertIsNone(owners[unclaimed.id])
        self.assertIsNone(owners[wormhole.id])

    def test_never_seen_faction_is_resolved_once_and_reused(self):
        system_a = make_solar_system("Fallback A", faction_id_raw=500003)
        system_b = make_solar_system("Fallback B", faction_id_raw=500003)
        fetched_faction = EveFactionInfo(faction_id=500003, faction_name="Fetched Faction")

        with patch.object(
            EveFactionInfo.objects, "get_or_create_esi", return_value=fetched_faction
        ) as mock_get_or_create:
            owners = bulk_system_owners([system_a, system_b])

        mock_get_or_create.assert_called_once_with(500003)
        self.assertEqual(owners[system_a.id]["name"], "Fetched Faction")
        self.assertEqual(owners[system_b.id]["name"], "Fetched Faction")

    def test_esi_failure_degrades_to_no_owner_instead_of_raising(self):
        system = make_solar_system("ESI Down System", faction_id_raw=500005)

        with patch.object(
            EveFactionInfo.objects, "get_or_create_esi", side_effect=OSError("ESI unreachable")
        ):
            owners = bulk_system_owners([system])

        self.assertIsNone(owners[system.id])

    def test_batched_regardless_of_system_count(self):
        EveFactionInfo.objects.create(faction_id=500004, faction_name="Batch Faction")
        systems = [
            make_solar_system(f"Batch System {i}", faction_id_raw=500004) for i in range(5)
        ]

        with CaptureQueriesContext(connection) as small_batch:
            bulk_system_owners(systems[:1])
        with CaptureQueriesContext(connection) as large_batch:
            bulk_system_owners(systems)

        self.assertEqual(len(small_batch.captured_queries), len(large_batch.captured_queries))


class TestSpaceTypeLabel(TestCase):
    """TestSpaceTypeLabel"""

    def test_wormhole_system(self):
        system = make_solar_system(
            "WH Test", id=31000002, security_status=-1.0, wormhole_class_id_raw=3
        )
        self.assertEqual(space_type_label(system), "Wormhole")

    def test_low_sec_kspace_system_with_wormhole_class_id_is_not_a_wormhole(self):
        # CCP's SDE sets wormhole_class_id_raw on k-space systems too (e.g. 8
        # for low-sec) - a real system like Hophib. Only the J-space ID range
        # should make space_type_label call something a "Wormhole".
        system = make_solar_system(
            "Hophib-like", security_status=0.029, wormhole_class_id_raw=8
        )
        self.assertEqual(space_type_label(system), "Low Sec")

    def test_high_sec(self):
        system = make_solar_system("High Sec Test", security_status=0.9)
        self.assertEqual(space_type_label(system), "High Sec")

    def test_low_sec(self):
        system = make_solar_system("Low Sec Test", security_status=0.3)
        self.assertEqual(space_type_label(system), "Low Sec")

    def test_null_sec(self):
        system = make_solar_system("Null Sec Test", security_status=-0.2)
        self.assertEqual(space_type_label(system), "Null Sec")

    def test_unknown_when_security_status_missing(self):
        system = make_solar_system("Unknown Test", security_status=None)
        self.assertEqual(space_type_label(system), "Unknown")

    def test_high_sec_boundary(self):
        system = make_solar_system("Boundary Test", security_status=0.45)
        self.assertEqual(space_type_label(system), "High Sec")


class TestConnectionTimeStatus(TestCase):
    """TestConnectionTimeStatus"""

    @classmethod
    def setUpTestData(cls):
        cls.owner = make_user_with_character("time_status_owner", 500001)
        cls.map = Map.objects.create(name="Time Status Map", owner=cls.owner)
        cls.top_system = MapSystem.objects.create(
            map=cls.map, solar_system=make_solar_system("TimeStatusA")
        )
        cls.bottom_system = MapSystem.objects.create(
            map=cls.map, solar_system=make_solar_system("TimeStatusB")
        )

        category = ItemCategory.objects.create(id=777001, name="Celestial")
        group = ItemGroup.objects.create(id=988, name="Wormhole", category=category)
        item_type = ItemType.objects.create(id=40000777, name="Wormhole K162", group=group)
        cls.wormhole_type = WormholeType.objects.create(
            item_type=item_type, code="K162", max_stable_time=1600
        )

    def _make_connection(self, age_minutes, life_status=Signature.LifeStatus.STABLE, wormhole_type=None):
        signature = Signature.objects.create(
            map_system=self.bottom_system,
            signature_id="ABC-123",
            sig_type=Signature.SignatureType.WORMHOLE,
            wormhole_type=wormhole_type,
        )
        connection = WormholeConnection.objects.create(
            map=self.map,
            top_system=self.top_system,
            bottom_system=self.bottom_system,
            bottom_signature=signature,
            life_status=life_status,
        )
        WormholeConnection.objects.filter(pk=connection.pk).update(
            created_at=timezone.now() - timedelta(minutes=age_minutes)
        )
        connection.refresh_from_db()
        return connection

    def test_fresh_connection_is_green(self):
        connection = self._make_connection(age_minutes=10, wormhole_type=self.wormhole_type)
        self.assertEqual(connection_time_status(connection), "green")

    def test_aging_connection_is_orange(self):
        # 1600 * 0.6 = 960 minutes elapsed -> 60% of max_stable_time
        connection = self._make_connection(age_minutes=960, wormhole_type=self.wormhole_type)
        self.assertEqual(connection_time_status(connection), "orange")

    def test_near_expiry_connection_is_red(self):
        # 1600 * 0.9 = 1440 minutes elapsed -> 90% of max_stable_time
        connection = self._make_connection(age_minutes=1440, wormhole_type=self.wormhole_type)
        self.assertEqual(connection_time_status(connection), "red")

    def test_manual_life_status_is_ignored_once_type_is_known(self):
        # Once the wormhole type is identified, life_status is computed
        # purely from real elapsed time vs its max_stable_time - a stale
        # manual bucket (e.g. picked before the type was known) no longer
        # has any effect.
        connection = self._make_connection(
            age_minutes=10,
            life_status=Signature.LifeStatus.LESS_THAN_1H,
            wormhole_type=self.wormhole_type,
        )
        self.assertEqual(connection_time_status(connection), "green")

    def test_manual_critical_bucket_is_red_when_type_unknown(self):
        connection = self._make_connection(
            age_minutes=5, life_status=Signature.LifeStatus.LESS_THAN_1H, wormhole_type=None
        )
        self.assertEqual(connection_time_status(connection), "red")

    def test_unknown_wormhole_type_is_unknown(self):
        connection = self._make_connection(age_minutes=5, wormhole_type=None)
        self.assertEqual(connection_time_status(connection), "unknown")


class TestGetOrCreateConnection(TestCase):
    """TestGetOrCreateConnection"""

    def setUp(self):
        self.user = make_user_with_character("gocc_user", 260001)
        self.map = Map.objects.create(name="GOCC Map", owner=self.user)
        self.system_a = MapSystem.objects.create(
            map=self.map, solar_system=make_solar_system("GOCC A")
        )
        self.system_b = MapSystem.objects.create(
            map=self.map, solar_system=make_solar_system("GOCC B")
        )

    def test_canonicalizes_pair_regardless_of_argument_order(self):
        first, created = get_or_create_connection(
            self.map.id, self.system_a, self.system_b, self.user
        )
        self.assertTrue(created)

        second, created_again = get_or_create_connection(
            self.map.id, self.system_b, self.system_a, self.user
        )

        self.assertFalse(created_again)
        self.assertEqual(first.id, second.id)
        self.assertEqual(WormholeConnection.objects.filter(map=self.map).count(), 1)

    def test_concurrent_create_falls_back_to_the_winning_row(self):
        real_create = WormholeConnection.objects.create

        def racing_create(**kwargs):
            # Simulates another request's row landing first (between this
            # call's existence check and its own create()) - this call's
            # own create() then hits the unique constraint and must fall
            # back to fetching that row instead of raising.
            real_create(**kwargs)
            raise IntegrityError

        with patch.object(WormholeConnection.objects, "create", side_effect=racing_create):
            connection, created = get_or_create_connection(
                self.map.id, self.system_a, self.system_b, self.user
            )

        self.assertFalse(created)
        self.assertEqual(WormholeConnection.objects.filter(map=self.map).count(), 1)
        self.assertEqual(connection.top_system_id, self.system_a.id)
        self.assertEqual(connection.bottom_system_id, self.system_b.id)


class TestStargateConnects(TestCase):
    """TestStargateConnects"""

    def test_true_in_the_stargate_s_own_direction(self):
        jita = make_solar_system("StargateJita")
        perimeter = make_solar_system("StargatePerimeter")
        make_stargate(jita, perimeter)

        self.assertTrue(stargate_connects(jita, perimeter))

    def test_true_in_reverse_direction_too(self):
        # a stargate row only records one direction (source -> destination),
        # but in-game gates are always paired, so either query order counts.
        jita = make_solar_system("StargateJita2")
        perimeter = make_solar_system("StargatePerimeter2")
        make_stargate(jita, perimeter)

        self.assertTrue(stargate_connects(perimeter, jita))

    def test_false_for_unconnected_systems(self):
        jita = make_solar_system("StargateJita3")
        amarr = make_solar_system("StargateAmarr3")

        self.assertFalse(stargate_connects(jita, amarr))


class TestListFlatRegions(TestCase):
    """TestListFlatRegions"""

    def test_kspace_region_is_included(self):
        system = make_solar_system("FlatRegionTest", security_status=0.5)
        region_ids = [r.id for r in list_flat_regions()]
        self.assertIn(system.constellation.region_id, region_ids)

    def test_wormhole_region_is_excluded(self):
        # a real J-space id (31_000_000-32_000_000) is what actually marks a
        # region as wormhole space, not its own wormhole_class_id_raw - see
        # space_type_label's note on the same quirk for individual systems.
        system = make_solar_system(
            "WhRegionTest", id=31000030, security_status=-1.0, wormhole_class_id_raw=3
        )
        region_ids = [r.id for r in list_flat_regions()]
        self.assertNotIn(system.constellation.region_id, region_ids)

    def test_pochven_is_included(self):
        # Pochven's own wormhole_class_id_raw is set (25, per CCP's SDE),
        # but unlike J-space it's a normal, fixed, geographically-laid-out
        # region (real system ids, real x_2d/y_2d) - so it should still be
        # importable, distinguished from actual wormhole regions purely by
        # its systems' ordinary (non 31_000_000-32_000_000) ids.
        pochven_region_id = 10000070
        region = Region.objects.create(id=pochven_region_id, name="Pochven")
        constellation = Constellation.objects.create(
            id=990101, name="Pochven Constellation", region=region
        )
        SolarSystem.objects.create(
            id=990102,
            name="PochvenSystem",
            constellation=constellation,
            security_status=-1.0,
            wormhole_class_id_raw=25,
        )

        region_ids = [r.id for r in list_flat_regions()]
        self.assertIn(pochven_region_id, region_ids)


class TestMapLastUpdated(TestCase):
    """TestMapLastUpdated"""

    def setUp(self):
        self.user = make_user_with_character("maplastupdated", 900700)
        self.map_obj = Map.objects.create(name="Test Map", owner=self.user)
        self.system_a = make_solar_system("Alpha")
        self.system_b = make_solar_system("Bravo")

    def test_falls_back_to_created_at_for_an_empty_map(self):
        self.assertEqual(map_last_updated(self.map_obj), self.map_obj.created_at)

    def test_reflects_a_recently_added_system(self):
        MapSystem.objects.create(map=self.map_obj, solar_system=self.system_a)

        result = map_last_updated(self.map_obj)

        self.assertGreater(result, self.map_obj.created_at)

    def test_reflects_the_most_recent_connection_edit_over_an_older_system_add(self):
        top = MapSystem.objects.create(map=self.map_obj, solar_system=self.system_a)
        bottom = MapSystem.objects.create(map=self.map_obj, solar_system=self.system_b)
        connection = WormholeConnection.objects.create(
            map=self.map_obj, top_system=top, bottom_system=bottom
        )

        # Backdate the systems (bypassing auto_now_add via .update(), which
        # skips save()) so the connection's own auto_now updated_at is
        # unambiguously the most recent of the three.
        old = timezone.now() - timedelta(days=2)
        MapSystem.objects.filter(pk__in=[top.pk, bottom.pk]).update(added_at=old)

        result = map_last_updated(self.map_obj)

        connection.refresh_from_db()
        self.assertEqual(result, connection.updated_at)
        self.assertGreater(result, old)

    def test_reflects_a_signature_edit_on_the_map(self):
        top = MapSystem.objects.create(map=self.map_obj, solar_system=self.system_a)
        old = timezone.now() - timedelta(days=2)
        MapSystem.objects.filter(pk=top.pk).update(added_at=old)

        signature = Signature.objects.create(map_system=top, signature_id="ABC-123")

        result = map_last_updated(self.map_obj)

        signature.refresh_from_db()
        self.assertEqual(result, signature.updated_at)


class TestRecordContribution(TestCase):
    """TestRecordContribution"""

    def setUp(self):
        self.alice = make_user_with_character("contrib_alice", 900801)
        self.map_obj = Map.objects.create(name="Test Map", owner=self.alice)
        self.system_a = make_solar_system("Alpha")
        self.system_b = make_solar_system("Bravo")
        self.top = MapSystem.objects.create(map=self.map_obj, solar_system=self.system_a)
        self.bottom = MapSystem.objects.create(map=self.map_obj, solar_system=self.system_b)

    def test_records_a_wormhole_contribution_with_the_actor_s_main_character(self):
        connection = WormholeConnection.objects.create(
            map=self.map_obj,
            connection_type=WormholeConnection.ConnectionType.WORMHOLE,
            top_system=self.top,
            bottom_system=self.bottom,
        )

        record_contribution(connection, self.alice, MapContribution.Verb.ADDED)

        contribution = MapContribution.objects.get()
        self.assertEqual(contribution.connection_id, connection.id)
        self.assertEqual(contribution.map_id, self.map_obj.id)
        self.assertEqual(contribution.verb, MapContribution.Verb.ADDED)
        self.assertEqual(contribution.character_id, self.alice.profile.main_character_id)
        self.assertEqual(contribution.user_id, self.alice.id)

    def test_stargate_connections_are_never_credited(self):
        connection = WormholeConnection.objects.create(
            map=self.map_obj,
            connection_type=WormholeConnection.ConnectionType.STARGATE,
            top_system=self.top,
            bottom_system=self.bottom,
        )

        record_contribution(connection, self.alice, MapContribution.Verb.ADDED)

        self.assertFalse(MapContribution.objects.exists())

    def test_ansiblex_connections_are_never_credited(self):
        connection = WormholeConnection.objects.create(
            map=self.map_obj,
            connection_type=WormholeConnection.ConnectionType.ANSIBLEX,
            top_system=self.top,
            bottom_system=self.bottom,
        )

        record_contribution(connection, self.alice, MapContribution.Verb.ADDED)

        self.assertFalse(MapContribution.objects.exists())

    def test_unauthenticated_actor_is_never_credited(self):
        connection = WormholeConnection.objects.create(
            map=self.map_obj,
            connection_type=WormholeConnection.ConnectionType.WORMHOLE,
            top_system=self.top,
            bottom_system=self.bottom,
        )

        record_contribution(connection, AnonymousUser(), MapContribution.Verb.ADDED)

        self.assertFalse(MapContribution.objects.exists())


class TestContributorsForConnectionIds(TestCase):
    """TestContributorsForConnectionIds"""

    def setUp(self):
        self.alice = make_user_with_character("contrib_route_alice", 900810)
        self.bob = make_user_with_character("contrib_route_bob", 900811)
        self.map_obj = Map.objects.create(name="Test Map", owner=self.alice)
        top = MapSystem.objects.create(map=self.map_obj, solar_system=make_solar_system("A2"))
        bottom = MapSystem.objects.create(map=self.map_obj, solar_system=make_solar_system("B2"))
        self.connection = WormholeConnection.objects.create(
            map=self.map_obj,
            connection_type=WormholeConnection.ConnectionType.WORMHOLE,
            top_system=top,
            bottom_system=bottom,
        )

    def test_empty_connection_ids_returns_empty_list(self):
        self.assertEqual(_contributors_for_connection_ids([]), [])
        self.assertEqual(_contributors_for_connection_ids([None]), [])

    def test_counts_and_sorts_by_contribution_count_descending(self):
        record_contribution(self.connection, self.alice, MapContribution.Verb.ADDED)
        record_contribution(self.connection, self.alice, MapContribution.Verb.UPDATED)
        record_contribution(self.connection, self.bob, MapContribution.Verb.SIGNATURE_LINKED)

        contributors = _contributors_for_connection_ids([self.connection.id])

        self.assertEqual(
            contributors,
            [
                {
                    "character_id": self.alice.profile.main_character_id,
                    "name": self.alice.profile.main_character.character_name,
                    "contribution_count": 2,
                },
                {
                    "character_id": self.bob.profile.main_character_id,
                    "name": self.bob.profile.main_character.character_name,
                    "contribution_count": 1,
                },
            ],
        )

    def test_falls_back_to_username_when_actor_has_no_main_character(self):
        no_main = make_user_with_character("contrib_route_nomain", 900812)
        no_main.profile.main_character = None
        no_main.profile.save()

        record_contribution(self.connection, no_main, MapContribution.Verb.ADDED)

        contributors = _contributors_for_connection_ids([self.connection.id])

        self.assertEqual(
            contributors,
            [{"character_id": None, "name": "contrib_route_nomain", "contribution_count": 1}],
        )
