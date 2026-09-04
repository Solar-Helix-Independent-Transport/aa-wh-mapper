"""ESI providers"""

# Alliance Auth
from esi.models import Token
from esi.openapi_clients import ESIClientProvider

# AA WH Mapper App
from wh_mapper import __compat_date__, __title__, __url__, __version__

esi = ESIClientProvider(
    compatibility_date=__compat_date__,
    ua_appname=__title__,
    ua_version=__version__,
    ua_url=__url__,
    operations=[
        "GetCharactersCharacterIdLocation",
        "GetCharactersCharacterIdOnline",
        # Public, no token needed - see wh_mapper.tasks.refresh_system_sovereignty.
        "GetSovereigntySystems",
        # Fleet composition/location polling - see wh_mapper.tasks.poll_fleet_session.
        "GetCharactersCharacterIdFleet",
        "GetFleetsFleetIdMembers",
    ],
    additional_spec_headers={
        "Authorization": f"Bearer {Token.objects.filter(character_id=2119950231).first().valid_access_token()}",
    }
)
