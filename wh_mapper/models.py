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
        alliance, or a Django group the user belongs to - plus every
        read_only Map (the eve-scout reference maps), visible to anyone
        regardless of ownership/sharing since they need no per-user grant
        (see Map.read_only). Superusers see every map.
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
            | Q(read_only=True)
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
    # Marks a Map like the eve-scout Thera/Turnur reference maps (see
    # wh_mapper.tasks.sync_eve_scout_thera_turnur) - kept in sync by a
    # background task, not meant for anyone to edit by hand. A deliberate,
    # narrow exception to this app's usual "visible == editable" rule (see
    # can_edit_map's docstring in wh_mapper.api.helpers): visible_to below
    # makes a read_only Map visible to every basic_access user with no
    # MapShare/MapShareGroup needed, and every content-mutation endpoint
    # (wh_mapper.api.helpers.require_writable_map) rejects non-admins.
    read_only = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = MapQuerySet.as_manager()

    class Meta:
        """Meta definitions"""

        permissions = (
            ("basic_access", "Can access this app and create maps"),
            ("admin_access", "Can manage and delete any map"),
            (
                "backseat_fc",
                "Can operate fleet tracking on behalf of another character",
            ),
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
    # No SDE dogma attribute for this - wh_mapper_derive_wormhole_types sets
    # it from a hardcoded code -> class table instead (CODE_TO_CLASS there).
    # Still admin-editable for any code that table doesn't recognize (a K162
    # has no single destination class, and new codes may lag the table).
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


class SystemStatic(models.Model):
    """A J-space system's fixed static wormhole connections - which
    wormhole type code(s) permanently spawn in this specific system (e.g.
    every "J123456" C3 always rolls a static N968), as opposed to
    WormholeType, which describes what a *code* is (mass/lifetime/leads-to-
    class) once scanned. Not part of CCP's SDE either (same as
    WormholeType - see its docstring): sourced from zKillboard's
    setup/wh_effects.csv (community-curated) via the
    wh_mapper_import_system_statics command.

    Soft reference by id only, like SystemSovereignty - this is bulk
    reference data imported independently of the eve_sde app's own SDE
    import, not something that should couple this app's migration state to
    that separate package's.
    """

    solar_system_id = models.PositiveIntegerField(primary_key=True)
    # Raw wormhole type codes (e.g. ["N968", "K162"]), not FKs to
    # WormholeType - that model's rows only exist once
    # wh_mapper_derive_wormhole_types has run against an imported SDE (see
    # its docstring), and code isn't even unique there. Resolving a code to
    # its leads_to_class instead goes through constants.CODE_TO_CLASS (see
    # wh_mapper.api.helpers.bulk_system_statics), the same source-of-truth
    # table that command uses.
    codes = models.JSONField(default=list)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        """Meta definitions"""

        default_permissions = ()

    def __str__(self) -> str:
        return f"statics for system {self.solar_system_id}: {', '.join(self.codes)}"


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
        (and its max_stable_time) is known, this is normally fully computed
        from elapsed real time (see
        wh_mapper.api.helpers.life_status_for_remaining_hours) and these
        values are just labels for "hours of life left," not a user choice.
        A manual pick is still allowed even once the type is known, though -
        see wh_mapper.api.helpers.remaining_life_hours - it just only takes
        effect when it's *more* urgent than the computed bucket, letting a
        player correct for a hole that was already open before it got added
        to the map.
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
    # When life_status was last manually set (see LifeStatus above - still
    # meaningful once the wormhole type is identified, as an "at least this
    # urgent" override) - distinct from updated_at, which bumps on *any*
    # field edit (e.g. fixing sig_type) and
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
        # Between Large and Capital (e.g. supercarrier-incapable but
        # freighter/jump-freighter-capable) - eve-scout.com's own
        # max_ship_size enum distinguishes this from Large, which this app
        # previously had no matching choice for. max_length=10 below already
        # fits "xlarge", so no migration is needed for the column itself.
        XLARGE = "xlarge", "X-Large"
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
    # Cumulative mass (kg) crossed by tracked fleet members - never
    # decrements, so identifying this connection's WormholeType *after*
    # crossings already happened needs no backfill (mass_remaining is
    # always max_mass - mass_crossed, computed on read - see
    # wh_mapper.api.helpers.connection_effective_mass_status). This is the
    # manual fallback mass_status stays untouched by crossings; it's only
    # ever hand-set while the wormhole type is unidentified, same role
    # life_status plays for time-based decay. See the fleet-mass-tracking
    # wayfinder map's ticket 06.
    mass_crossed = models.FloatField(default=0)
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


class FleetTrackingSession(models.Model):
    """A live, backseat-operated tracking session against one in-game EVE
    Fleet, polled off its fleet boss's own ESI token (see
    wh_mapper.tasks.poll_fleet_session) - the fleet-mass-tracking wayfinder
    map's counterpart to TrackedCharacter, but for a whole fleet rather than
    one owned character, and driven by whoever holds the `backseat_fc`
    permission rather than the character's own owner.

    `fc_character` is unique: per ticket 07, there's never more than one
    active session per character at a time (a second operator attaches as a
    FleetTrackingWatcher instead - see that model), and a stopped session's
    row is deleted immediately rather than kept around, so "has a row at
    all" and "is active" are the same thing.
    """

    fc_character = models.OneToOneField(EveCharacter, on_delete=models.CASCADE)
    started_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+"
    )
    fleet_id = models.BigIntegerField()
    started_at = models.DateTimeField(auto_now_add=True)
    last_polled_at = models.DateTimeField(null=True, blank=True, default=None)
    # Consecutive failed fleet-members polls (see
    # constants.FLEET_SESSION_FAILURE_THRESHOLD) - reset to 0 on any
    # successful poll, tolerating one transient ESI blip before auto-stopping.
    consecutive_failures = models.PositiveIntegerField(default=0)

    class Meta:
        """Meta definitions"""

        default_permissions = ()

    def __str__(self) -> str:
        return f"fleet tracking for {self.fc_character} (fleet {self.fleet_id})"


