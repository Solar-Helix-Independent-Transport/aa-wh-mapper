import {
  MAP_PRESENCE_PING_INTERVAL_MS,
  WH_MAPPER_URL_PREFIX,
} from "../constants";
import { useSocket, type SocketStatus } from "./useSocket";

export type { SocketStatus } from "./useSocket";

export interface MapEvent {
  event: string;
  data: unknown;
}

/** Connects to the live map socket and calls onEvent for every broadcast,
 * reconnecting with backoff on drop. Callers should still resync via the
 * `state` endpoint on (re)connect since the socket only carries deltas. */
export function useMapSocket(
  mapId: number | null,
  onEvent: (event: MapEvent) => void,
  onOpen?: () => void,
): SocketStatus {
  return useSocket(mapId, (id) => `/ws${WH_MAPPER_URL_PREFIX}/maps/${id}/`, {
    onEvent,
    onOpen,
    // Lets the server's MapPresence row distinguish "still genuinely
    // open" from "disconnect() never fired" - see
    // wh_mapper.tasks.prune_stale_map_presence.
    ping: {
      message: { type: "ping" },
      intervalMs: MAP_PRESENCE_PING_INTERVAL_MS,
    },
  });
}
