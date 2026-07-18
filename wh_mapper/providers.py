"""ESI providers"""

# Alliance Auth
from esi.openapi_clients import ESIClientProvider

# AA WH Mapper App
from wh_mapper import __title__, __version__

esi = ESIClientProvider(
    compatibility_date="2026-06-09",
    ua_appname=__title__,
    ua_version=__version__,
    ua_url="https://github.com/aaronkable/aa-wh-mapper",
    operations=[
        "GetCharactersCharacterIdLocation",
        "GetCharactersCharacterIdOnline",
        # Public, no token needed - see wh_mapper.tasks.refresh_system_sovereignty.
        "GetSovereigntySystems",
    ],
)
