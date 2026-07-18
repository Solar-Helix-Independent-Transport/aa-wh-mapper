"""WH Mapper API"""

# Third Party
from ninja import NinjaAPI
from ninja.security import django_auth

# Django
from django.conf import settings

# AA WH Mapper App
from wh_mapper import __version__
from wh_mapper.api import (
    connections,
    maps,
    regions,
    sharing,
    signatures,
    systems,
    tracking,
    wormhole_types,
)

api = NinjaAPI(
    title="YAWN API",
    version=__version__,
    urls_namespace="wh_mapper:api",
    auth=django_auth,
    openapi_url=settings.DEBUG and "/openapi.json" or "",
)

maps.setup(api)
systems.setup(api)
signatures.setup(api)
connections.setup(api)
sharing.setup(api)
tracking.setup(api)
regions.setup(api)
wormhole_types.setup(api)
