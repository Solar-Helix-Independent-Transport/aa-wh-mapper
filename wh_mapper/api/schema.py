"""API Schemas"""

# Standard Library
from datetime import datetime
from typing import Literal, Optional

# Third Party
from ninja import Schema

# Mirror wh_mapper.models.Signature.SignatureType/LifeStatus and
# WormholeConnection.MassStatus/ShipSize's choices= - kept as plain Literal
# aliases (like connection_type/visibility below) rather than derived from
# the model at import time, so this file has no Django-app-registry-order
# dependency on wh_mapper.models.
SignatureTypeLiteral = Literal[
    "unknown", "wormhole", "combat", "data", "relic", "gas", "ore"
]
LifeStatusLiteral = Literal["stable", "lt_48h", "lt_24h", "lt_12h", "lt_4h", "lt_1h"]
MassStatusLiteral = Literal["unknown", "fresh", "reduced", "critical"]
ShipSizeLiteral = Literal["unknown", "small", "medium", "large", "capital"]


class SystemOwnerOut(Schema):
    """Who controls a solar system - an NPC empire/pirate faction, or a
    player alliance holding null-sec sovereignty. See
    wh_mapper.api.helpers.bulk_system_owners."""

    type: Literal["alliance", "faction"]
    id: int
    name: str
    # Factions don't have tickers in EVE - only ever set for type="alliance".
    ticker: str | None = None
    icon_url: str


class SolarSystemOut(Schema):
    """A referenced eve_sde.SolarSystem"""

    id: int
    name: str
    security_status: float | None = None
    wormhole_class_id: int | None = None
    visual_effect: str | None = None
    constellation_name: str | None = None
    region_name: str | None = None
    space_type: str
    owner: SystemOwnerOut | None = None


class MapOut(Schema):
    """A Map"""

    id: int
    name: str
    owner_id: int
    owner_name: str
    visibility: Literal["private", "shared"]
    created_at: datetime
    is_owner: bool
    can_edit_sharing: bool
    active_users: int


class MapCreate(Schema):
    """Payload to create a Map"""

    name: str
    visibility: Literal["private", "shared"] = "private"


class MapUpdate(Schema):
    """Payload to update a Map"""

    name: str | None = None
    visibility: Literal["private", "shared"] | None = None


class MapSystemOut(Schema):
    """A MapSystem"""

    id: int
    map_id: int
    solar_system: SolarSystemOut
    label: str
    x: float
    y: float
    pinned: bool
    added_by_id: int | None = None
    added_at: datetime


class MapSystemCreate(Schema):
    """Payload to add a solar system to a Map"""

    solar_system_id: int
    label: str = ""
    x: float = 0
    y: float = 0
    pinned: bool = False


class MapSystemUpdate(Schema):
    """Payload to update a MapSystem"""

    label: str | None = None
    x: float | None = None
    y: float | None = None
    pinned: bool | None = None


class WormholeTypeOut(Schema):
    """A referenced wh_mapper.WormholeType"""

    code: str
    leads_to_class: int | None = None
    max_mass: float | None = None
    max_jump_mass: float | None = None
    max_stable_time: float | None = None


class SignatureOut(Schema):
    """A Signature"""

    id: int
    map_system_id: int
    signature_id: str
    sig_type: SignatureTypeLiteral
    wormhole_type: WormholeTypeOut | None = None
    life_status: LifeStatusLiteral
    life_status_marked_at: datetime | None = None
    is_hidden: bool
    updated_by_id: int | None = None
    updated_at: datetime


class SignatureCreate(Schema):
    """Payload to add a Signature to a MapSystem"""

    signature_id: str
    sig_type: SignatureTypeLiteral = "unknown"
    wormhole_type_code: str | None = None
    life_status: LifeStatusLiteral = "stable"


class SignatureUpdate(Schema):
    """Payload to update a Signature"""

    sig_type: SignatureTypeLiteral | None = None
    wormhole_type_code: str | None = None
    life_status: LifeStatusLiteral | None = None
    is_hidden: bool | None = None


class SignatureBulkRow(Schema):
    """A single row from a pasted probe-scan result"""

    signature_id: str
    sig_type: SignatureTypeLiteral | None = None


