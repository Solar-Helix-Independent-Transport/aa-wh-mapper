"""Weighted shortest-path route computation across the universe's static
stargate network plus wormhole/ansiblex connections merged from every Map
visible to a user.

Weights and rationale are locked decisions from the route-planner wayfinder
map (.scratch/route-planner/map.md, tickets 02/03/05) - see there for the
full "why", not repeated here as comments.
"""

# Standard Library
import heapq
from collections import defaultdict, deque
from dataclasses import dataclass

# Third Party
# Django EvE SDE
from eve_sde.models import Stargate

# AA WH Mapper App
from wh_mapper.models import Map, WormholeConnection

STARGATE_WEIGHT = 1.0
ANSIBLEX_WEIGHT = 1.2
WORMHOLE_BASE_WEIGHT = 1.5

LIFE_STATUS_MULTIPLIER = {
    "stable": 1.0,
    "lt_48h": 1.2,
    "lt_24h": 1.4,
    "lt_12h": 1.7,
    "lt_4h": 2.2,
    "lt_1h": 3.0,
}

MASS_STATUS_MULTIPLIER = {
    "fresh": 1.0,
    "reduced": 1.5,
    "critical": 2.5,
    # Unknown mass is treated as worst-case, same as critical - routing
    # risk should default to caution when data is missing.
    "unknown": 2.5,
}


def wormhole_weight(life_status: str, mass_status: str) -> float:
    """weight = 1.5 x life_multiplier x mass_multiplier, multiplicative so
    the two risk dimensions compound - a connection both near-collapse and
    mass-critical is worse than either alone."""

    life_multiplier = LIFE_STATUS_MULTIPLIER.get(life_status, LIFE_STATUS_MULTIPLIER["stable"])
    mass_multiplier = MASS_STATUS_MULTIPLIER.get(mass_status, MASS_STATUS_MULTIPLIER["unknown"])
    return WORMHOLE_BASE_WEIGHT * life_multiplier * mass_multiplier


@dataclass(frozen=True)
class RouteLeg:
    """One hop of a computed route. map_id/connection_id are None for a
    stargate leg (sourced from the static universe, not any Map)."""

    connection_type: str
    life_status: str | None
    mass_status: str | None
    map_id: int | None
    connection_id: int | None


@dataclass
class RouteResult:
    found: bool
    system_ids: list[int]
    legs: list[RouteLeg]


Graph = dict[int, list[tuple[int, float, RouteLeg]]]


def build_graph(user) -> Graph:
    """Adjacency list: system_id -> [(neighbor_id, weight, leg), ...].

    Stargate edges come solely from the static eve_sde universe data (each
    real in-game gate pairing is stored as two one-directional Stargate
    rows, so a single pass adds both directions with no manual mirroring
    needed) - always available, independent of any Map. Wormhole/ansiblex
    edges are merged from every Map visible_to the user; per-map
    connection_type="stargate" rows are skipped since the static Stargate
    table is already the source of truth for that connectivity and a
    per-map row would just be a redundant duplicate edge.
    """

    graph: Graph = defaultdict(list)

    for source_id, dest_id in Stargate.objects.values_list("solar_system_id", "destination_id"):
        leg = RouteLeg("stargate", None, None, None, None)
        graph[source_id].append((dest_id, STARGATE_WEIGHT, leg))

    visible_map_ids = Map.objects.visible_to(user).values_list("id", flat=True)
    connections = (
        WormholeConnection.objects.filter(map_id__in=visible_map_ids)
        .exclude(connection_type=WormholeConnection.ConnectionType.STARGATE)
        .select_related("top_system", "bottom_system")
    )

    for connection in connections:
        top_id = connection.top_system.solar_system_id
        bottom_id = connection.bottom_system.solar_system_id
        connection_type = str(connection.connection_type)

        if connection_type == WormholeConnection.ConnectionType.ANSIBLEX:
            weight = ANSIBLEX_WEIGHT
            leg_life_status = None
            leg_mass_status = None
        else:
            leg_life_status = str(connection.life_status)
            leg_mass_status = str(connection.mass_status)
            weight = wormhole_weight(leg_life_status, leg_mass_status)

        leg = RouteLeg(
            connection_type, leg_life_status, leg_mass_status, connection.map_id, connection.id
        )
        graph[top_id].append((bottom_id, weight, leg))
        graph[bottom_id].append((top_id, weight, leg))

    return graph


