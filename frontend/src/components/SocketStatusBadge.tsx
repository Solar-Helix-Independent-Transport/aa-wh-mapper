import type { SocketStatus } from "../hooks/useMapSocket";

interface Props {
  status: SocketStatus;
}

const LABEL: Record<SocketStatus, string> = {
  connecting: "Connecting…",
  open: "Live",
  reconnecting: "Reconnecting…",
  closed: "Disconnected",
};

const TITLE: Record<SocketStatus, string> = {
  connecting:
    "Connecting to live updates - changes from other viewers will appear automatically once connected.",
  open: "Live: changes from other viewers (systems, signatures, connections) appear here automatically, no refresh needed.",
  reconnecting:
    "Live updates disconnected - reconnecting automatically. You may be missing changes from other viewers until it recovers.",
  closed:
    "Live updates disconnected and won't retry on their own. Refresh the page to reconnect.",
};

/** Compact live-updates indicator - see useMapSocket/useFleetSocket/
 * useRouteSocket's SocketStatus. Shared by AppHeader (MapView's header) and
 * SharedRoute's toolbar, so the same states read the same way everywhere. */
export function SocketStatusBadge({ status }: Props) {
  return (
    <span
      className={`socket-status-badge${
        status === "open" ? "" : " socket-status-badge-down"
      }`}
      title={TITLE[status]}
    >
      {LABEL[status]}
    </span>
  );
}