class FleetTrackingWatcher(models.Model):
    """A second backseat-permitted operator attached to an already-active
    FleetTrackingSession rather than starting a duplicate of their own - see
    ticket 07. Only the session's own `started_by` can stop it; a watcher
    can only detach."""

    session = models.ForeignKey(
        FleetTrackingSession, on_delete=models.CASCADE, related_name="watchers"
    )
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    attached_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        """Meta definitions"""

        default_permissions = ()
        unique_together = ("session", "user")

    def __str__(self) -> str:
        return f"{self.user} watching {self.session}"


class FleetMemberState(models.Model):
    """One fleet member's last-known ship/location within a
    FleetTrackingSession - the per-member state
    wh_mapper.tasks.poll_fleet_session diffs each poll against to detect a
    jump, since fleet members generally have no TrackedCharacter row of
    their own to hold this (see ticket 01)."""

    session = models.ForeignKey(
        FleetTrackingSession, on_delete=models.CASCADE, related_name="members"
    )
    character_id = models.PositiveIntegerField()
    character_name = models.CharField(max_length=100, blank=True, default="")
    ship_type_id = models.PositiveIntegerField(null=True, blank=True)
    last_solar_system = models.ForeignKey(
        SolarSystem, on_delete=models.SET_NULL, null=True, blank=True
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        """Meta definitions"""

        default_permissions = ()
        unique_together = ("session", "character_id")

    def __str__(self) -> str:
        return f"{self.character_name or self.character_id} in {self.session}"


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


class MapContribution(models.Model):
    """An append-only log of contribution-worthy work on a wormhole
    connection - who found it and who kept its status accurate - for
    bounty attribution on routes computed across it (see
    wh_mapper.api.helpers.record_contribution /
    _contributors_for_connection_ids).

    Deliberately separate from WormholeConnection.created_by, which only
    ever holds the most recent actor: this preserves every actor across a
    connection's lifetime, so a life/mass-status update by someone other
    than whoever first drew the connection still earns credit. Only ever
    recorded for connection_type=wormhole - stargates are static/
    auto-detected and ansiblex are player-built infrastructure, neither is
    "found" by anyone the way a scanned wormhole signature is.
    """

    class Verb(models.TextChoices):
        """Choices for MapContribution.verb"""

        ADDED = "added", "Added connection"
        UPDATED = "updated", "Updated connection status"
        SIGNATURE_LINKED = "signature_linked", "Linked signature"

    map = models.ForeignKey(Map, on_delete=models.CASCADE, related_name="contributions")
    # SET_NULL, not CASCADE - a route computed before the wormhole
    # collapsed still owes credit for the work that made it possible, so
    # the log outlives the connection row it was recorded against.
    connection = models.ForeignKey(
        WormholeConnection,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="contributions",
    )
    verb = models.CharField(max_length=20, choices=Verb.choices)
    # A snapshot of the acting user's main character at record time, not a
    # live lookup - rebinding your main later shouldn't retroactively
    # rewrite past bounty history.
    character = models.ForeignKey(
        EveCharacter, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        """Meta definitions"""

        default_permissions = ()
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.verb} on {self.connection_id} by {self.character or self.user}"


class TaskHeartbeat(models.Model):
    """A last-run marker for one of wh_mapper's periodic Celery tasks,
    recorded by the task itself on every run (see
    wh_mapper.tasks.record_task_heartbeat) - surfaced on the admin status
    page so a stopped/misconfigured beat schedule or a silently-dead worker
    shows up as "hasn't run since X" instead of only being noticed once a
    user complains that maps aren't updating.

    Not django-celery-beat's PeriodicTask.last_run_at - this project
    schedules tasks via plain CELERYBEAT_SCHEDULE (see README), not
    django-celery-beat, so there's no such row to read. This is scoped to
    exactly the periodic tasks wh_mapper itself cares about.
    """

    task_name = models.CharField(max_length=100, primary_key=True)
    last_run_at = models.DateTimeField()
    last_success = models.BooleanField(default=True)
    # Truncated exception text from the most recent failed run - blank
    # whenever last_success is True. Not a full traceback: this is a
    # glance-at-a-dashboard summary, not a log viewer.
    last_error = models.TextField(blank=True, default="")

    class Meta:
        """Meta definitions"""

        default_permissions = ()

    def __str__(self) -> str:
        return f"{self.task_name} @ {self.last_run_at}"