def _reconstruct(
    previous: dict[int, tuple[int, RouteLeg]], start_id: int, end_id: int
) -> RouteResult:
    system_ids = [end_id]
    legs: list[RouteLeg] = []
    current = end_id
    while current != start_id:
        prev_node, leg = previous[current]
        legs.append(leg)
        system_ids.append(prev_node)
        current = prev_node

    system_ids.reverse()
    legs.reverse()
    return RouteResult(found=True, system_ids=system_ids, legs=legs)


def shortest_path(graph: Graph, start_id: int, end_id: int) -> RouteResult:
    """Dijkstra's algorithm, weighted per build_graph's risk-scaled edges
    (tickets 02/03/05). Multiple parallel edges between the same pair (e.g.
    two separate wormholes connecting the same systems) need no special
    handling - relaxation naturally keeps whichever is cheapest."""

    if start_id == end_id:
        return RouteResult(found=True, system_ids=[start_id], legs=[])

    distances: dict[int, float] = {start_id: 0.0}
    previous: dict[int, tuple[int, RouteLeg]] = {}
    visited: set[int] = set()
    queue: list[tuple[float, int]] = [(0.0, start_id)]

    while queue:
        dist, node = heapq.heappop(queue)
        if node in visited:
            continue
        visited.add(node)
        if node == end_id:
            break
        for neighbor, weight, leg in graph.get(node, []):
            if neighbor in visited:
                continue
            new_dist = dist + weight
            if new_dist < distances.get(neighbor, float("inf")):
                distances[neighbor] = new_dist
                previous[neighbor] = (node, leg)
                heapq.heappush(queue, (new_dist, neighbor))

    if end_id not in distances:
        return RouteResult(found=False, system_ids=[], legs=[])

    return _reconstruct(previous, start_id, end_id)


def shortest_path_by_hops(graph: Graph, start_id: int, end_id: int) -> RouteResult:
    """Plain BFS, ignoring risk weighting entirely (every edge costs one
    hop) - the "fastest, ignoring risk" alternative that shortest_path's
    risk-weighted route may have passed over in favor of a longer, safer
    one. Reachability is identical to shortest_path's (weights never affect
    *whether* a node is reachable, only which path among reachable ones
    wins), so this only ever disagrees with shortest_path on which path,
    never on found/not-found."""

    if start_id == end_id:
        return RouteResult(found=True, system_ids=[start_id], legs=[])

    visited: set[int] = {start_id}
    previous: dict[int, tuple[int, RouteLeg]] = {}
    queue: deque[int] = deque([start_id])

    while queue:
        node = queue.popleft()
        if node == end_id:
            break
        for neighbor, _weight, leg in graph.get(node, []):
            if neighbor in visited:
                continue
            visited.add(neighbor)
            previous[neighbor] = (node, leg)
            queue.append(neighbor)

    if end_id not in visited:
        return RouteResult(found=False, system_ids=[], legs=[])

    return _reconstruct(previous, start_id, end_id)


@dataclass
class RouteComputation:
    primary: RouteResult
    # A strictly-shorter (fewer hops), risk-ignoring alternative, only
    # populated when one actually exists and beats the primary route's hop
    # count - see ticket-08-style "surface, don't silently choose for the
    # user" reasoning in the wayfinder map's follow-up ticket for this.
    alternate: RouteResult | None


def compute_route(user, start_id: int, end_id: int) -> RouteComputation:
    graph = build_graph(user)
    primary = shortest_path(graph, start_id, end_id)

    alternate = None
    if primary.found:
        by_hops = shortest_path_by_hops(graph, start_id, end_id)
        if by_hops.found and len(by_hops.legs) < len(primary.legs):
            alternate = by_hops

    return RouteComputation(primary=primary, alternate=alternate)
