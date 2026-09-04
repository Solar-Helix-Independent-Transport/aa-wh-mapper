import { useEffect, useRef, useState } from "react";
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

/** "connecting": first attempt, never yet open. "open": live. "reconnecting":
 * was open (or retrying after a prior drop) and lost the connection again -
 * a transient blip that should self-heal. "closed": the server rejected the
 * connection outright (see TERMINAL_WS_CLOSE_CODES) and won't be retried -
 * callers should point the user at a page refresh (re-auth, permission
 * change) rather than waiting on it. */
export type SocketStatus = "connecting" | "open" | "reconnecting" | "closed";

// Closing a still-CONNECTING socket is valid (it just aborts the handshake)
// but Chrome logs "WebSocket is closed before the connection is
// established" to the console when it happens - harmless, but it only ever
// fires here via React StrictMode's dev-only double-invoke of this effect
// (mount, cleanup, mount again - the first socket rarely finishes
// connecting before its own cleanup runs). Deferring the close until the
// handshake actually resolves keeps that console noise out, at the cost of
// a socket that opens and immediately closes itself once - see the
// matching `closedByEffect` guard in each hook's onopen.
export function closeSocketGracefully(socket: WebSocket | null) {
  if (!socket) {
    return;
  }
  if (socket.readyState === WebSocket.CONNECTING) {
    socket.addEventListener("open", () => socket.close(), { once: true });
  } else {
    socket.close();
  }
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
): SocketStatus {
  const onEventRef = useRef(onEvent);
  const onOpenRef = useRef(onOpen);
  // Tagged with the mapId it's for, rather than a bare SocketStatus, so a
  // status left over from the previous mapId's socket can't leak into the
  // render for a new one before that new socket has reported anything of
  // its own - the derived `status` below falls back to "connecting"
  // whenever the tag doesn't match, without needing a synchronous setState
  // at the top of the effect to force that reset.
  const [statusState, setStatusState] = useState<{
    id: number | null;
    status: SocketStatus;
  }>({ id: null, status: "connecting" });

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
        if (closedByEffect) {
          return;
        }
        retryDelay = WS_RECONNECT_INITIAL_DELAY_MS;
        setStatusState({ id: mapId, status: "open" });
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
        if (closedByEffect) {
          return;
        }
        if (TERMINAL_WS_CLOSE_CODES.has(event.code)) {
          setStatusState({ id: mapId, status: "closed" });
          return;
        }
        setStatusState({ id: mapId, status: "reconnecting" });
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
      closeSocketGracefully(socket);
    };
  }, [mapId]);

  return statusState.id === mapId ? statusState.status : "connecting";
}
