import type { MapEvent } from "../hooks/useMapSocket";
import type {
  MapStateOut,
  MapSystemOut,
  SignatureOut,
  TrackedCharacterOut,
  WormholeConnectionOut,
} from "../api/types";

function upsertBy<T, K>(list: T[], item: T, key: (item: T) => K): T[] {
  const itemKey = key(item);
  const index = list.findIndex((existing) => key(existing) === itemKey);
  if (index === -1) {
    return [...list, item];
  }
  const next = [...list];
  next[index] = item;
  return next;
}

function removeBy<T, K>(list: T[], targetKey: K, key: (item: T) => K): T[] {
  return list.filter((item) => key(item) !== targetKey);
}

const byId = <T extends { id: number }>(item: T) => item.id;
const byCharacterId = (item: TrackedCharacterOut) => item.character_id;

export function applyMapEvent(
  state: MapStateOut,
  event: MapEvent,
): MapStateOut {
  switch (event.event) {
    case "system.added":
    case "system.updated":
      return {
        ...state,
        systems: upsertBy(state.systems, event.data as MapSystemOut, byId),
      };
    case "system.removed": {
      const { id, removed_signature_ids, removed_connection_ids } =
        event.data as {
          id: number;
          removed_signature_ids?: number[];
          removed_connection_ids?: number[];
        };
      const systems = removeBy(state.systems, id, byId);
      const signatures = (removed_signature_ids ?? []).reduce(
        (list, signatureId) => removeBy(list, signatureId, byId),
        state.signatures,
      );
      const connections = (removed_connection_ids ?? []).reduce(
        (list, connectionId) => removeBy(list, connectionId, byId),
        state.connections,
      );
      return { ...state, systems, signatures, connections };
    }
    case "signature.added":
    case "signature.updated":
      return {
        ...state,
        signatures: upsertBy(
          state.signatures,
          event.data as SignatureOut,
          byId,
        ),
      };
    case "signature.bulk_upserted": {
      const {
        signatures,
        removed_signature_ids,
        removed_connection_ids,
        removed_system_ids,
      } = event.data as {
        signatures: SignatureOut[];
        removed_signature_ids?: number[];
        removed_connection_ids?: number[];
        removed_system_ids?: number[];
      };
      const afterUpsert = signatures.reduce(
        (list, signature) => upsertBy(list, signature, byId),
        state.signatures,
      );
      const afterRemoval = (removed_signature_ids ?? []).reduce(
        (list, id) => removeBy(list, id, byId),
        afterUpsert,
      );
      const connections = (removed_connection_ids ?? []).reduce(
        (list, id) => removeBy(list, id, byId),
        state.connections,
      );
      const systems = (removed_system_ids ?? []).reduce(
        (list, id) => removeBy(list, id, byId),
        state.systems,
      );
      return { ...state, signatures: afterRemoval, connections, systems };
    }
    case "signature.removed":
      return {
        ...state,
        signatures: removeBy(
          state.signatures,
          (event.data as { id: number }).id,
          byId,
        ),
      };
    case "connection.added":
    case "connection.updated":
      return {
        ...state,
        connections: upsertBy(
          state.connections,
          event.data as WormholeConnectionOut,
          byId,
        ),
      };
    case "connection.removed":
      return {
        ...state,
        connections: removeBy(
          state.connections,
          (event.data as { id: number }).id,
          byId,
        ),
      };
    case "character.moved":
      return {
        ...state,
        tracked_characters: upsertBy(
          state.tracked_characters,
          event.data as TrackedCharacterOut,
          byCharacterId,
        ),
      };
    case "character.removed":
      return {
        ...state,
        tracked_characters: removeBy(
          state.tracked_characters,
          (event.data as { character_id: number }).character_id,
          byCharacterId,
        ),
      };
    default:
      return state;
  }
}
