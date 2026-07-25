# Third Party
from ninja import NinjaAPI

# Django
from django.db import IntegrityError
from django.db.models import Q
from django.shortcuts import get_object_or_404

# AA WH Mapper App
from wh_mapper.api import schema
from wh_mapper.api.helpers import (
    apply_life_status,
    require_visible_map,
    signature_to_schema,
)
from wh_mapper.broadcast import broadcast_map_event
from wh_mapper.models import MapSystem, Signature, WormholeConnection, WormholeType


def _recompute_routes_for_map(map_id: int) -> None:
    """Deferred import - see wh_mapper.api.connections._recompute_routes_for_map
    for why this can't be a module-scope import. A signature identified/
    updated/removed can change what a route leg shows for the connection
    it's linked to (wormhole type -> time_status, or the signature detail
    itself - see WormholeConnectionOut.top_signature/bottom_signature),
    even though it never changes routing weight."""

    # AA WH Mapper App
    from wh_mapper.tasks import recompute_routes_for_map

    recompute_routes_for_map.delay(map_id)


def _resolve_wormhole_type(code):
    if not code:
        return None

    return WormholeType.objects.filter(code__iexact=code).first()


class SignatureApiEndpoints:
    """Signature CRUD endpoints, nested under a Map's MapSystem"""

    tags = ["Signatures"]

    def __init__(self, api: NinjaAPI):

        @api.post(
            "/maps/{map_id}/systems/{system_id}/signatures/",
            response={200: schema.SignatureOut, 400: str, 403: str, 404: str},
            tags=self.tags,
        )
        def add_signature(
            request, map_id: int, system_id: int, payload: schema.SignatureCreate
        ):
            map_obj, error = require_visible_map(request, map_id)
            if error:
                return error

            map_system = get_object_or_404(MapSystem, pk=system_id, map=map_obj)

            # Uppercased like the bulk-upsert path (see its own comment) so a
            # manually-added "abc-123" and a later pasted "ABC-123" are
            # treated as the same signature rather than silently diverging.
            signature_id = payload.signature_id.upper()

            signature = Signature(
                map_system=map_system,
                signature_id=signature_id,
                sig_type=payload.sig_type,
                wormhole_type=_resolve_wormhole_type(payload.wormhole_type_code),
                updated_by=request.user,
            )
            apply_life_status(signature, payload.life_status)
            try:
                signature.save()
            except IntegrityError:
                return 400, f"Signature {signature_id} already exists on this system"

            out = signature_to_schema(signature)
            broadcast_map_event(map_obj.id, "signature.added", out)

            return out

        # Registered before the `{signature_id}` routes below: django-ninja's
        # dynamic segments compile to a plain (non-numeric-only) path
        # converter, so the URL resolver would otherwise match "bulk" against
        # `{signature_id}` first (matching is by path only, method comes
        # after) and return 405 instead of ever reaching this route.
        @api.post(
            "/maps/{map_id}/systems/{system_id}/signatures/bulk/",
            response={200: schema.SignatureBulkResult, 403: str, 404: str},
            tags=self.tags,
        )
        def bulk_upsert_signatures(
            request, map_id: int, system_id: int, payload: schema.SignatureBulkUpsert
        ):
            map_obj, error = require_visible_map(request, map_id)
            if error:
                return error

            map_system = get_object_or_404(MapSystem, pk=system_id, map=map_obj)

            # Both existing entry paths (paste parsing, manual add) already
            # uppercase client-side - normalize here too so lazy-delete's
            # diff below can't misfire on a stray casing mismatch.
            row_ids = [row.signature_id.upper() for row in payload.rows]
            existing_by_id = {
                s.signature_id: s
                for s in Signature.objects.filter(
                    map_system=map_system, signature_id__in=row_ids
                )
            }

            # Batch-fetched above and diffed here, rather than one
            # get_or_create per row: a pasted probe-scan result is routinely
            # 20-30 rows, which would otherwise cost 20-30+ sequential
            # queries in a single request.
            signatures_by_id = dict(existing_by_id)
            to_create: list[Signature] = []
            to_update: list[Signature] = []
            seen_new_ids: set[str] = set()

            for row in payload.rows:
                signature_id = row.signature_id.upper()
                existing = existing_by_id.get(signature_id)
                if existing is not None:
                    if row.sig_type and existing not in to_update:
                        existing.sig_type = row.sig_type
                        existing.updated_by = request.user
                        to_update.append(existing)
                    continue
                if signature_id in seen_new_ids:
                    # Same never-before-seen signature_id pasted twice in one
                    # batch - keep only the first row's data.
                    continue
                seen_new_ids.add(signature_id)
                to_create.append(
                    Signature(
                        map_system=map_system,
                        signature_id=signature_id,
                        sig_type=row.sig_type or Signature.SignatureType.UNKNOWN,
                        updated_by=request.user,
                    )
                )

            if to_create:
                Signature.objects.bulk_create(to_create)
                # Re-fetched rather than trusting bulk_create to populate pks
                # in place - not every DB backend returns them.
                signatures_by_id.update(
                    {
                        s.signature_id: s
                        for s in Signature.objects.filter(
                            map_system=map_system, signature_id__in=seen_new_ids
                        )
                    }
                )
            if to_update:
                Signature.objects.bulk_update(to_update, ["sig_type", "updated_by"])

            signatures = [
                signatures_by_id[signature_id]
                for signature_id in dict.fromkeys(row_ids)
            ]

            out = [signature_to_schema(signature) for signature in signatures]

            removed_signature_ids: list[int] = []
            removed_connection_ids: list[int] = []
            removed_system_ids: list[int] = []

            if payload.lazy_delete:
                pasted_ids = {row.signature_id.upper() for row in payload.rows}
                stale_signatures = Signature.objects.filter(
                    map_system=map_system
                ).exclude(signature_id__in=pasted_ids)
                stale_pks = list(stale_signatures.values_list("id", flat=True))

                if stale_pks:
                    # No .distinct() needed (and Django refuses to .delete()
                    # a distinct queryset anyway) - both Q conditions filter
                    # on this table's own columns, not a joined relation, so
                    # this can't produce duplicate rows.
                    stale_connections = WormholeConnection.objects.filter(
                        Q(top_signature_id__in=stale_pks)
                        | Q(bottom_signature_id__in=stale_pks)
                    )
                    # Captured before .delete() - need each connection's
                    # endpoint system ids below to seed the dangling-system
                    # check, and the rows won't be queryable once deleted.
                    endpoint_system_ids = set()
                    for top_id, bottom_id in stale_connections.values_list(
                        "top_system_id", "bottom_system_id"
                    ):
                        endpoint_system_ids.add(top_id)
                        endpoint_system_ids.add(bottom_id)

                    removed_connection_ids = list(
                        stale_connections.values_list("id", flat=True)
                    )
                    stale_connections.delete()

                    removed_signature_ids = stale_pks
                    Signature.objects.filter(pk__in=stale_pks).delete()

                    if payload.remove_dangling_systems:
                        # Worklist seeded with every system on the far end of
                        # a connection just removed - never the system being
                        # pasted into.
                        candidates = endpoint_system_ids - {map_system.id}
                        checked: set[int] = set()
                        while candidates:
                            candidate_id = candidates.pop()
                            if candidate_id in checked:
                                continue
                            checked.add(candidate_id)

                            try:
                                candidate = MapSystem.objects.get(
                                    pk=candidate_id, map=map_obj
                                )
                            except MapSystem.DoesNotExist:
                                continue  # already removed earlier in this loop
                            if candidate.pinned:
                                continue

                            remaining = WormholeConnection.objects.filter(
                                Q(top_system_id=candidate_id)
                                | Q(bottom_system_id=candidate_id)
                            )
                            if remaining.exists():
                                continue

                            # Zero connections and unpinned - gone. A system
                            # with zero connections has no neighbours to add
                            # back to the worklist, so this naturally
                            # terminates.
                            removed_system_ids.append(candidate_id)
                            candidate.delete()

            broadcast_map_event(
                map_obj.id,
                "signature.bulk_upserted",
                {
                    "signatures": out,
                    "removed_signature_ids": removed_signature_ids,
                    "removed_connection_ids": removed_connection_ids,
                    "removed_system_ids": removed_system_ids,
                },
            )
            _recompute_routes_for_map(map_obj.id)

            return {
                "signatures": out,
                "removed_signature_ids": removed_signature_ids,
                "removed_connection_ids": removed_connection_ids,
                "removed_system_ids": removed_system_ids,
            }

        @api.patch(
            "/maps/{map_id}/systems/{system_id}/signatures/{signature_id}/",
            response={200: schema.SignatureOut, 403: str, 404: str},
            tags=self.tags,
        )
        def update_signature(
            request,
            map_id: int,
            system_id: int,
            signature_id: int,
            payload: schema.SignatureUpdate,
        ):
            map_obj, error = require_visible_map(request, map_id)
            if error:
                return error

            map_system = get_object_or_404(MapSystem, pk=system_id, map=map_obj)
            signature = get_object_or_404(
                Signature, pk=signature_id, map_system=map_system
            )

            update_data = payload.dict(exclude_unset=True)
            if "wormhole_type_code" in update_data:
                signature.wormhole_type = _resolve_wormhole_type(
                    update_data.pop("wormhole_type_code")
                )
            if "life_status" in update_data:
                apply_life_status(signature, update_data.pop("life_status"))
            for field, value in update_data.items():
                setattr(signature, field, value)
            signature.updated_by = request.user
            signature.save()

            out = signature_to_schema(signature)
            broadcast_map_event(map_obj.id, "signature.updated", out)
            _recompute_routes_for_map(map_obj.id)

            return out

        @api.delete(
            "/maps/{map_id}/systems/{system_id}/signatures/{signature_id}/",
            response={204: None, 403: str, 404: str},
            tags=self.tags,
        )
        def remove_signature(
            request, map_id: int, system_id: int, signature_id: int
        ):
            map_obj, error = require_visible_map(request, map_id)
            if error:
                return error

            map_system = get_object_or_404(MapSystem, pk=system_id, map=map_obj)
            signature = get_object_or_404(
                Signature, pk=signature_id, map_system=map_system
            )
            signature.delete()

            broadcast_map_event(map_obj.id, "signature.removed", {"id": signature_id})
            _recompute_routes_for_map(map_obj.id)

            return 204, None


def setup(api: NinjaAPI) -> None:
    """Register Signature endpoints"""

    SignatureApiEndpoints(api)
