import { useEffect, useRef } from "react";
import {
  TERMINAL_WS_CLOSE_CODES,
  WH_MAPPER_URL_PREFIX,
  WS_RECONNECT_INITIAL_DELAY_MS,
  WS_RECONNECT_MAX_DELAY_MS,
} from "../constants";

export interface FleetEvent {
  event: string;
  data: unknown;
}

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

/** Connects to a FleetTrackingSession's live socket - see
 * wh_mapper.consumers.FleetSessionConsumer. Mirrors useRouteSocket: the
 * socket only carries a "something changed" signal, so callers resync via
 * the session's own GET endpoint on (re)connect. */
export function useFleetSocket(
  sessionId: number | null,
  onEvent: (event: FleetEvent) => void,
) {
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (sessionId === null) {
      return;
    }

    let socket: WebSocket | null = null;
    let retryDelay = WS_RECONNECT_INITIAL_DELAY_MS;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let closedByEffect = false;

    const connect = () => {
      socket = new WebSocket(
        `${getWsOrigin()}/ws${WH_MAPPER_URL_PREFIX}/fleets/${sessionId}/`,
      );

      socket.onopen = () => {
        retryDelay = WS_RECONNECT_INITIAL_DELAY_MS;
      };

      socket.onmessage = (message) => {
        try {
          onEventRef.current(JSON.parse(message.data));
        } catch {
          // ignore malformed frames
        }
      };

      socket.onclose = (event) => {
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
      socket?.close();
    };
  }, [sessionId]);
}
