import { useEffect, useRef } from "react";
import {
  MAP_PRESENCE_PING_INTERVAL_MS,
  TERMINAL_WS_CLOSE_CODES,
  WH_MAPPER_URL_PREFIX,
  WS_RECONNECT_INITIAL_DELAY_MS,
  WS_RECONNECT_MAX_DELAY_MS,
} from "../constants";

export interface MapEvent {
  event: string;
  data: unknown;
}

// Reads the `ws_origin` override rendered into the page (see
// wh_mapper/templates/wh_mapper/index.html + WH_MAPPER_WS_ORIGIN setting).
// Falls back to same-origin, which is the normal case once a reverse proxy
// routes /ws/ to daphne alongside the rest of the site.
function getWsOrigin(): string {
  const el = document.getElementById("wh-mapper-ws-origin");
  if (el?.textContent) {
    try {
      const value: unknown = JSON.parse(el.textContent);
      if (typeof value === "string" && value) {
        return value;
      }
    } catch {
      // fall through to same-origin default
    }
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

/** Connects to the live map socket and calls onEvent for every broadcast,
 * reconnecting with backoff on drop. Callers should still resync via the
 * `state` endpoint on (re)connect since the socket only carries deltas. */
export function useMapSocket(
  mapId: number | null,
  onEvent: (event: MapEvent) => void,
  onOpen?: () => void,
) {
  const onEventRef = useRef(onEvent);
  const onOpenRef = useRef(onOpen);

  useEffect(() => {
    onEventRef.current = onEvent;
    onOpenRef.current = onOpen;
  }, [onEvent, onOpen]);

  useEffect(() => {
    if (mapId === null) {
      return;
    }

    let socket: WebSocket | null = null;
    let retryDelay = WS_RECONNECT_INITIAL_DELAY_MS;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let pingInterval: ReturnType<typeof setInterval> | null = null;
    let closedByEffect = false;

    const connect = () => {
      socket = new WebSocket(
        `${getWsOrigin()}/ws${WH_MAPPER_URL_PREFIX}/maps/${mapId}/`,
      );

      socket.onopen = () => {
        retryDelay = WS_RECONNECT_INITIAL_DELAY_MS;
        onOpenRef.current?.();
        // Lets the server's MapPresence row distinguish "still genuinely
        // open" from "disconnect() never fired" - see
        // wh_mapper.tasks.prune_stale_map_presence.
        pingInterval = setInterval(() => {
          socket?.send(JSON.stringify({ type: "ping" }));
        }, MAP_PRESENCE_PING_INTERVAL_MS);
      };

      socket.onmessage = (message) => {
        try {
          onEventRef.current(JSON.parse(message.data));
        } catch {
          // ignore malformed frames
        }
      };

      socket.onclose = (event) => {
        if (pingInterval) {
          clearInterval(pingInterval);
          pingInterval = null;
        }
        if (closedByEffect || TERMINAL_WS_CLOSE_CODES.has(event.code)) {
          return;
        }
        retryTimeout = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, WS_RECONNECT_MAX_DELAY_MS);
      };
    };

    connect();

    return () => {
      closedByEffect = true;
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
      if (pingInterval) {
        clearInterval(pingInterval);
      }
      socket?.close();
    };
  }, [mapId]);
}
