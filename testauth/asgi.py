"""
ASGI config for testauth project.
Exposes the ASGI callable as a module-level variable named ``application``,
wrapping Django's HTTP handling together with wh_mapper's websocket routes.
"""

# Standard Library
import os

# Third Party
from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter

# Django
from django.core.asgi import get_asgi_application

# AA WH Mapper App
from wh_mapper.routing import websocket_urlpatterns

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "testauth.settings.local")

# Third Party

# Django

django_asgi_app = get_asgi_application()

# AA WH Mapper App

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": AuthMiddlewareStack(URLRouter(websocket_urlpatterns)),
    }
)
