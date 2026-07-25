# Third Party
from ninja import NinjaAPI

# Django
from django.utils import timezone

# AA WH Mapper App
from wh_mapper.api import schema
from wh_mapper.api.helpers import (
    get_visible_route,
    recompute_route,
    require_basic_access,
    route_result_to_schema,
    shared_route_to_schema,
)
from wh_mapper.models import Route
from wh_mapper.pathfinding import compute_route


class RouteApiEndpoints:
    """On-demand, stateless route computation - see the wayfinder map at
    .scratch/route-planner/map.md (tickets 02/03/04/05/07) for the design
    this implements. No caching: the graph is small enough (per ticket 01's
    findings) to build fresh on every request."""

    tags = ["Route"]

    def __init__(self, api: NinjaAPI):

        @api.get(
            "/route/",
            response={200: schema.RouteOut, 403: str},
            tags=self.tags,
        )
        def get_route(request, start_id: int, end_id: int):
            error = require_basic_access(request)
            if error:
                return error

            computation = compute_route(request.user, start_id, end_id)
            return route_result_to_schema(computation)

        @api.post(
            "/route/shared/",
            response={200: schema.SharedRouteOut, 403: str},
            tags=self.tags,
        )
        def share_route(request, payload: schema.RouteCreate):
            """Promote a computation into a persisted, live-updating Route -
            "Share this route" (ticket 09). Computed immediately from the
            owner's own visible-map graph, same as an on-demand lookup."""

            error = require_basic_access(request)
            if error:
                return error

            route = Route.objects.create(
                owner=request.user,
                start_system_id=payload.start_id,
                end_system_id=payload.end_id,
                visibility=Route.Visibility.SHARED,
            )
            recompute_route(route)

            return shared_route_to_schema(route, request)

        @api.get(
            "/route/shared/{route_id}/",
            response={200: schema.SharedRouteOut, 403: str, 404: str},
            tags=self.tags,
        )
        def get_shared_route(request, route_id: int):
            error = require_basic_access(request)
            if error:
                return error

            route, error = get_visible_route(request, route_id)
            if error:
                return error

            route.last_viewed_at = timezone.now()
            route.save(update_fields=["last_viewed_at"])

            return shared_route_to_schema(route, request)

        @api.delete(
            "/route/shared/{route_id}/",
            response={204: None, 403: str, 404: str},
            tags=self.tags,
        )
        def delete_shared_route(request, route_id: int):
            error = require_basic_access(request)
            if error:
                return error

            route, error = get_visible_route(request, route_id)
            if error:
                return error

            if route.owner_id != request.user.id:
                return 403, "Only the route's owner can delete it"

            route.delete()

            return 204, None


def setup(api: NinjaAPI) -> None:
    RouteApiEndpoints(api)
