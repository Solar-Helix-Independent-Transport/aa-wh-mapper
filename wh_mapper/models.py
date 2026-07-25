"""
App Models
"""

# Third Party
# Django EvE SDE
from eve_sde.models import SolarSystem

# Django
from django.conf import settings
from django.contrib.auth.models import Group
from django.core.serializers.json import DjangoJSONEncoder
from django.db import models
from django.db.models import Q
from django.utils import timezone

# Alliance Auth
from allianceauth.eveonline.models import EveCharacter


class MapQuerySet(models.QuerySet):
    """Custom queries for Map"""

    def visible_to(self, user):
        """Maps the user owns, plus shared maps granted to one of their
        characters, that character's corporation, that character's
        alliance, or a Django group the user belongs to. Superusers see
        every map.
        """

        if user.is_superuser:
            return self

        owned_characters = EveCharacter.objects.filter(
            character_ownership__user=user
        )
        character_ids = owned_characters.values_list("character_id", flat=True)
        corporation_ids = owned_characters.values_list("corporation_id", flat=True)
        alliance_ids = owned_characters.exclude(
            alliance_id__isnull=True
        ).values_list("alliance_id", flat=True)

        return self.filter(
            Q(owner=user)
            | Q(shares__scope=MapShare.Scope.CHARACTER, shares__target_id__in=character_ids)
            | Q(shares__scope=MapShare.Scope.CORPORATION, shares__target_id__in=corporation_ids)
            | Q(shares__scope=MapShare.Scope.ALLIANCE, shares__target_id__in=alliance_ids)
            | Q(group_shares__group__in=user.groups.all())
        ).distinct()


class Map(models.Model):
    """A wormhole chain map"""

    class Visibility(models.TextChoices):
        """Choices for Map.visibility"""

        PRIVATE = "private", "Private"
        SHARED = "shared", "Shared"

    name = models.CharField(max_length=100)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="wh_maps"
    )
    visibility = models.CharField(
        max_length=10, choices=Visibility.choices, default=Visibility.PRIVATE
    )
    created_at = models.DateTimeField(auto_now_add=True)

    objects = MapQuerySet.as_manager()

    class Meta:
        """Meta definitions"""

        permissions = (
            ("basic_access", "Can access this app and create maps"),
            ("admin_access", "Can manage and delete any map"),
        )
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class MapShare(models.Model):
    """A single character/corporation/alliance grant on a shared Map.

    A single scoped model rather than three near-identical ones: all three
    kinds of grant are stored by raw id rather than FK (see the class
    docstring note below), so they only ever differ by which id namespace
    `target_id` is drawn from.
    """

    class Scope(models.TextChoices):
        """Choices for MapShare.scope"""

        CHARACTER = "character", "Character"
        CORPORATION = "corporation", "Corporation"
        ALLIANCE = "alliance", "Alliance"

    map = models.ForeignKey(Map, on_delete=models.CASCADE, related_name="shares")
    scope = models.CharField(max_length=11, choices=Scope.choices)
    # A raw id rather than an FK to EveCharacter/EveCorporationInfo/
    # EveAllianceInfo - AllianceAuth only has a local row for those once
    # something has caused it to look them up, so sharing with an id it
    # hasn't seen yet is a valid, intentional state (see
    # wh_mapper.api.sharing._resolve_names).
    target_id = models.PositiveIntegerField()
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        """Meta definitions"""

        default_permissions = ()
        unique_together = ("map", "scope", "target_id")
        ordering = ["scope", "target_id"]

    def __str__(self) -> str:
        return f"{self.scope}:{self.target_id} ({self.map.name})"


class MapShareGroup(models.Model):
    """A single AllianceAuth (Django) group grant on a shared Map.

    Unlike the character/corporation/alliance grants above, a group is a
    first-party local row (not something only ever observed via ESI), so
    this is a real FK rather than a raw id.
    """

    map = models.ForeignKey(Map, on_delete=models.CASCADE, related_name="group_shares")
    group = models.ForeignKey(Group, on_delete=models.CASCADE)
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        """Meta definitions"""

        default_permissions = ()
        unique_together = ("map", "group")
        ordering = ["group_id"]

    def __str__(self) -> str:
        return f"{self.group} ({self.map.name})"


