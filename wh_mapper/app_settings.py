"""App Settings"""

# Django
from django.conf import settings

# put your app settings here


WH_MAPPER_SETTING_ONE = getattr(settings, "WH_MAPPER_SETTING_ONE", None)

# Override the websocket origin (e.g. "ws://localhost:8001") for setups where
# daphne isn't (yet) proxied on the same origin as the rest of the site.
# Leave unset to connect same-origin as the page itself (the normal case once
# a reverse proxy routes /ws/ to daphne).
WH_MAPPER_WS_ORIGIN = getattr(settings, "WH_MAPPER_WS_ORIGIN", None)
