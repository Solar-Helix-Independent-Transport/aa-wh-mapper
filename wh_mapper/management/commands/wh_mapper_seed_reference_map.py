"""
Seed (or refresh) a demo Map containing one system for every space type/
wormhole class this app knows how to render - C1-C6, C13 (shattered), Thera,
the five Drifter regions (Sentinel/Barbican/Vidette/Conflux/Redoubt),
High/Low/Null-sec, Pochven, and Abyssal Deadspace - plus a chain of
connections and signatures exercising every distinct link/sig visual, so a
screenshot of it doubles as a visual legend for SystemNode/FloatingEdge's
styling.

Fully idempotent (safe to rerun after pulling frontend/backend styling
changes to regenerate the legend): MapSystem rows are update_or_create'd,
keyed by real CCP solar_system_id. Connections and signatures have no such
natural dedup key though (only stargate connections are DB-deduplicated -
see WormholeConnection's docstring), so this map's own connections/
signatures are simply wiped and rebuilt from scratch on every run instead -
fine here since, unlike a real map, nothing user-created is ever expected to
live on this one.

Every solar_system_id below is real (verified via CCP's ESI - the same
verification path used for CLASS_LABELS in
frontend/src/components/wormholeClass.ts and this command's own
CODE_TO_CLASS table, see wh_mapper_derive_wormhole_types.py), but this
command deliberately does NOT create or patch eve_sde rows (SolarSystem/
Constellation/Region) itself - it only ever reads them (see
_resolve_solar_systems). An earlier version did upsert those fields by hand,
which meant this map could show a correct "C3" class label while every real
map in the same environment still showed a bare "WORMHOLE" badge for the
exact same underlying data gap - the two were silently drifting apart
instead of the reference map actually reflecting the app's real behavior.
wh_mapper itself never creates/patches SolarSystem rows anywhere (it's a
pure downstream reader of a full eve_sde import - see
wh_mapper.tasks._apply_location_update's SolarSystem.objects.get, which
warns and skips rather than fabricating a row on a miss), so this command
doesn't either now. If a system below is missing from your DB, that's a real
SDE import gap - fix it with django-eve-sde's `esde_load_sde` (see its
README), not by hardcoding data here. A null wormhole_class_id_raw on an
existing row is *not* such a gap, though, and re-importing won't fix it -
CCP's current static-data export simply doesn't publish that field for
ordinary J-space systems (verified: only 5 of 2604 real J-space systems in
it have the field at all, all Drifter regions). See
wh_mapper.api.helpers.wormhole_class_id, which derives the class from the
region-name letter convention instead - that's what actually fixed this, not
an SDE reimport.

The synthetic pieces that remain are the null-sec sovereignty alliance (real
sov changes over time, so asserting today's holder would just go stale) and
the demo WormholeType/signatures used to drive the connection legend
(there's no "real" wormhole type that would keep giving green/orange/red on
demand) - neither of those is eve_sde static data, so there's no "real"
source to defer to for them.
"""

# Standard Library
from datetime import timedelta

# Third Party
from eve_sde.models import ItemType, SolarSystem

# Django
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

# Alliance Auth
# AA Example App
from allianceauth.eveonline.models import EveAllianceInfo, EveFactionInfo

from ...constants import GRID_SIZE
from ...models import (
    Map,
    MapSystem,
    Signature,
    SystemSovereignty,
    WormholeConnection,
    WormholeType,
)

MAP_NAME = "Space Type Reference"

# Real CCP faction IDs (Caldari State/Gallente Federation), matching the real
# NPC empire that owns Jita's/Rancer's region - not invented.
CALDARI_STATE_FACTION_ID = 500001
GALLENTE_FEDERATION_FACTION_ID = 500004

# A clearly-fake alliance standing in for "some player alliance holds sov
# here" - see module docstring for why this one field isn't sourced from
# real data.
REFERENCE_ALLIANCE_ID = 99000099
REFERENCE_ALLIANCE_NAME = "Reference Alliance (demo)"
REFERENCE_ALLIANCE_TICKER = "REF"

