import { WH_MAPPER_URL_PREFIX } from "../constants";
import { useSocket, type SocketStatus } from "./useSocket";

export interface FleetEvent {
  event: string;
  data: unknown;
}

/** Connects to a FleetTrackingSession's live socket - see
 * wh_mapper.consumers.FleetSessionConsumer. Mirrors useRouteSocket: the
 * socket only carries a "something changed" signal, so callers resync via
 * the session's own GET endpoint on (re)connect. */
export function useFleetSocket(
  sessionId: number | null,
  onEvent: (event: FleetEvent) => void,
): SocketStatus {
  return useSocket(
    sessionId,
    (id) => `/ws${WH_MAPPER_URL_PREFIX}/fleets/${id}/`,
    { onEvent },
  );
}