class SignatureBulkUpsert(Schema):
    """Payload to bulk-upsert Signatures on a MapSystem, by signature_id"""

    rows: list[SignatureBulkRow]
    # "Lazy delete": treat any existing signature in this MapSystem that
    # isn't in `rows` as gone (decayed, or its wormhole collapsed) and remove
    # it, along with any WormholeConnection linked to it.
    lazy_delete: bool = False
    # Only meaningful when lazy_delete is also true - additionally remove any
    # MapSystem left with zero connections by one of those removals (unless
    # pinned), cascading to any system that in turn goes dangling.
    remove_dangling_systems: bool = False


class SignatureBulkResult(Schema):
    """Result of a bulk Signature upsert"""

    signatures: list[SignatureOut]
    removed_signature_ids: list[int] = []
    removed_connection_ids: list[int] = []
    removed_system_ids: list[int] = []


class ConnectionSignatureLink(Schema):
    """Payload to attach a Signature to whichever end of a WormholeConnection
    it belongs to"""

    signature_id: int


class WormholeConnectionOut(Schema):
    """A WormholeConnection"""

    id: int
    map_id: int
    connection_type: Literal["wormhole", "stargate", "ansiblex"]
    top_system_id: int
    bottom_system_id: int
    top_signature_id: int | None = None
    bottom_signature_id: int | None = None
    life_status: LifeStatusLiteral
    life_status_marked_at: datetime | None = None
    mass_status: MassStatusLiteral
    ship_size_limit: ShipSizeLiteral
    time_status: Literal["green", "orange", "red"]
    created_by_id: int | None = None
    created_at: datetime
    updated_at: datetime


class WormholeConnectionCreate(Schema):
    """Payload to create a WormholeConnection"""

    top_system_id: int
    bottom_system_id: int
    connection_type: Literal["wormhole", "stargate", "ansiblex"] = "wormhole"
    top_signature_id: int | None = None
    bottom_signature_id: int | None = None
    mass_status: MassStatusLiteral = "unknown"
    ship_size_limit: ShipSizeLiteral = "unknown"


class WormholeConnectionUpdate(Schema):
    """Payload to update a WormholeConnection"""

    connection_type: Literal["wormhole", "stargate", "ansiblex"] | None = None
    life_status: LifeStatusLiteral | None = None
    mass_status: MassStatusLiteral | None = None
    ship_size_limit: ShipSizeLiteral | None = None


class TrackedCharacterOut(Schema):
    """A character being live-tracked on a Map via ESI location polling"""

    character_id: int
    character_name: str
    added_by_id: int
    is_online: bool
    last_solar_system: SolarSystemOut | None = None
    last_seen_at: datetime | None = None


class TrackableCharacterOut(Schema):
    """One of the requesting user's own characters that has ESI location
    access granted - either currently tracked, or available to toggle on
    without needing another EVE SSO round-trip."""

    character_id: int
    character_name: str
    is_tracked: bool
    is_online: bool = False
    last_solar_system: SolarSystemOut | None = None
    last_seen_at: datetime | None = None


class MapStateOut(Schema):
    """A full snapshot of a Map's graph"""

    map: MapOut
    systems: list[MapSystemOut]
    signatures: list[SignatureOut]
    connections: list[WormholeConnectionOut]
    tracked_characters: list[TrackedCharacterOut]
    current_user_id: int


class CharacterSearchResult(Schema):
    """A character search hit"""

    character_id: int
    character_name: str
    corporation_name: str = ""


class CorporationSearchResult(Schema):
    """A corporation search hit"""

    corporation_id: int
    corporation_name: str


class AllianceSearchResult(Schema):
    """An alliance search hit"""

    alliance_id: int
    alliance_name: str


class GroupSearchResult(Schema):
    """A group search hit - limited server-side to groups the requesting
    user is a member of."""

    group_id: int
    group_name: str


class ShareCreate(Schema):
    """Payload to grant map access"""

    scope: Literal["character", "corporation", "alliance", "group"]
    target_id: int


class ShareOut(Schema):
    """A single share grant"""

    scope: Literal["character", "corporation", "alliance", "group"]
    target_id: int
    # None for a character/corporation/alliance id AA has never seen locally
    # (shares are stored by raw id, not FK, so that's a valid state - see
    # wh_mapper.models.MapShare).
    target_name: str | None = None


class RegionOut(Schema):
    """A "flat" (regular k-space) eve_sde.Region, selectable to bulk-populate
    a map."""

    id: int
    name: str


class RegionImportRequest(Schema):
    """Payload to bulk-add every system in a Region to a Map"""

    region_id: int


class RegionImportResult(Schema):
    """Summary of a region bulk-import"""

    systems_added: int
    connections_added: int
