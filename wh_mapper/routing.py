"""Websocket URL routing"""

# Django
from django.urls import path

# AA WH Mapper App
from wh_mapper.consumers import MapConsumer

websocket_urlpatterns = [
    path("ws/wh-mapper/maps/<int:map_id>/", MapConsumer.as_asgi()),
]