class MapSystem(models.Model):
    """A solar system placed on a Map."""

    map = models.ForeignKey(Map, on_delete=models.CASCADE, related_name="systems")
    solar_system = models.ForeignKey(SolarSystem, on_delete=models.PROTECT)
    label = models.CharField(max_length=100, blank=True, default="")
    x = models.FloatField(default=0)
    y = models.FloatField(default=0)
    # Marks a system as a locked "home base" - see
    # wh_mapper.api.systems.remove_system, which refuses to delete a system
    # while this is set.
    pinned = models.BooleanField(default=False)
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        """Meta definitions"""

        default_permissions = ()
        unique_together = ("map", "solar_system")

    def __str__(self) -> str:
        return f"{self.solar_system} ({self.map.name})"


class WormholeType(models.Model):
    """A wormhole type's static stats (K162, etc.), derived from SDE dogma
    data via the wh_mapper_derive_wormhole_types command.

    Per-system static wormhole connections are deliberately NOT modelled
    here: that data isn't part of CCP's SDE at all (it's community-curated,
    e.g. Anoikis/Eve-Scout style tables), so there is nothing to derive it
    from.
    """

    item_type = models.OneToOneField(
        "eve_sde.ItemType", on_delete=models.CASCADE, related_name="wh_mapper_wormhole_type"
    )
    # Not unique: CCP's SDE reuses the same displayed code (e.g. "C729")
    # across multiple distinct ItemTypes that differ only in
    # shattered-wormhole target-distribution weighting.
    code = models.CharField(max_length=10, db_index=True)
    # Not derivable from the SDE (no dogma attribute for it) - admin-editable only.
    leads_to_class = models.IntegerField(null=True, blank=True, default=None)
    max_mass = models.FloatField(null=True, blank=True, default=None)
    max_jump_mass = models.FloatField(null=True, blank=True, default=None)
    max_stable_time = models.FloatField(null=True, blank=True, default=None)

    class Meta:
        """Meta definitions"""

        default_permissions = ()
        ordering = ["code"]

    def __str__(self) -> str:
        return self.code


class Signature(models.Model):
    """A scanned cosmic signature within a MapSystem."""

    class SignatureType(models.TextChoices):
        """Choices for Signature.sig_type"""

        UNKNOWN = "unknown", "Unknown"
        WORMHOLE = "wormhole", "Wormhole"
        COMBAT = "combat", "Combat Site"
        DATA = "data", "Data Site"
        RELIC = "relic", "Relic Site"
        GAS = "gas", "Gas Site"
        ORE = "ore", "Ore Site"

    class LifeStatus(models.TextChoices):
        """Choices for Signature.life_status - a countdown-to-collapse
        ladder rather than a plain stable/EOL flag. When the wormhole type
        (and its max_stable_time) is known, this is fully computed from
        elapsed real time (see wh_mapper.api.helpers.life_status_for_remaining_hours)
        and these values are just labels for "hours of life left," not a
        user choice. Only while the type is still unidentified is this
        actually picked by hand, as a rough manual estimate.
        """

        STABLE = "stable", "Stable"
        LESS_THAN_48H = "lt_48h", "< 48 hours"
        LESS_THAN_24H = "lt_24h", "< 24 hours"
        LESS_THAN_12H = "lt_12h", "< 12 hours"
        LESS_THAN_4H = "lt_4h", "< 4 hours"
        LESS_THAN_1H = "lt_1h", "< 1 hour"

    map_system = models.ForeignKey(
        MapSystem, on_delete=models.CASCADE, related_name="signatures"
    )
    signature_id = models.CharField(max_length=10)
    sig_type = models.CharField(
        max_length=10, choices=SignatureType.choices, default=SignatureType.UNKNOWN
    )
    wormhole_type = models.ForeignKey(
        WormholeType, on_delete=models.SET_NULL, null=True, blank=True
    )
    life_status = models.CharField(
        max_length=10, choices=LifeStatus.choices, default=LifeStatus.STABLE
    )
    # When life_status was last manually set (only meaningful while the
    # wormhole type is unidentified - see LifeStatus above) - distinct from
    # updated_at, which bumps on *any* field edit (e.g. fixing sig_type) and
    # would otherwise keep restarting the assumed countdown for unrelated
    # changes. Used to compute how much of the manually-picked bucket's
    # assumed remaining time has elapsed - see
    # wh_mapper.api.helpers.life_status_for_remaining_hours.
    life_status_marked_at = models.DateTimeField(null=True, blank=True, default=None)
    # Hides this signature from the default signature list and from
    # jump-identification candidates, without deleting it - e.g. for a
    # misidentified or otherwise irrelevant scan result the user wants out
    # of the way but not re-created by the next paste-scan.
    is_hidden = models.BooleanField(default=False)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        """Meta definitions"""

        default_permissions = ()
        unique_together = ("map_system", "signature_id")

    def __str__(self) -> str:
        return f"{self.signature_id} ({self.map_system})"