# A single fake wormhole type (not a real code - see module docstring) used
# to drive the green/orange/red time_status demo connections below, all via
# the same max_stable_time and a backdated created_at per connection (see
# _backdate below) rather than three separate fake types.
DEMO_ITEM_TYPE_ID = 999000001
DEMO_WORMHOLE_CODE = "ZDEMO1"
DEMO_WORMHOLE_MAX_MASS = 3_000_000_000.0
DEMO_WORMHOLE_MAX_JUMP_MASS = 20_000_000.0  # -> "medium" per shipSizeForJumpMass
DEMO_WORMHOLE_MAX_STABLE_TIME = 16 * 60  # minutes

# Every system's canvas position is explicit (`pos`) rather than a computed
# grid - the connected chain (indices 0-9, C1..Barbican) zigzags between two
# bands (CHAIN_TOP_Y/CHAIN_BOTTOM_Y) so each wormhole connection renders as a
# visible diagonal instead of a flat/overlapping line, matching how this map
# actually looks once someone's dragged it into a readable shape by hand.
# Expressed in GRID_SIZE multiples ("N grid references"), same convention as
# wh_mapper/constants.py's own NEW_SYSTEM_OFFSET_X, so these stay aligned to
# the canvas's own 24px snap grid (see frontend/src/constants.ts's
# SNAP_GRID) rather than landing on an arbitrary off-grid pixel value.
CHAIN_STEP_X = GRID_SIZE * 5
CHAIN_TOP_Y = 0
CHAIN_BOTTOM_Y = GRID_SIZE * 4
UNCONNECTED_DRIFTER_Y = GRID_SIZE * 8
KSPACE_ROW_Y = GRID_SIZE * 12

# id (the only thing that picks the system - everything else this map shows
# for it is read live from your local eve_sde import, see this file's
# docstring), label (MapSystem.label - blank for every wormhole-class entry,
# so its real J-name shows instead; SystemNode already puts the class in the
# location line for those - see SystemNode.tsx - so a "C1"-style label would
# just duplicate it. Still set for the k-space/other entries below, whose
# real names - Jita, Rancer, 1DQ1-A - aren't self-explanatory the way a
# J-code + class is), pos, and (only for the null-sec example)
# sovereignty_alliance_id.
REFERENCE_SYSTEMS = [
    dict(id=31000007, label="", pos=(CHAIN_STEP_X * 0, CHAIN_TOP_Y)),      # C1  - J105443
    dict(id=31000355, label="", pos=(CHAIN_STEP_X * 1, CHAIN_BOTTOM_Y)),  # C2  - J164417
    dict(id=31000880, label="", pos=(CHAIN_STEP_X * 2, CHAIN_TOP_Y)),      # C3  - J160650
    dict(id=31001375, label="", pos=(CHAIN_STEP_X * 3, CHAIN_BOTTOM_Y)),  # C4  - J160225
    dict(id=31001880, label="", pos=(CHAIN_STEP_X * 4, CHAIN_TOP_Y)),      # C5  - J152820
    dict(id=31002367, label="", pos=(CHAIN_STEP_X * 5, CHAIN_BOTTOM_Y)),  # C6  - J104859
    dict(id=31002580, label="", pos=(CHAIN_STEP_X * 6, CHAIN_TOP_Y)),      # C13 - J000895
    dict(id=31000005, label="", pos=(CHAIN_STEP_X * 7, CHAIN_BOTTOM_Y)),  # Thera
    dict(id=31000001, label="", pos=(CHAIN_STEP_X * 8, CHAIN_TOP_Y)),      # Sentinel (Drifter)
    dict(id=31000002, label="", pos=(CHAIN_STEP_X * 9, CHAIN_BOTTOM_Y)),  # Barbican (Drifter)
    # Unconnected Drifter regions - own row below the chain, evenly spaced.
    dict(id=31000003, label="", pos=(CHAIN_STEP_X * 1, UNCONNECTED_DRIFTER_Y)),  # Vidette (Drifter)
    dict(id=31000004, label="", pos=(CHAIN_STEP_X * 3, UNCONNECTED_DRIFTER_Y)),  # Conflux (Drifter)
    dict(id=31000006, label="", pos=(CHAIN_STEP_X * 5, UNCONNECTED_DRIFTER_Y)),  # Redoubt (Drifter)
    # K-space row - HS/LS/NS staggered into the same up/down "V" the chain
    # above uses, so their stargate/Ansiblex links read as angular too.
    dict(id=30000142, label="High-sec", pos=(CHAIN_STEP_X * 2, KSPACE_ROW_Y)),  # Jita
    dict(
        id=30002718, label="Low-sec",
        pos=(CHAIN_STEP_X * 1, KSPACE_ROW_Y + CHAIN_BOTTOM_Y),  # Rancer
    ),
    dict(
        id=30004759, label="Null-sec", pos=(CHAIN_STEP_X * 0, KSPACE_ROW_Y),  # 1DQ1-A
        sovereignty_alliance_id=REFERENCE_ALLIANCE_ID,
    ),
    dict(id=30000157, label="Pochven", pos=(CHAIN_STEP_X * 4, KSPACE_ROW_Y)),  # Otela
    dict(id=32000001, label="Abyssal Deadspace (T1)", pos=(CHAIN_STEP_X * 5, KSPACE_ROW_Y)),  # AD001
]

