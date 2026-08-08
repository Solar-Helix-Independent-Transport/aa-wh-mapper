# Third Party
from ninja import NinjaAPI

# AA WH Mapper App
from wh_mapper.api import schema
from wh_mapper.api.helpers import app_status_to_schema, require_admin_access


class StatusApiEndpoints:
    """Admin-only app health/status - see wh_mapper.api.helpers.app_status_to_schema."""

    tags = ["Status"]

    def __init__(self, api: NinjaAPI):

        @api.get(
            "/status/",
            response={200: schema.AppStatusOut, 403: str},
            tags=self.tags,
        )
        def get_app_status(request):
            error = require_admin_access(request)
            if error:
                return error

            return app_status_to_schema()


def setup(api: NinjaAPI) -> None:
    """Register the admin status endpoint"""

    StatusApiEndpoints(api)