class WormholeConnection(models.Model):
    """A connection between two MapSystems on the same Map - a scanned
    wormhole, a regular k-space stargate, or a player-built Ansiblex jump
    gate.

    Only one *stargate* connection may exist between a given pair of
    MapSystems on a Map (see the unique constraint below) - a k-space gate
    pairing is fixed and singular in-game. Wormhole (and Ansiblex)
    connections are not deduplicated: two separate wormholes really can
    connect the same pair of systems, so manual connects are allowed to
    create additional rows for the same pair. Auto-detected stargate writes
    funnel through wh_mapper.api.helpers.get_or_create_connection, which
    also canonicalizes (top_system, bottom_system) by pk so a request naming
    the pair in the opposite order can't slip past the constraint as a
    distinct row."""

    class ConnectionType(models.TextChoices):
        """Choices for WormholeConnection.connection_type"""

        WORMHOLE = "wormhole", "Wormhole"
        STARGATE = "stargate", "Stargate"
        ANSIBLEX = "ansiblex", "Ansiblex Jump Gate"

    class MassStatus(models.TextChoices):
        """Choices for WormholeConnection.mass_status"""

        UNKNOWN = "unknown", "Unknown"
        FRESH = "fresh", "Fresh"
        REDUCED = "reduced", "Reduced"
        CRITICAL = "critical", "Critical"

    class ShipSize(models.TextChoices):
        """Choices for WormholeConnection.ship_size_limit"""

        UNKNOWN = "unknown", "Unknown"
        SMALL = "small", "Small"
        MEDIUM = "medium", "Medium"
        LARGE = "large", "Large"
        CAPITAL = "capital", "Capital"

    map = models.ForeignKey(Map, on_delete=models.CASCADE, related_name="connections")
    connection_type = models.CharField(
        max_length=10, choices=ConnectionType.choices, default=ConnectionType.WORMHOLE
    )
    top_system = models.ForeignKey(
        MapSystem, on_delete=models.CASCADE, related_name="connections_as_top"
    )
    bottom_system = models.ForeignKey(
        MapSystem, on_delete=models.CASCADE, related_name="connections_as_bottom"
    )
    top_signature = models.ForeignKey(
        Signature,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="connection_as_top",
    )
    bottom_signature = models.ForeignKey(
        Signature,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="connection_as_bottom",
    )
    life_status = models.CharField(
        max_length=10,
        choices=Signature.LifeStatus.choices,
        default=Signature.LifeStatus.STABLE,
    )
    # When life_status was last manually set - see
    # Signature.life_status_marked_at for why this needs its own field
    # instead of reusing updated_at.
    life_status_marked_at = models.DateTimeField(null=True, blank=True, default=None)
    mass_status = models.CharField(
        max_length=10, choices=MassStatus.choices, default=MassStatus.UNKNOWN
    )
    ship_size_limit = models.CharField(
        max_length=10, choices=ShipSize.choices, default=ShipSize.UNKNOWN
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        """Meta definitions"""

        default_permissions = ()
        # A nested Meta class body doesn't see ConnectionType as a bare name
        # (class bodies aren't an enclosing scope for nested classes), and
        # WormholeConnection itself isn't fully defined yet at this point
        # either - so this has to be the literal value rather than
        # ConnectionType.STARGATE.
        constraints = [
            models.UniqueConstraint(
                fields=["map", "top_system", "bottom_system"],
                condition=models.Q(connection_type="stargate"),
                name="unique_stargate_connection_per_pair",
            )
        ]

    def __str__(self) -> str:
        return f"{self.top_system} <-> {self.bottom_system}"


class TrackedCharacter(models.Model):
    """A character whose in-game location is polled via ESI and reflected
    live on every Map its owner currently has open. Only polled while
    `added_by` has at least one active MapPresence row (see MapPresence) -
    i.e. someone is actually watching some map.
    """

    character = models.ForeignKey(EveCharacter, on_delete=models.CASCADE)
    added_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    # Whether the character was online as of the last successful ESI
    # online-status check (see wh_mapper.tasks._character_is_online) - used
    # to skip a wasted location lookup while they're offline, and persisted
    # here (rather than cached) so a 304 from that endpoint can resolve to
    # the last confirmed state instead of "unknown".
    is_active = models.BooleanField(default=True)
    last_solar_system = models.ForeignKey(
        SolarSystem, on_delete=models.SET_NULL, null=True, blank=True
    )
    last_seen_at = models.DateTimeField(null=True, blank=True)
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        """Meta definitions"""

        default_permissions = ()
        unique_together = ("added_by", "character")

    def __str__(self) -> str:
        return f"{self.character} (tracked by {self.added_by})"


class MapPresence(models.Model):
    """A currently-open websocket connection to a Map, used to gate ESI
    location polling to characters whose owner is actually watching.
    """

    map = models.ForeignKey(Map, on_delete=models.CASCADE, related_name="presence")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    channel_name = models.CharField(max_length=255)
    connected_at = models.DateTimeField(auto_now_add=True)
    # Bumped on every client heartbeat ping (see MapConsumer.receive_json) -
    # unlike connected_at (fixed at connect time), this is what
    # wh_mapper.tasks.prune_stale_map_presence uses to tell a connection
    # that's still genuinely open from one whose disconnect() never fired
    # (e.g. a worker crash/restart, or a dropped connection the server
    # hasn't noticed yet).
    last_seen_at = models.DateTimeField(default=timezone.now)

    class Meta:
        """Meta definitions"""

        default_permissions = ()
        unique_together = ("map", "channel_name")

    def __str__(self) -> str:
        return f"{self.user} on {self.map.name}"


class SystemSovereignty(models.Model):
    """A live snapshot of null-sec/FW sovereignty for one solar system, from
    ESI's GetSovereigntySystems - refreshed periodically by
    wh_mapper.tasks.refresh_system_sovereignty. Deliberately not an FK to
    eve_sde.SolarSystem (a soft reference by id only), so this app never
    needs a migration coupling to that separate package's migration state.
    No row for a given solar_system_id means unclaimed (or wormhole/abyssal
    space, which never appear in this ESI response at all) - see
    wh_mapper.api.helpers.bulk_system_owners, which falls back from this to
    a system's static (SDE) faction_id_raw for NPC-owned space.
    """

    solar_system_id = models.PositiveIntegerField(primary_key=True)
    alliance_id = models.PositiveIntegerField(null=True, blank=True, default=None)
    # Not eve_sde.SolarSystem.faction_id_raw's static lore-ownership concept -
    # this is ESI's live Faction Warfare militia capture state for a
    # low-sec system, which can flip. Both end up rendered the same way
    # (an NPC faction badge), but don't conflate the two sources.
    faction_id = models.PositiveIntegerField(null=True, blank=True, default=None)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        """Meta definitions"""

        default_permissions = ()

    def __str__(self) -> str:
        return f"sovereignty for system {self.solar_system_id}"


class Route(models.Model):
    """A shared, live-updating route between two solar systems - an opt-in
    promotion of an on-demand route computation (see
    wh_mapper.api.route.compute_route) into a persisted, Celery-refreshed,
    websocket-broadcast resource so multiple people can watch the same
    route update as connections change, without each computing their own.

    Deliberately scoped to the owner's own visible-map graph rather than
    per-viewer - a viewer may see a leg implying a connection they
    couldn't otherwise see on their own maps. An accepted tradeoff for
    keeping this a simple, disposable, link-shared artifact rather than a
    fully permissioned collaborative one - see the wayfinder map's ticket 08.
    """

    class Visibility(models.TextChoices):
        """Choices for Route.visibility"""

        PRIVATE = "private", "Private"
        SHARED = "shared", "Shared"

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="wh_routes"
    )
    start_system = models.ForeignKey(
        SolarSystem, on_delete=models.CASCADE, related_name="+"
    )
    end_system = models.ForeignKey(
        SolarSystem, on_delete=models.CASCADE, related_name="+"
    )
    visibility = models.CharField(
        max_length=10, choices=Visibility.choices, default=Visibility.PRIVATE
    )
    # Wholesale-replaced computed cache (RouteDetail shape), never edited
    # piecemeal - a plain JSON field rather than relational rows like
    # MapSystem/WormholeConnection, which are genuinely user-edited.
    found = models.BooleanField(default=False)
    # DjangoJSONEncoder, not the default - legs carry a nested `connection`
    # dict (see route_result_to_schema) whose fields include real datetime
    # objects (created_at etc.), which the plain json encoder can't handle.
    systems = models.JSONField(default=list, blank=True, encoder=DjangoJSONEncoder)
    legs = models.JSONField(default=list, blank=True, encoder=DjangoJSONEncoder)
    # A strictly-shorter, risk-ignoring alternative to the route above (RouteDetail
    # shape, or None) - see wh_mapper.pathfinding.RouteComputation.alternate.
    alternate = models.JSONField(default=None, null=True, blank=True, encoder=DjangoJSONEncoder)
    last_computed_at = models.DateTimeField(null=True, blank=True, default=None)
    # Bumped whenever someone loads this route's page or a websocket
    # connects to it - see wh_mapper.tasks.prune_stale_routes, which mirrors
    # prune_stale_map_presence's use of MapPresence.last_seen_at.
    last_viewed_at = models.DateTimeField(default=timezone.now)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        """Meta definitions"""

        default_permissions = ()

    def __str__(self) -> str:
        return f"{self.start_system} -> {self.end_system}"


class ConnectionFlag(models.Model):
    """A suggested status change on a WormholeConnection from a user who
    can't edit the underlying map directly (e.g. viewing a shared Route
    built from someone else's visible maps - see Route's docstring).

    Carries the same vocabulary as WormholeConnection's own editable
    fields so an editor's "accept" can feed straight into the existing
    wh_mapper.api.helpers.apply_life_status / connection delete logic,
    rather than needing separate handling. Transient by design - accepting
    or dismissing a flag deletes it; no history is kept (see the wayfinder
    map's ticket 11).
    """

    connection = models.ForeignKey(
        WormholeConnection, on_delete=models.CASCADE, related_name="flags"
    )
    flagged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+"
    )
    suggested_life_status = models.CharField(
        max_length=10, choices=Signature.LifeStatus.choices, null=True, blank=True
    )
    suggested_mass_status = models.CharField(
        max_length=10, choices=WormholeConnection.MassStatus.choices, null=True, blank=True
    )
    suggests_collapsed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        """Meta definitions"""

        default_permissions = ()
        # One flag per user per connection - re-flagging replaces your own
        # prior suggestion rather than accumulating (see ticket 11).
        unique_together = ("connection", "flagged_by")
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"flag on {self.connection_id} by {self.flagged_by}"
