"""Websocket URL routing"""

# Django
from django.urls import path

# AA WH Mapper App
from wh_mapper.consumers import MapConsumer, RouteConsumer

websocket_urlpatterns = [
    path("ws/wh-mapper/maps/<int:map_id>/", MapConsumer.as_asgi()),
    path("ws/wh-mapper/routes/<int:route_id>/", RouteConsumer.as_asgi()),
]
