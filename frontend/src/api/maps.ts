import { api } from "./client";
import { WH_MAPPER_URL_PREFIX } from "../constants";
import type {
  AllianceSearchResult,
  CharacterSearchResult,
  ConnectionDetailOut,
  ConnectionType,
  CorporationSearchResult,
  GroupSearchResult,
  MapOut,
  MapStateOut,
  MapSystemOut,
  MapVisibility,
  RegionGraphOut,
  RegionImportResult,
  RegionOut,
  ShareOut,
  ShareScope,
  SignatureBulkResult,
  SignatureOut,
  SolarSystemOut,
  SystemDetailOut,
  TrackableCharacterOut,
  TrackedCharacterOut,
  WormholeConnectionOut,
  WormholeTypeOut,
} from "./types";

export const searchSolarSystems = (query: string) =>
  api.get<SolarSystemOut[]>(
    `/solar-systems/search/${encodeURIComponent(query)}/`,
  );

export const listMaps = () => api.get<MapOut[]>("/maps/");

export const createMap = (
  name: string,
  visibility: MapVisibility = "private",
) => api.post<MapOut>("/maps/", { name, visibility });

export const updateMap = (
  mapId: number,
  changes: Partial<Pick<MapOut, "name" | "visibility">>,
) => api.patch<MapOut>(`/maps/${mapId}/`, changes);

export const deleteMap = (mapId: number) => api.delete<void>(`/maps/${mapId}/`);

export const getMapState = (mapId: number) =>
  api.get<MapStateOut>(`/maps/${mapId}/state/`);

export const addSystem = (
  mapId: number,
  payload: {
    solar_system_id: number;
    label?: string;
    x?: number;
    y?: number;
    pinned?: boolean;
  },
) => api.post<MapSystemOut>(`/maps/${mapId}/systems/`, payload);

export const updateSystem = (
  mapId: number,
  systemId: number,
  changes: Partial<{ label: string; x: number; y: number; pinned: boolean }>,
) => api.patch<MapSystemOut>(`/maps/${mapId}/systems/${systemId}/`, changes);

export const removeSystem = (mapId: number, systemId: number) =>
  api.delete<void>(`/maps/${mapId}/systems/${systemId}/`);

export const getSystemDetails = (mapId: number, systemId: number) =>
  api.get<SystemDetailOut>(`/maps/${mapId}/systems/${systemId}/details/`);

export const addSignature = (
  mapId: number,
  systemId: number,
  payload: {
    signature_id: string;
    sig_type?: string;
    wormhole_type_code?: string | null;
    life_status?: string;
  },
) =>
  api.post<SignatureOut>(
    `/maps/${mapId}/systems/${systemId}/signatures/`,
    payload,
  );

export const updateSignature = (
  mapId: number,
  systemId: number,
  signatureId: number,
  changes: Partial<{
    sig_type: string;
    wormhole_type_code: string | null;
    life_status: string;
    is_hidden: boolean;
  }>,
) =>
  api.patch<SignatureOut>(
    `/maps/${mapId}/systems/${systemId}/signatures/${signatureId}/`,
    changes,
  );

export const removeSignature = (
  mapId: number,
  systemId: number,
  signatureId: number,
) =>
  api.delete<void>(
    `/maps/${mapId}/systems/${systemId}/signatures/${signatureId}/`,
  );

export const bulkUpsertSignatures = (
  mapId: number,
  systemId: number,
  rows: { signature_id: string; sig_type?: string }[],
  lazyDelete: boolean = false,
  removeDanglingSystems: boolean = false,
) =>
  api.post<SignatureBulkResult>(
    `/maps/${mapId}/systems/${systemId}/signatures/bulk/`,
    {
      rows,
      lazy_delete: lazyDelete,
      remove_dangling_systems: removeDanglingSystems,
    },
  );

export const listWormholeTypes = () =>
  api.get<WormholeTypeOut[]>("/wormhole-types/");

export const addConnection = (
  mapId: number,
  payload: {
    top_system_id: number;
    bottom_system_id: number;
    connection_type?: ConnectionType;
    top_signature_id?: number | null;
    bottom_signature_id?: number | null;
    mass_status?: string;
    ship_size_limit?: string;
  },
) => api.post<WormholeConnectionOut>(`/maps/${mapId}/connections/`, payload);

export const updateConnection = (
  mapId: number,
  connectionId: number,
  changes: Partial<{
    connection_type: ConnectionType;
    life_status: string;
    mass_status: string;
    ship_size_limit: string;
  }>,
) =>
  api.patch<WormholeConnectionOut>(
    `/maps/${mapId}/connections/${connectionId}/`,
    changes,
  );

export const removeConnection = (mapId: number, connectionId: number) =>
  api.delete<void>(`/maps/${mapId}/connections/${connectionId}/`);

export const getConnectionDetails = (mapId: number, connectionId: number) =>
  api.get<ConnectionDetailOut>(
    `/maps/${mapId}/connections/${connectionId}/details/`,
  );

export const linkConnectionSignature = (
  mapId: number,
  connectionId: number,
  signatureId: number,
) =>
  api.post<WormholeConnectionOut>(
    `/maps/${mapId}/connections/${connectionId}/signature/`,
    {
      signature_id: signatureId,
    },
  );

export const searchCharacters = (query: string) =>
  api.get<CharacterSearchResult[]>(
    `/characters/search/${encodeURIComponent(query)}/`,
  );

export const searchCorporations = (query: string) =>
  api.get<CorporationSearchResult[]>(
    `/corporations/search/${encodeURIComponent(query)}/`,
  );

export const searchAlliances = (query: string) =>
  api.get<AllianceSearchResult[]>(
    `/alliances/search/${encodeURIComponent(query)}/`,
  );

export const searchGroups = (query: string) =>
  api.get<GroupSearchResult[]>(`/groups/search/${encodeURIComponent(query)}/`);

export const listShares = (mapId: number) =>
  api.get<ShareOut[]>(`/maps/${mapId}/shares/`);

export const addShare = (mapId: number, scope: ShareScope, targetId: number) =>
  api.post<ShareOut>(`/maps/${mapId}/share/`, { scope, target_id: targetId });

export const removeShare = (
  mapId: number,
  scope: ShareScope,
  targetId: number,
) => api.delete<void>(`/maps/${mapId}/share/${scope}/${targetId}/`);

export const listTrackableCharacters = () =>
  api.get<TrackableCharacterOut[]>(`/trackable-characters/`);

export const startTrackingCharacter = (characterId: number) =>
  api.post<TrackedCharacterOut>(`/trackable-characters/${characterId}/track/`);

export const removeTrackedCharacter = (characterId: number) =>
  api.delete<void>(`/tracked-characters/${characterId}/`);

export const trackCharacterUrl = (next?: string) =>
  `${WH_MAPPER_URL_PREFIX}/track/add/${next ? `?next=${encodeURIComponent(next)}` : ""}`;

export const listRegions = () => api.get<RegionOut[]>("/regions/");

export const getUniverseRegionsGraph = () =>
  api.get<RegionGraphOut>("/universe/regions-graph/");

export const importRegion = (mapId: number, regionId: number) =>
  api.post<RegionImportResult>(`/maps/${mapId}/import-region/`, {
    region_id: regionId,
  });
