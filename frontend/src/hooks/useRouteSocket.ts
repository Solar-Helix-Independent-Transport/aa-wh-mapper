import { WH_MAPPER_URL_PREFIX } from "../constants";
import { useSocket, type SocketStatus } from "./useSocket";

export interface RouteEvent {
  event: string;
  data: unknown;
}

/** Connects to a shared Route's live socket - see
 * wh_mapper.consumers.RouteConsumer. Callers should resync via the
 * route's own GET endpoint on (re)connect, same as useMapSocket, since the
 * socket only carries a "something changed" signal. */
export function useRouteSocket(
  routeId: number | null,
  onEvent: (event: RouteEvent) => void,
): SocketStatus {
  return useSocket(
    routeId,
    (id) => `/ws${WH_MAPPER_URL_PREFIX}/routes/${id}/`,
    { onEvent },
  );
}
