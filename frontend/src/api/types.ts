export type MapVisibility = "private" | "shared";

export interface MapOut {
  id: number;
  name: string;
  owner_id: number;
  owner_name: string;
  visibility: MapVisibility;
  created_at: string;
  is_owner: boolean;
  can_edit_sharing: boolean;
  active_users: number;
}

// Who controls a solar system - an NPC empire/pirate faction, or a player
// alliance holding null-sec sovereignty. See
// wh_mapper.api.helpers.bulk_system_owners.
export interface SystemOwnerOut {
  type: "alliance" | "faction";
  id: number;
  name: string;
  // Factions don't have tickers in EVE - only ever set for type 'alliance'.
  ticker: string | null;
  icon_url: string;
}

export interface SolarSystemOut {
  id: number;
  name: string;
  security_status: number | null;
  wormhole_class_id: number | null;
  visual_effect: string | null;
  constellation_name: string | null;
  region_name: string | null;
  space_type: string;
  owner: SystemOwnerOut | null;
}

export interface MapSystemOut {
  id: number;
  map_id: number;
  solar_system: SolarSystemOut;
  label: string;
  x: number;
  y: number;
  pinned: boolean;
  added_by_id: number | null;
  added_at: string;
}

export interface WormholeTypeOut {
  code: string;
  leads_to_class: number | null;
  max_mass: number | null;
  max_jump_mass: number | null;
  max_stable_time: number | null;
}

export interface SignatureOut {
  id: number;
  map_system_id: number;
  signature_id: string;
  sig_type: string;
  wormhole_type: WormholeTypeOut | null;
  life_status: string;
  life_status_marked_at: string | null;
  is_hidden: boolean;
  updated_by_id: number | null;
  updated_at: string;
}

export type ConnectionType = "wormhole" | "stargate" | "ansiblex";

export interface WormholeConnectionOut {
  id: number;
  map_id: number;
  connection_type: ConnectionType;
  top_system_id: number;
  bottom_system_id: number;
  // top_system_id/bottom_system_id above are MapSystem ids, not comparable
  // to a SolarSystemOut.id (e.g. RouteDetail.systems[].id) - use these
  // instead when matching a connection's ends against solar-system-keyed
  // data.
  top_system_solar_system_id: number;
  bottom_system_solar_system_id: number;
  top_signature_id: number | null;
  bottom_signature_id: number | null;
  top_signature: SignatureOut | null;
  bottom_signature: SignatureOut | null;
  life_status: string;
  life_status_marked_at: string | null;
  mass_status: string;
  ship_size_limit: string;
  time_status: "green" | "orange" | "red" | "unknown";
  created_by_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface TrackedCharacterOut {
  character_id: number;
  character_name: string;
  added_by_id: number;
  is_online: boolean;
  last_solar_system: SolarSystemOut | null;
  last_seen_at: string | null;
}

export interface TrackableCharacterOut {
  character_id: number;
  character_name: string;
  is_tracked: boolean;
  is_online: boolean;
  last_solar_system: SolarSystemOut | null;
  last_seen_at: string | null;
}

export interface MapStateOut {
  map: MapOut;
  systems: MapSystemOut[];
  signatures: SignatureOut[];
  connections: WormholeConnectionOut[];
  tracked_characters: TrackedCharacterOut[];
  current_user_id: number;
}

// Payload of the `character.jump_needs_signature` websocket event, sent when
// a tracked character's jump auto-creates a wormhole connection with no
// signature attached yet (see wh_mapper.tasks._grow_map_for_character).
export interface JumpNeedsSignaturePrompt {
  connection_id: number;
  // Null when reopened manually from the map's "pending signatures" button
  // rather than delivered live off a character's jump - see MapView's
  // reopenPendingSignatures.
  character_name: string | null;
  old_map_system_id: number;
  new_map_system_id: number;
}

export type ShareScope = "character" | "corporation" | "alliance" | "group";

export interface ShareOut {
  scope: ShareScope;
  target_id: number;
  target_name: string | null;
}

export interface CharacterSearchResult {
  character_id: number;
  character_name: string;
  corporation_name: string;
}

export interface CorporationSearchResult {
  corporation_id: number;
  corporation_name: string;
}

export interface AllianceSearchResult {
  alliance_id: number;
  alliance_name: string;
}

export interface GroupSearchResult {
  group_id: number;
  group_name: string;
}

export interface RegionOut {
  id: number;
  name: string;
}

export interface RegionImportResult {
  systems_added: number;
  connections_added: number;
}

export interface SignatureBulkResult {
  signatures: SignatureOut[];
  removed_signature_ids: number[];
  removed_connection_ids: number[];
  removed_system_ids: number[];
}

export interface RouteLegOut {
  connection_type: ConnectionType;
  life_status: string | null;
  mass_status: string | null;
  map_id: number | null;
  connection_id: number | null;
  // Same WormholeConnectionOut shape the Map view uses (ship size,
  // time_status, signature ids, etc.) - null for a stargate leg.
  connection: WormholeConnectionOut | null;
}

export interface RouteDetail {
  systems: SolarSystemOut[];
  legs: RouteLegOut[];
}

export interface RouteOut {
  found: boolean;
  message: string | null;
  route: RouteDetail | null;
  // A strictly-shorter, risk-ignoring alternative `route` passed over -
  // null when no such alternative exists.
  alternate: RouteDetail | null;
}

export type RouteVisibility = "private" | "shared";

export interface SharedRouteOut {
  id: number;
  owner_id: number;
  start_system: SolarSystemOut;
  end_system: SolarSystemOut;
  visibility: RouteVisibility;
  found: boolean;
  systems: SolarSystemOut[];
  legs: RouteLegOut[];
  alternate: RouteDetail | null;
  last_computed_at: string | null;
  is_owner: boolean;
}

export interface ConnectionFlagOut {
  id: number;
  connection_id: number;
  flagged_by_id: number;
  flagged_by_name: string;
  suggested_life_status: string | null;
  suggested_mass_status: string | null;
  suggests_collapsed: boolean;
  created_at: string;
}

export interface ConnectionFlagAcceptResult {
  deleted: boolean;
  connection: WormholeConnectionOut | null;
}
