# Third Party
from ninja import NinjaAPI

# AA WH Mapper App
from wh_mapper.api import schema
from wh_mapper.api.helpers import require_basic_access, wormhole_type_to_schema
from wh_mapper.models import WormholeType


class WormholeTypesApiEndpoints:
    """Read-only listing of the known wormhole type catalog"""

    tags = ["WormholeTypes"]

    def __init__(self, api: NinjaAPI):

        @api.get(
            "/wormhole-types/",
            response={200: list[schema.WormholeTypeOut], 403: str},
            tags=self.tags,
        )
        def list_wormhole_types(request):
            error = require_basic_access(request)
            if error:
                return error

            types = WormholeType.objects.all()  # already ordered by code via Meta.ordering

            return [wormhole_type_to_schema(t) for t in types]


def setup(api: NinjaAPI) -> None:
    """Register wormhole-type endpoints"""

    WormholeTypesApiEndpoints(api)