# (index of system A, index of system B, kind) into REFERENCE_SYSTEMS above -
# one entry per distinct link visual FloatingEdge/MapCanvas can render (see
# _apply_connection_kind). Deliberately chains arbitrary neighbors rather
# than modelling real leads-to relationships - this map is a style legend,
# not a real chain.
CONNECTION_PLAN = [
    (0, 1, "wh_green"),
    (1, 2, "wh_orange"),
    (2, 3, "wh_red"),
    (3, 4, "wh_unknown"),
    (4, 5, "wh_mass_critical"),
    (5, 6, "wh_ship_small"),
    (6, 7, "wh_ship_medium"),
    (7, 8, "wh_ship_large"),
    (8, 9, "wh_ship_capital"),
    (13, 14, "stargate"),
    (14, 15, "ansiblex"),
]

# Deterministic-looking EVE-style signature codes ("ABC-123"), handed out in
# order to every Signature this command creates - fixed rather than random
# so a rerun produces byte-identical rows.
SIGNATURE_CODES = [
    "ABC-123", "DEF-456", "GHI-789", "JKL-012", "MNO-345",
    "PQR-678", "STU-901", "VWX-234", "YZA-567", "BCD-890",
    "EFG-111", "HIJ-222", "KLM-333", "NOP-444", "QRS-555",
    "TUV-666", "WXY-777", "ZAB-888", "CDE-999", "FGH-000",
    "IJK-101", "LMN-202", "OPQ-303", "RST-404",
]

# Extra, connection-less signatures scattered onto a few systems (by index
# into REFERENCE_SYSTEMS) so the "N sigs" badge and the non-wormhole
# SignatureType choices show up somewhere too.
FLAVOR_SIGNATURES = [
    (7, "combat"),   # Thera
    (7, "data"),
    (6, "relic"),    # C13
    (11, "gas"),     # Conflux
    (16, "ore"),     # Pochven
    (17, "unknown"),  # Abyssal
]


