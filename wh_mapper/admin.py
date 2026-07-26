"""Admin models"""

# Django
from django.contrib import admin
from django.core.exceptions import PermissionDenied
from django.template.response import TemplateResponse

# AA WH Mapper App
from wh_mapper.models import (
    Map,
    MapContribution,
    MapPresence,
    MapShare,
    MapShareGroup,
    MapSystem,
    Signature,
    TrackedCharacter,
    WormholeConnection,
    WormholeType,
)


class MapShareInline(admin.TabularInline):
    """Inline for MapShare"""

    model = MapShare
    extra = 0


class MapShareGroupInline(admin.TabularInline):
    """Inline for MapShareGroup"""

    model = MapShareGroup
    extra = 0


@admin.register(Map)
class MapAdmin(admin.ModelAdmin):
    """Admin for Map"""

    list_display = ("name", "owner", "visibility", "created_at")
    list_filter = ("visibility",)
    search_fields = ("name", "owner__username")
    inlines = (
        MapShareInline,
        MapShareGroupInline,
    )


@admin.register(MapSystem)
class MapSystemAdmin(admin.ModelAdmin):
    """Admin for MapSystem"""

    list_display = ("map", "solar_system", "label", "pinned", "added_by", "added_at")
    list_filter = ("map",)


@admin.register(Signature)
class SignatureAdmin(admin.ModelAdmin):
    """Admin for Signature"""

    list_display = (
        "signature_id",
        "map_system",
        "sig_type",
        "life_status",
        "updated_by",
        "updated_at",
    )
    list_filter = ("sig_type", "life_status")


@admin.register(WormholeConnection)
class WormholeConnectionAdmin(admin.ModelAdmin):
    """Admin for WormholeConnection"""

    list_display = (
        "map",
        "top_system",
        "bottom_system",
        "life_status",
        "mass_status",
        "created_by",
        "created_at",
    )
    list_filter = ("map", "life_status", "mass_status")


@admin.register(MapContribution)
class MapContributionAdmin(admin.ModelAdmin):
    """Admin for MapContribution"""

    list_display = ("map", "connection", "verb", "character", "user", "created_at")
    list_filter = ("verb", "map")
    search_fields = ("character__character_name", "user__username")


@admin.register(TrackedCharacter)
class TrackedCharacterAdmin(admin.ModelAdmin):
    """Admin for TrackedCharacter"""

    list_display = (
        "character",
        "added_by",
        "is_active",
        "last_solar_system",
        "last_seen_at",
    )
    list_filter = ("is_active",)
    search_fields = ("character__character_name",)


@admin.register(MapPresence)
class MapPresenceAdmin(admin.ModelAdmin):
    """Admin for MapPresence.

    Rows here are managed exclusively by MapConsumer (see
    wh_mapper/consumers.py) - one row per open websocket connection to a
    map's live-update channel, created on connect and deleted on disconnect -
    so there's nothing for an admin to add/edit/delete. A flat table of raw
    connections is also a lot harder to read at a glance than "who's online
    and what do they have open", so changelist_view is overridden below to
    render a grouped-by-user summary instead of the default list.
    """

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def changelist_view(self, request, extra_context=None):
        # We're overriding the default changelist_view (rather than just
        # customizing list_display), so we're responsible for redoing its
        # permission check ourselves - admin_site.admin_view only verifies
        # is_active/is_staff, not the model-level view permission.
        if not self.has_view_permission(request):
            raise PermissionDenied

        presences = (
            MapPresence.objects.select_related("map", "user")
            .order_by("user__username", "map__name")
        )

        online_users_by_id: dict[int, dict] = {}
        for presence in presences:
            entry = online_users_by_id.setdefault(
                presence.user_id, {"user": presence.user, "presences": []}
            )
            entry["presences"].append(presence)

        online_users = sorted(
            online_users_by_id.values(), key=lambda entry: entry["user"].username.lower()
        )

        context = {
            **self.admin_site.each_context(request),
            "opts": self.model._meta,
            "title": "Currently online",
            "online_users": online_users,
        }
        if extra_context:
            context.update(extra_context)

        return TemplateResponse(
            request, "admin/wh_mapper/mappresence/online_users.html", context
        )


@admin.register(WormholeType)
class WormholeTypeAdmin(admin.ModelAdmin):
    """`code`/`max_*` are derived by `wh_mapper_derive_wormhole_types`;
    `leads_to_class` isn't in the SDE at all and is left here for an admin
    to fill in manually.
    """

    list_display = ("code", "leads_to_class", "max_mass", "max_jump_mass", "max_stable_time")
    search_fields = ("code", "item_type__name")
    readonly_fields = ("item_type", "code", "max_mass", "max_jump_mass", "max_stable_time")
