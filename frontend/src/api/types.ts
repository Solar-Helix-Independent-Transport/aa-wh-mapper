export type MapVisibility = "private" | "shared";

export interface MapOut {
  id: number;
  name: string;
  owner_id: number;
  owner_name: string;
  visibility: MapVisibility;
  // A managed reference map (the eve-scout Thera/Turnur maps) - visible to
  // everyone, but every content-mutation endpoint rejects non-admins. See
  // wh_mapper.models.Map.read_only.
  read_only: boolean;
  // Whether the current user can actually mutate this map's content right
  // now - use this (not read_only directly) to gate edit UI, since an
  // admin can still write to a read_only map.
  can_write: boolean;
  created_at: string;
  last_updated: string;
  is_owner: boolean;
  can_edit_sharing: boolean;
  active_users: number;
}

export interface MapImportResult {
  systems_added: number;
  connections_added: number;
  signatures_added: number;
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

// One of a J-space system's fixed static wormhole connections - see
// wh_mapper.models.SystemStatic. `leads_to_class` is null for a code
// wh_mapper's CODE_TO_CLASS table doesn't recognize (a new/unmapped code).
export interface SystemStaticOut {
  code: string;
  leads_to_class: number | null;
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
  // Only populated by callers that batch-resolve it server-side (the Map
  // view's get_map_state, add/update system, solar-system search) - empty
  // for k-space and for a J-space system with no imported statics.
  statics: SystemStaticOut[];
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

// The one piece of a system's detail view not already sitting in
// MapStateOut - see wh_mapper.api.schema.SystemDetailOut.
export interface SystemDetailOut {
  added_by_name: string | null;
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

export interface RegionGraphNodeOut {
  id: number;
  name: string;
  x: number;
  y: number;
  // The region's dominant security class ("High Sec"/"Low Sec"/"Null
  // Sec"/"Unknown"), from the *average* security_status across its member
  // systems - see wh_mapper.api.helpers.build_region_graph.
  space_type: string;
}

export interface RegionGraphEdgeOut {
  source: number;
  target: number;
}

export type RegionGraphLandmarkKind = "thera" | "drifter" | "turnur";

export interface RegionGraphLandmarkOut {
  id: number;
  name: string;
  kind: RegionGraphLandmarkKind;
}

export interface RegionGraphOut {
  nodes: RegionGraphNodeOut[];
  edges: RegionGraphEdgeOut[];
  landmarks: RegionGraphLandmarkOut[];
}

export interface RegionImportResult {
  systems_added: number;
  connections_added: number;
}

export interface AutoLayoutResult {
  updated: number;
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

// Someone credited with bounty-worthy work (finding or maintaining a
// wormhole connection) along a computed route - see
// wh_mapper.models.MapContribution.
export interface RouteContributorOut {
  character_id: number | null;
  name: string;
  contribution_count: number;
}

export interface RouteDetail {
  systems: SolarSystemOut[];
  legs: RouteLegOut[];
  contributors: RouteContributorOut[];
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
  contributors: RouteContributorOut[];
  alternate: RouteDetail | null;
  last_computed_at: string | null;
  is_owner: boolean;
}

// One MapContribution row - a single bounty-attribution-worthy action
// recorded against a wormhole connection. `name` follows the same
// character-else-username fallback as RouteContributorOut.
export interface MapContributionOut {
  id: number;
  verb: "added" | "updated" | "signature_linked";
  character_id: number | null;
  name: string;
  created_at: string;
}

// Everything beyond WormholeConnectionOut's own fields for the right-click
// "Details" view - see wh_mapper.api.schema.ConnectionDetailOut.
export interface ConnectionDetailOut {
  created_by_name: string | null;
  contributions: MapContributionOut[];
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

// One character in the backseat-FC token pool - see the fleet-mass-
// tracking wayfinder map's tickets 02/12.
export interface AvailableFleetCharacterOut {
  character_id: number;
  character_name: string;
  owner_name: string;
  has_active_session: boolean;
}

// One fleet member's live ship/location - hop_distance is null for ticket
// 09's "unknown" (unreachable within the viewer's visible graph) state,
// distinct from 0 (the fleet boss) or 1 (adjacent).
export interface FleetMemberOut {
  character_id: number;
  character_name: string;
  ship_type_name: string;
  solar_system: SolarSystemOut;
  hop_distance: number | null;
}

export interface FleetSessionOut {
  id: number;
  fc_character_id: number;
  fc_character_name: string;
  fleet_id: number;
  started_by_id: number;
  started_at: string;
  is_watcher: boolean;
  is_starter: boolean;
  members: FleetMemberOut[];
}

// Local eve_sde import health - build_number/release_date/last_check_date
// are null if the SDE has never been imported at all in this environment.
export interface SdeStatusOut {
  build_number: number | null;
  release_date: string | null;
  last_check_date: string | null;
  total_solar_systems: number;
  total_jspace_systems: number;
  jspace_with_raw_wormhole_class: number;
}

// One periodic task's last-run status - last_run_at/last_success are null
// if the task has never run at all in this environment (still `stale`).
export interface TaskHeartbeatOut {
  task_name: string;
  expected_interval_seconds: number;
  last_run_at: string | null;
  last_success: boolean | null;
  last_error: string;
  stale: boolean;
}

export interface UsageStatsOut {
  total_maps: number;
  private_maps: number;
  shared_maps: number;
  active_tracked_characters: number;
  live_map_presences: number;
}

export interface WormholeTypeCoverageOut {
  total: number;
  with_leads_to_class: number;
  with_max_mass: number;
  with_max_jump_mass: number;
  with_max_stable_time: number;
}

// One Map row in the admin status page's full listing - admin-wide (every
// map, not just the viewer's), so no viewer-relative fields like is_owner.
export interface MapSummaryOut {
  id: number;
  name: string;
  owner_name: string;
  visibility: MapVisibility;
  created_at: string;
  last_updated: string;
  system_count: number;
  active_users: number;
}

// One current (not yet pruned) shared Route - used both by the admin
// status page and the maps screen's "My shared routes" panel.
export interface RouteSummaryOut {
  id: number;
  owner_name: string;
  start_system_name: string;
  end_system_name: string;
  visibility: MapVisibility;
  found: boolean;
  last_viewed_at: string;
  created_at: string;
}

export interface AppStatusOut {
  sde: SdeStatusOut;
  tasks: TaskHeartbeatOut[];
  usage: UsageStatsOut;
  wormhole_types: WormholeTypeCoverageOut;
  maps: MapSummaryOut[];
  routes: RouteSummaryOut[];
}
