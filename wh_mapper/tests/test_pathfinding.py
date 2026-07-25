"""Tests for wh_mapper.pathfinding"""

# Django
from django.test import TestCase

# AA WH Mapper App
from wh_mapper.models import Map, MapSystem, WormholeConnection
from wh_mapper.pathfinding import (
    ANSIBLEX_WEIGHT,
    STARGATE_WEIGHT,
    WORMHOLE_BASE_WEIGHT,
    build_graph,
    compute_route,
    wormhole_weight,
)
from wh_mapper.tests.factories import (
    make_solar_system,
    make_stargate,
    make_user_with_character,
)


class WormholeWeightTests(TestCase):
    """wormhole_weight's risk-scaled formula in isolation, no DB needed"""

    def test_best_case_is_base_weight(self):
        self.assertEqual(wormhole_weight("stable", "fresh"), WORMHOLE_BASE_WEIGHT)

    def test_worst_case(self):
        self.assertAlmostEqual(wormhole_weight("lt_1h", "critical"), 1.5 * 3.0 * 2.5)

    def test_unknown_mass_matches_critical(self):
        self.assertEqual(
            wormhole_weight("stable", "unknown"), wormhole_weight("stable", "critical")
        )

    def test_always_exceeds_stargate_weight(self):
        self.assertGreater(wormhole_weight("stable", "fresh"), STARGATE_WEIGHT)


