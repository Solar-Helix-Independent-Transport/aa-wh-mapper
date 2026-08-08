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
    # Same reasoning, for the route-planner's own client-side routes.
    path("route/", views.index, name="route_finder"),
    path("route/shared/<int:route_id>/", views.index, name="shared_route_detail"),
    # Same reasoning, for the admin status page.
    path("status/", views.index, name="status"),
    path("track/add/", views.add_tracked_character, name="add_tracked_character"),
    path("api/", api.urls),
]