class Command(BaseCommand):
    help = (
        "Seed (or refresh) a demo Map with one system per space type/"
        "wormhole class - plus a connection/signature legend - for "
        "screenshotting SystemNode/FloatingEdge's styling."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--owner",
            help="Username to own the reference Map (defaults to the first superuser).",
        )

    def handle(self, *args, **options):
        owner = self._resolve_owner(options.get("owner"))

        for faction_id, faction_name in (
            (CALDARI_STATE_FACTION_ID, "Caldari State"),
            (GALLENTE_FEDERATION_FACTION_ID, "Gallente Federation"),
        ):
            EveFactionInfo.objects.get_or_create(
                faction_id=faction_id, defaults={"faction_name": faction_name}
            )
        EveAllianceInfo.objects.get_or_create(
            alliance_id=REFERENCE_ALLIANCE_ID,
            defaults={
                "alliance_name": REFERENCE_ALLIANCE_NAME,
                "alliance_ticker": REFERENCE_ALLIANCE_TICKER,
            },
        )
        demo_wormhole_type = self._get_or_create_demo_wormhole_type()

        solar_systems = self._resolve_solar_systems(REFERENCE_SYSTEMS)

        map_obj, map_created = Map.objects.get_or_create(
            name=MAP_NAME, owner=owner, defaults={"visibility": "private"}
        )

        map_systems = []
        for row, solar_system in zip(REFERENCE_SYSTEMS, solar_systems):
            x, y = row["pos"]
            map_system, _ = MapSystem.objects.update_or_create(
                map=map_obj,
                solar_system=solar_system,
                defaults={
                    "label": row["label"],
                    "x": x,
                    "y": y,
                    "added_by": owner,
                },
            )
            map_systems.append(map_system)

        # No stable dedup key for wormhole/ansiblex connections or for
        # signatures (see module docstring) - rebuild both from scratch.
        WormholeConnection.objects.filter(map=map_obj).delete()
        Signature.objects.filter(map_system__map=map_obj).delete()

        sig_codes = iter(SIGNATURE_CODES)
        for index_a, index_b, kind in CONNECTION_PLAN:
            self._create_connection(
                map_obj,
                map_systems[index_a],
                map_systems[index_b],
                kind,
                demo_wormhole_type,
                sig_codes,
            )
        for index, sig_type in FLAVOR_SIGNATURES:
            Signature.objects.create(
                map_system=map_systems[index],
                signature_id=next(sig_codes),
                sig_type=sig_type,
                updated_by=owner,
            )

        signature_count = Signature.objects.filter(map_system__map=map_obj).count()
        self.stdout.write(
            self.style.SUCCESS(
                f"{'Created' if map_created else 'Refreshed'} map {map_obj.id} "
                f"'{MAP_NAME}' (owner: {owner}) with {len(REFERENCE_SYSTEMS)} "
                f"systems, {len(CONNECTION_PLAN)} connections, and "
                f"{signature_count} signatures."
            )
        )

    def _resolve_owner(self, username):
        User = get_user_model()
        if username:
            try:
                return User.objects.get(username=username)
            except User.DoesNotExist as exc:
                raise CommandError(f"No user named '{username}'") from exc

        owner = User.objects.filter(is_superuser=True).order_by("id").first()
        if owner is None:
            raise CommandError(
                "No superuser found - pass --owner <username> to pick who owns the map."
            )
        return owner

    def _get_or_create_demo_wormhole_type(self):
        item_type, _ = ItemType.objects.get_or_create(
            id=DEMO_ITEM_TYPE_ID, defaults={"name": "Reference Wormhole (demo)"}
        )
        wormhole_type, _ = WormholeType.objects.get_or_create(
            item_type=item_type,
            defaults={
                "code": DEMO_WORMHOLE_CODE,
                "leads_to_class": 3,
                "max_mass": DEMO_WORMHOLE_MAX_MASS,
                "max_jump_mass": DEMO_WORMHOLE_MAX_JUMP_MASS,
                "max_stable_time": DEMO_WORMHOLE_MAX_STABLE_TIME,
            },
        )
        return wormhole_type

    def _resolve_solar_systems(self, rows):
        """Look up each row's real eve_sde.SolarSystem by id - read-only, on
        purpose (see this file's docstring): this map exists to show what
        the app actually renders for a real system, so its data has to come
        from wherever every other map's does (a full SDE import), not from
        values pasted in by this command. Raises one CommandError listing
        every id missing from the local import, rather than failing one at a
        time on the first miss.
        """

        by_id = SolarSystem.objects.in_bulk([row["id"] for row in rows])
        missing = [row["id"] for row in rows if row["id"] not in by_id]
        if missing:
            raise CommandError(
                f"Missing eve_sde.SolarSystem row(s) for solar_system_id "
                f"{missing} - run django-eve-sde's `esde_load_sde` to import "
                "the full SDE (see its README) rather than seeding this map "
                "against an incomplete one."
            )

        for row in rows:
            sovereignty_alliance_id = row.get("sovereignty_alliance_id")
            if sovereignty_alliance_id is not None:
                # get_or_create, not update_or_create: prefer a real live
                # sovereignty row (from wh_mapper.tasks.refresh_system_sovereignty)
                # over this demo alliance if one already exists.
                SystemSovereignty.objects.get_or_create(
                    solar_system_id=row["id"],
                    defaults={"alliance_id": sovereignty_alliance_id},
                )

        return [by_id[row["id"]] for row in rows]

    def _create_connection(
        self, map_obj, top_system, bottom_system, kind, demo_wormhole_type, sig_codes
    ):
        """One CONNECTION_PLAN entry -> a WormholeConnection (+ signatures
        for the wormhole kinds), covering every distinct thing
        MapCanvas/FloatingEdge render a link as:

        - wh_green/orange/red: connection_type=wormhole, both ends
            signature-linked to demo_wormhole_type, time_status computed
            server-side (see wh_mapper.api.helpers.connection_time_status)
            from a backdated created_at - green/orange/red thresholds are
            fractions of DEMO_WORMHOLE_MAX_STABLE_TIME elapsed.
        - wh_unknown: signature-linked but sig_type=wormhole with no
            identified WormholeType yet - the "no data" gray state.
        - wh_mass_critical: mass_status="critical" (manual, no wormhole
            type needed) - the dashed-stroke mass signal, independent of
            time_status color.
        - wh_ship_small/medium/large/capital: ship_size_limit set directly
            (no wormhole type) - the S/M/L/XL edge badge's manual-fallback
            path.
        - stargate/ansiblex: FIXED_CONNECTION_STYLE's non-color-coded looks
            (solid white / dashed dim) - no signatures, matching how a real
            stargate/Ansiblex connection is auto-linked, not scanned.
        """

        defaults = {"connection_type": "wormhole"}
        top_signature = None
        bottom_signature = None

        if kind == "stargate":
            defaults["connection_type"] = "stargate"
        elif kind == "ansiblex":
            defaults["connection_type"] = "ansiblex"
        elif kind in ("wh_green", "wh_orange", "wh_red"):
            top_signature = Signature.objects.create(
                map_system=top_system,
                signature_id=next(sig_codes),
                sig_type="wormhole",
                wormhole_type=demo_wormhole_type,
            )
            bottom_signature = Signature.objects.create(
                map_system=bottom_system,
                signature_id=next(sig_codes),
                sig_type="wormhole",
            )
        elif kind == "wh_unknown":
            top_signature = Signature.objects.create(
                map_system=top_system, signature_id=next(sig_codes), sig_type="wormhole"
            )
            bottom_signature = Signature.objects.create(
                map_system=bottom_system, signature_id=next(sig_codes), sig_type="wormhole"
            )
        elif kind == "wh_mass_critical":
            defaults["mass_status"] = "critical"
        elif kind.startswith("wh_ship_"):
            defaults["ship_size_limit"] = kind.removeprefix("wh_ship_")

        connection = WormholeConnection.objects.create(
            map=map_obj,
            top_system=top_system,
            bottom_system=bottom_system,
            top_signature=top_signature,
            bottom_signature=bottom_signature,
            **defaults,
        )

        if kind in ("wh_green", "wh_orange", "wh_red"):
            fraction = {"wh_green": 0.2, "wh_orange": 0.65, "wh_red": 0.95}[kind]
            age_minutes = fraction * DEMO_WORMHOLE_MAX_STABLE_TIME
            WormholeConnection.objects.filter(pk=connection.pk).update(
                created_at=timezone.now() - timedelta(minutes=age_minutes)
            )