class ComputeRouteTests(TestCase):
    def setUp(self):
        self.user = make_user_with_character("router", 900500)
        self.system_a = make_solar_system("Alpha")
        self.system_b = make_solar_system("Bravo")
        self.system_c = make_solar_system("Charlie")

    def test_start_equals_end(self):
        computation = compute_route(self.user, self.system_a.id, self.system_a.id)
        result = computation.primary
        self.assertTrue(result.found)
        self.assertEqual(result.system_ids, [self.system_a.id])
        self.assertEqual(result.legs, [])
        self.assertIsNone(computation.alternate)

    def test_no_route_found(self):
        computation = compute_route(self.user, self.system_a.id, self.system_b.id)
        self.assertFalse(computation.primary.found)
        self.assertEqual(computation.primary.system_ids, [])
        self.assertIsNone(computation.alternate)

    def test_direct_stargate_route(self):
        make_stargate(self.system_a, self.system_b)
        make_stargate(self.system_b, self.system_a)

        result = compute_route(self.user, self.system_a.id, self.system_b.id).primary

        self.assertTrue(result.found)
        self.assertEqual(result.system_ids, [self.system_a.id, self.system_b.id])
        self.assertEqual(len(result.legs), 1)
        self.assertEqual(result.legs[0].connection_type, "stargate")
        self.assertIsNone(result.legs[0].map_id)

    def test_wormhole_shortcut_preferred_over_longer_stargate_path(self):
        # A -> B -> C via stargates (2 hops, weight 2.0) vs a direct stable/
        # fresh wormhole A -> C (weight 1.5) - the wormhole should win.
        make_stargate(self.system_a, self.system_b)
        make_stargate(self.system_b, self.system_a)
        make_stargate(self.system_b, self.system_c)
        make_stargate(self.system_c, self.system_b)

        wh_map = Map.objects.create(name="Test Map", owner=self.user)
        map_system_a = MapSystem.objects.create(map=wh_map, solar_system=self.system_a)
        map_system_c = MapSystem.objects.create(map=wh_map, solar_system=self.system_c)
        WormholeConnection.objects.create(
            map=wh_map,
            connection_type=WormholeConnection.ConnectionType.WORMHOLE,
            top_system=map_system_a,
            bottom_system=map_system_c,
            life_status="stable",
            mass_status=WormholeConnection.MassStatus.FRESH,
        )

        result = compute_route(self.user, self.system_a.id, self.system_c.id).primary

        self.assertTrue(result.found)
        self.assertEqual(result.system_ids, [self.system_a.id, self.system_c.id])
        self.assertEqual(result.legs[0].connection_type, "wormhole")

    def test_wormhole_on_map_not_visible_to_user_is_excluded(self):
        other_user = make_user_with_character("other", 900501)
        other_map = Map.objects.create(name="Other Map", owner=other_user)
        map_system_a = MapSystem.objects.create(map=other_map, solar_system=self.system_a)
        map_system_b = MapSystem.objects.create(map=other_map, solar_system=self.system_b)
        WormholeConnection.objects.create(
            map=other_map,
            connection_type=WormholeConnection.ConnectionType.WORMHOLE,
            top_system=map_system_a,
            bottom_system=map_system_b,
        )

        result = compute_route(self.user, self.system_a.id, self.system_b.id).primary

        self.assertFalse(result.found)

    def test_alternate_surfaces_a_shorter_riskier_path(self):
        # A -> B -> C via stargates (2 safe hops) vs a direct but near-
        # collapse/critical-mass wormhole A -> C (1 risky hop, weight
        # 1.5 x 3.0 x 2.5 = 11.25 - much worse than the 2.0 safe path, so
        # the primary route avoids it, but it's still the fewer-hops
        # option and should surface as an alternate.
        make_stargate(self.system_a, self.system_b)
        make_stargate(self.system_b, self.system_a)
        make_stargate(self.system_b, self.system_c)
        make_stargate(self.system_c, self.system_b)

        wh_map = Map.objects.create(name="Test Map", owner=self.user)
        map_system_a = MapSystem.objects.create(map=wh_map, solar_system=self.system_a)
        map_system_c = MapSystem.objects.create(map=wh_map, solar_system=self.system_c)
        WormholeConnection.objects.create(
            map=wh_map,
            connection_type=WormholeConnection.ConnectionType.WORMHOLE,
            top_system=map_system_a,
            bottom_system=map_system_c,
            life_status="lt_1h",
            mass_status=WormholeConnection.MassStatus.CRITICAL,
        )

        computation = compute_route(self.user, self.system_a.id, self.system_c.id)

        self.assertEqual(
            computation.primary.system_ids, [self.system_a.id, self.system_b.id, self.system_c.id]
        )
        self.assertIsNotNone(computation.alternate)
        self.assertEqual(computation.alternate.system_ids, [self.system_a.id, self.system_c.id])
        self.assertEqual(computation.alternate.legs[0].connection_type, "wormhole")

    def test_no_alternate_when_primary_is_already_fewest_hops(self):
        make_stargate(self.system_a, self.system_b)
        make_stargate(self.system_b, self.system_a)

        computation = compute_route(self.user, self.system_a.id, self.system_b.id)

        self.assertIsNone(computation.alternate)

    def test_ansiblex_uses_flat_weight(self):
        wh_map = Map.objects.create(name="Test Map", owner=self.user)
        map_system_a = MapSystem.objects.create(map=wh_map, solar_system=self.system_a)
        map_system_b = MapSystem.objects.create(map=wh_map, solar_system=self.system_b)
        WormholeConnection.objects.create(
            map=wh_map,
            connection_type=WormholeConnection.ConnectionType.ANSIBLEX,
            top_system=map_system_a,
            bottom_system=map_system_b,
        )

        graph = build_graph(self.user)
        neighbors = graph[self.system_a.id]

        self.assertEqual(len(neighbors), 1)
        neighbor_id, weight, leg = neighbors[0]
        self.assertEqual(neighbor_id, self.system_b.id)
        self.assertEqual(weight, ANSIBLEX_WEIGHT)
        self.assertEqual(leg.connection_type, "ansiblex")
        self.assertIsNone(leg.life_status)

    def test_per_map_stargate_connection_rows_are_excluded_from_graph(self):
        # connection_type="stargate" WormholeConnection rows are a per-map
        # record of an auto-linked gate, not a separate graph edge - the
        # static Stargate table is the sole source of stargate edges.
        wh_map = Map.objects.create(name="Test Map", owner=self.user)
        map_system_a = MapSystem.objects.create(map=wh_map, solar_system=self.system_a)
        map_system_b = MapSystem.objects.create(map=wh_map, solar_system=self.system_b)
        WormholeConnection.objects.create(
            map=wh_map,
            connection_type=WormholeConnection.ConnectionType.STARGATE,
            top_system=map_system_a,
            bottom_system=map_system_b,
        )

        graph = build_graph(self.user)

        self.assertEqual(graph[self.system_a.id], [])
