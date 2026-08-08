"""Websocket URL routing"""

# Django
from django.urls import path

# AA WH Mapper App
from wh_mapper.consumers import FleetSessionConsumer, MapConsumer, RouteConsumer

websocket_urlpatterns = [
    path("ws/wh-mapper/maps/<int:map_id>/", MapConsumer.as_asgi()),
    path("ws/wh-mapper/routes/<int:route_id>/", RouteConsumer.as_asgi()),
    path("ws/wh-mapper/fleets/<int:session_id>/", FleetSessionConsumer.as_asgi()),
]
