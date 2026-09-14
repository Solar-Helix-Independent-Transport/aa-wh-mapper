import { useEffect, useRef, useState } from "react";
import {
  TERMINAL_WS_CLOSE_CODES,
  WS_RECONNECT_INITIAL_DELAY_MS,
  WS_RECONNECT_MAX_DELAY_MS,
} from "../constants";

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
// fires here via React StrictMode's dev-only double-invoke of the connect
// effect below (mount, cleanup, mount again - the first socket rarely
// finishes connecting before its own cleanup runs). Deferring the close
// until the handshake actually resolves keeps that console noise out, at
// the cost of a socket that opens and immediately closes itself once - see
// the matching `closedByEffect` guard below.
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
export function getWsOrigin(): string {
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

export interface UseSocketOptions<TEvent> {
  onEvent: (event: TEvent) => void;
  onOpen?: () => void;
  /** Sends this message (JSON-stringified) on the open socket every
   * `intervalMs` - see useMapSocket's docstring for why (its only caller):
   * keeps the server's MapPresence row apprised that the connection is
   * still genuinely open, not just not-yet-noticed-as-dropped. Omit for a
   * socket that doesn't need one (fleet/route). */
  ping?: { message: unknown; intervalMs: number };
}

/** Shared connect/reconnect-with-backoff state machine behind
 * useMapSocket/useFleetSocket/useRouteSocket - see each of those for its
 * own URL path and any hook-specific behavior. `id` is whatever identifies
 * the target (mapId/sessionId/routeId); null means "don't connect yet".
 *
 * `buildPath` turns a non-null id into the URL path (e.g.
 * `/ws/wh-mapper/maps/42/`) - like `onEvent`/`onOpen`/`ping`, it's read
 * through a ref rather than sitting in the connect effect's own dependency
 * array, so passing a fresh inline function/object on every render doesn't
 * force a needless reconnect; only a real `id` change does.
 */
export function useSocket<TEvent>(
  id: number | null,
  buildPath: (id: number) => string,
  { onEvent, onOpen, ping }: UseSocketOptions<TEvent>,
): SocketStatus {
  const buildPathRef = useRef(buildPath);
  const onEventRef = useRef(onEvent);
  const onOpenRef = useRef(onOpen);
  const pingRef = useRef(ping);
  // Tagged with the id it's for, rather than a bare SocketStatus, so a
  // status left over from the previous id's socket can't leak into the
  // render for a new one before that new socket has reported anything of
  // its own - the derived `status` below falls back to "connecting"
  // whenever the tag doesn't match, without needing a synchronous setState
  // at the top of the effect to force that reset.
  const [statusState, setStatusState] = useState<{
    id: number | null;
    status: SocketStatus;
  }>({ id: null, status: "connecting" });

  useEffect(() => {
    buildPathRef.current = buildPath;
    onEventRef.current = onEvent;
    onOpenRef.current = onOpen;
    pingRef.current = ping;
  }, [buildPath, onEvent, onOpen, ping]);

  useEffect(() => {
    if (id === null) {
      return;
    }

    let socket: WebSocket | null = null;
    let retryDelay = WS_RECONNECT_INITIAL_DELAY_MS;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let pingInterval: ReturnType<typeof setInterval> | null = null;
    let closedByEffect = false;

    const connect = () => {
      socket = new WebSocket(`${getWsOrigin()}${buildPathRef.current(id)}`);

      socket.onopen = () => {
        if (closedByEffect) {
          return;
        }
        retryDelay = WS_RECONNECT_INITIAL_DELAY_MS;
        setStatusState({ id, status: "open" });
        onOpenRef.current?.();

        const activePing = pingRef.current;
        if (activePing) {
          pingInterval = setInterval(() => {
            socket?.send(JSON.stringify(activePing.message));
          }, activePing.intervalMs);
        }
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
          setStatusState({ id, status: "closed" });
          return;
        }
        setStatusState({ id, status: "reconnecting" });
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
  }, [id]);

  return statusState.id === id ? statusState.status : "connecting";
}
