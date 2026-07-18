"""App URLs"""

# Django
from django.urls import path

# AA WH Mapper App
from wh_mapper import views
from wh_mapper.api import api

app_name: str = "wh_mapper"  # pylint: disable=invalid-name

urlpatterns = [
    path("", views.index, name="index"),
    # The React SPA client-side routes to this path (see frontend/src/App.tsx)
    # to deep-link a specific map - Django just needs to serve the same SPA
    # shell here too, so a direct visit/refresh on that URL doesn't 404.
    path("maps/<int:map_id>/", views.index, name="map_detail"),
    path("track/add/", views.add_tracked_character, name="add_tracked_character"),
    path("api/", api.urls),
]
