# Third Party
# Django EvE SDE
# Third Party
from eve_sde.models import Region, SolarSystem
from ninja import NinjaAPI

# Django
from django.shortcuts import get_object_or_404

# AA WH Mapper App
from wh_mapper.api import schema
from wh_mapper.api.helpers import (
    auto_link_stargates_bulk,
    is_region_flat,
    list_flat_regions,
    region_to_schema,
    require_basic_access,
    require_visible_map,
)
from wh_mapper.broadcast import broadcast_map_event
from wh_mapper.constants import REGION_IMPORT_LAYOUT_SIZE
from wh_mapper.models import MapSystem


class RegionApiEndpoints:
    """Region listing + bulk map-population endpoints"""

    tags = ["Regions"]

    def __init__(self, api: NinjaAPI):

        @api.get(
            "/regions/", response={200: list[schema.RegionOut], 403: str}, tags=self.tags
        )
        def list_regions(request):
            error = require_basic_access(request)
            if error:
                return error

            regions = sorted(list_flat_regions(), key=lambda r: r.name)

            return [region_to_schema(r) for r in regions]

        @api.post(
            "/maps/{map_id}/import-region/",
            response={200: schema.RegionImportResult, 403: str, 404: str},
            tags=self.tags,
        )
        def import_region(request, map_id: int, payload: schema.RegionImportRequest):
            map_obj, error = require_visible_map(request, map_id)
            if error:
                return error

            region = get_object_or_404(Region, pk=payload.region_id)
            if not is_region_flat(region):
                return 404, "Region not available for import"

            solar_systems = list(
                SolarSystem.objects.filter(constellation__region=region)
            )
            if not solar_systems:
                return 404, "Region has no systems"

            xs = [s.x_2d for s in solar_systems if s.x_2d is not None]
            ys = [s.y_2d for s in solar_systems if s.y_2d is not None]
            min_x, max_x = (min(xs), max(xs)) if xs else (0, 0)
            min_y, max_y = (min(ys), max(ys)) if ys else (0, 0)
            span_x = (max_x - min_x) or 1
            span_y = (max_y - min_y) or 1

            def layout_position(solar_system):
                if solar_system.x_2d is None or solar_system.y_2d is None:
                    return 0.0, 0.0
                return (
                    (solar_system.x_2d - min_x) / span_x * REGION_IMPORT_LAYOUT_SIZE,
                    # SDE position2D is y-up (matches in-game/EVE region maps);
                    # the canvas is y-down, so flip to avoid an upside-down layout.
                    (max_y - solar_system.y_2d) / span_y * REGION_IMPORT_LAYOUT_SIZE,
                )

            # Batch-fetched + bulk_created rather than one get_or_create per
            # system: a full region is routinely dozens to hundreds of
            # systems, which would otherwise cost 1-2 sequential queries per
            # system in this synchronous request handler.
            existing_solar_system_ids = set(
                MapSystem.objects.filter(
                    map=map_obj, solar_system__in=solar_systems
                ).values_list("solar_system_id", flat=True)
            )

            to_create = []
            for solar_system in solar_systems:
                if solar_system.id in existing_solar_system_ids:
                    continue
                x, y = layout_position(solar_system)
                to_create.append(
                    MapSystem(
                        map=map_obj,
                        solar_system=solar_system,
                        x=x,
                        y=y,
                        added_by=request.user,
                    )
                )

            new_systems = []
            if to_create:
                MapSystem.objects.bulk_create(to_create)
                # Re-fetched rather than trusting bulk_create to populate pks
                # in place - not every DB backend returns them.
                new_systems = list(
                    MapSystem.objects.filter(
                        map=map_obj,
                        solar_system_id__in=[s.solar_system_id for s in to_create],
                    )
                )

            # A region import can add dozens/hundreds of systems and
            # connections - broadcasting one event per row (as the single-
            # system add path does) can exceed the channel layer's per-
            # channel capacity and get other connected clients' messages
            # dropped. Send one consolidated "resync" signal instead; the
            # frontend already knows how to fully refetch a map's state
            # (the same path it uses right after the websocket reconnects).
            connections_added = auto_link_stargates_bulk(
                map_obj, new_systems, request.user, broadcast=False
            )

            if new_systems or connections_added:
                broadcast_map_event(map_obj.id, "map.resync", {})

            return {
                "systems_added": len(new_systems),
                "connections_added": connections_added,
            }


def setup(api: NinjaAPI) -> None:
    """Register Region endpoints"""

    RegionApiEndpoints(api)
