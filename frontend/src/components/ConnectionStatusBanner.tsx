import { useEffect, useState } from "react";
import type { SocketStatus } from "../hooks/useMapSocket";

interface Props {
  status: SocketStatus;
  // "floating" (default) absolutely positions itself over a relatively-
  // positioned ancestor, for a full canvas view (MapView, SharedRoute).
  // "inline" renders in normal flow instead, for a panel with no such
  // canvas to float over (FleetPanel).
  variant?: "floating" | "inline";
}

// Delay before a "reconnecting" status actually renders a banner - most
// drops recover on the first or second backed-off retry (see
// WS_RECONNECT_INITIAL_DELAY_MS), so showing one immediately would just
// flash on every brief blip. "closed" skips this - it's a terminal close
// code the client has already given up retrying, so there's nothing to wait
// out.
const RECONNECTING_BANNER_DELAY_MS = 3000;

/** Surfaces a dropped live-updates socket - see useMapSocket/useFleetSocket/
 * useRouteSocket's SocketStatus. Renders nothing for "connecting" (the
 * normal, brief state on first mount) or "open". */
export function ConnectionStatusBanner({
  status,
  variant = "floating",
}: Props) {
  // Only ever flips true from inside the timeout callback below, never
  // reset back to false directly - the render check below gates it on
  // status === "reconnecting" too, so a stale `true` left over from an
  // earlier drop that outlasted the delay stays harmless once the socket
  // recovers, without needing a synchronous setState at the top of the
  // effect just to clear it.
  const [reconnectTimedOut, setReconnectTimedOut] = useState(false);

  useEffect(() => {
    if (status !== "reconnecting") {
      return;
    }
    const timeout = setTimeout(
      () => setReconnectTimedOut(true),
      RECONNECTING_BANNER_DELAY_MS,
    );
    return () => clearTimeout(timeout);
  }, [status]);

  const showReconnecting = status === "reconnecting" && reconnectTimedOut;

  const className =
    variant === "inline"
      ? "connection-status-banner connection-status-banner-inline"
      : "connection-status-banner";

  if (status === "closed") {
    return (
      <div className={className} role="alert">
        <span>Live updates disconnected. Refresh the page to reconnect.</span>
      </div>
    );
  }

  if (status === "reconnecting" && showReconnecting) {
    return (
      <div className={className} role="alert">
        <span>
          Live updates disconnected, reconnecting… If this persists, try
          refreshing the page.
        </span>
      </div>
    );
  }

  return null;
}
