# Third Party
from ninja import NinjaAPI

# Django
from django.contrib.auth.models import Group
from django.shortcuts import get_object_or_404

# Alliance Auth
from allianceauth.eveonline.models import (
    EveAllianceInfo,
    EveCharacter,
    EveCorporationInfo,
)

# AA WH Mapper App
from wh_mapper.api import schema
from wh_mapper.api.helpers import (
    can_edit_sharing,
    require_basic_access,
    require_visible_map,
    revoke_stale_map_access,
)
from wh_mapper.models import MapShare, MapShareGroup

# `target_id` namespace + how to resolve a display name for it, per scope -
# used by both add_share/remove_share (MapShare vs MapShareGroup) and
# list_shares (name resolution).
SCOPE_NAME_LOOKUP = {
    MapShare.Scope.CHARACTER: (EveCharacter.objects.all(), "character_id", "character_name"),
    MapShare.Scope.CORPORATION: (
        EveCorporationInfo.objects.all(),
        "corporation_id",
        "corporation_name",
    ),
    MapShare.Scope.ALLIANCE: (EveAllianceInfo.objects.all(), "alliance_id", "alliance_name"),
}


def _resolve_names(queryset, target_ids: list[int], id_field: str, name_field: str) -> dict[int, str]:
    """`{id: name}` for whichever of `target_ids` AA actually has a local row
    for - character/corporation/alliance shares are stored by raw id (see
    wh_mapper.models.MapShare), so some may have no match."""

    if not target_ids:
        return {}

    return {
        getattr(obj, id_field): getattr(obj, name_field)
        for obj in queryset.filter(**{f"{id_field}__in": target_ids})
    }


def _search_entities(request, queryset, name_field: str, query: str, limit: int, serialize):
    """require_basic_access + `name_field__icontains=query` + serialize -
    the guard/filter/serialize shape shared by search_characters/
    search_corporations/search_alliances below, which otherwise differ only
    in which model/fields they search."""

    error = require_basic_access(request)
    if error:
        return error

    matches = queryset.filter(**{f"{name_field}__icontains": query})[:limit]
    return [serialize(m) for m in matches]


class SharingApiEndpoints:
    """Typeahead search + share/revoke endpoints for map sharing"""

    tags = ["Sharing"]

    def __init__(self, api: NinjaAPI):

        @api.get(
            "/characters/search/{query}/",
            response={200: list[schema.CharacterSearchResult], 403: str},
            tags=self.tags,
        )
        def search_characters(request, query: str, limit: int = 10):
            return _search_entities(
                request,
                EveCharacter.objects.all(),
                "character_name",
                query,
                limit,
                lambda c: {
                    "character_id": c.character_id,
                    "character_name": c.character_name,
                    "corporation_name": c.corporation_name,
                },
            )

        @api.get(
            "/corporations/search/{query}/",
            response={200: list[schema.CorporationSearchResult], 403: str},
            tags=self.tags,
        )
        def search_corporations(request, query: str, limit: int = 10):
            return _search_entities(
                request,
                EveCorporationInfo.objects.all(),
                "corporation_name",
                query,
                limit,
                lambda c: {
                    "corporation_id": c.corporation_id,
                    "corporation_name": c.corporation_name,
                },
            )

        @api.get(
            "/alliances/search/{query}/",
            response={200: list[schema.AllianceSearchResult], 403: str},
            tags=self.tags,
        )
        def search_alliances(request, query: str, limit: int = 10):
            return _search_entities(
                request,
                EveAllianceInfo.objects.all(),
                "alliance_name",
                query,
                limit,
                lambda a: {"alliance_id": a.alliance_id, "alliance_name": a.alliance_name},
            )

        @api.get(
            "/groups/search/{query}/",
            response={200: list[schema.GroupSearchResult], 403: str},
            tags=self.tags,
        )
        def search_groups(request, query: str, limit: int = 10):
            error = require_basic_access(request)
            if error:
                return error

            # Unlike character/corporation/alliance search (which search
            # every entity AA knows about), a group grant only ever makes
            # sense for a group the sharing user is actually in - so this is
            # scoped to request.user.groups rather than Group.objects.all().
            groups = request.user.groups.filter(name__icontains=query)[:limit]

            return [{"group_id": g.id, "group_name": g.name} for g in groups]

        @api.get(
            "/maps/{map_id}/shares/",
            response={200: list[schema.ShareOut], 403: str, 404: str},
            tags=self.tags,
        )
        def list_shares(request, map_id: int):
            # Viewing who a map is shared with is not gated by
            # can_edit_sharing - anyone who can see the map at all may see
            # who else can; only actually changing that list is restricted
            # to the owner/a superuser (see add_share/remove_share below).
            map_obj, error = require_visible_map(request, map_id)
            if error:
                return error

            scoped_shares = list(MapShare.objects.filter(map=map_obj))
            names_by_scope = {
                scope: _resolve_names(
                    queryset,
                    [s.target_id for s in scoped_shares if s.scope == scope],
                    id_field,
                    name_field,
                )
                for scope, (queryset, id_field, name_field) in SCOPE_NAME_LOOKUP.items()
            }

            shares = [
                {
                    "scope": s.scope,
                    "target_id": s.target_id,
                    "target_name": names_by_scope[s.scope].get(s.target_id),
                }
                for s in scoped_shares
            ] + [
                # A group is a first-party local row (real FK, unlike the
                # three scopes above), so its name is always known.
                {"scope": "group", "target_id": s.group_id, "target_name": s.group.name}
                for s in MapShareGroup.objects.filter(map=map_obj).select_related("group")
            ]

            return shares

        @api.post(
            "/maps/{map_id}/share/",
            response={200: schema.ShareOut, 403: str, 404: str},
            tags=self.tags,
        )
        def add_share(request, map_id: int, payload: schema.ShareCreate):
            map_obj, error = require_visible_map(request, map_id)
            if error:
                return error

            if not can_edit_sharing(request, map_obj):
                return 403, "Permission denied"

            if payload.scope == "group":
                if not Group.objects.filter(pk=payload.target_id).exists():
                    return 404, "No group with that id"
                MapShareGroup.objects.get_or_create(
                    map=map_obj,
                    group_id=payload.target_id,
                    defaults={"added_by": request.user},
                )
            else:
                MapShare.objects.get_or_create(
                    map=map_obj,
                    scope=payload.scope,
                    target_id=payload.target_id,
                    defaults={"added_by": request.user},
                )

            return {"scope": payload.scope, "target_id": payload.target_id}

        @api.delete(
            "/maps/{map_id}/share/{scope}/{target_id}/",
            response={204: None, 403: str, 404: str},
            tags=self.tags,
        )
        def remove_share(request, map_id: int, scope: str, target_id: int):
            map_obj, error = require_visible_map(request, map_id)
            if error:
                return error

            if not can_edit_sharing(request, map_obj):
                return 403, "Permission denied"

            if scope == "group":
                entry = get_object_or_404(MapShareGroup, map=map_obj, group_id=target_id)
            elif scope in MapShare.Scope.values:
                entry = get_object_or_404(MapShare, map=map_obj, scope=scope, target_id=target_id)
            else:
                return 404, "Unknown share scope"

            entry.delete()

            revoke_stale_map_access(map_obj)

            return 204, None


def setup(api: NinjaAPI) -> None:
    """Register sharing endpoints"""

    SharingApiEndpoints(api)
