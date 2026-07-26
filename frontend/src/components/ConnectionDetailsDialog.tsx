import { useEffect, useState } from "react";
import { getConnectionDetails } from "../api/maps";
import type {
  ConnectionDetailOut,
  SignatureOut,
  WormholeConnectionOut,
} from "../api/types";
import {
  LIFE_STATUS_CHECK_INTERVAL_MS,
  LIFE_STATUS_LABEL,
  SHIP_SIZE_LABEL,
  TIME_STATUS_COLOR,
} from "../constants";
import { useNow } from "../hooks/useNow";
import { relativeTimeLabel } from "../lib/relativeTime";
import { Dialog } from "./Dialog";
import { LoadingState } from "./LoadingState";
import {
  CONNECTION_TYPE_LABEL,
  connectionWormholeType,
  effectiveLifeStatus,
  wormholeTypeSummary,
} from "./wormholeClass";

const CONTRIBUTION_VERB_LABEL: Record<string, string> = {
  added: "Added connection",
  updated: "Updated status",
  signature_linked: "Linked signature",
};

interface Props {
  mapId: number;
  connection: WormholeConnectionOut;
  topSystemName: string;
  bottomSystemName: string;
  signatures: SignatureOut[];
  onClose: () => void;
}

// `signature` alone never says which end of the connection it's on - "top"/
// "bottom" are an arbitrary, internal distinction (see WormholeConnection's
// docstring), not something a player thinks in. `systemName` is the actual
// solar system it was scanned in, which is what makes the row meaningful.
function SignatureSummary({
  signature,
  systemName,
}: {
  signature: SignatureOut;
  systemName: string;
}) {
  return (
    <div>
      <span>{systemName}</span>{" "}
      <span className="mono">{signature.signature_id}</span>{" "}
      <span className="dim">{signature.sig_type}</span>
      {signature.wormhole_type && (
        <div className="dim">
          {wormholeTypeSummary(signature.wormhole_type)}
        </div>
      )}
    </div>
  );
}

/** Read-only "everything known about this connection" view, opened from the
 * right-click menu (MapCanvas's handleEdgeContextMenu) - the rest of the
 * canvas only ever shows individual fields piecemeal (the edge color, the
 * submenus' current selection), nowhere brings it all together in one
 * place. Life status is shown as its live-computed effective bucket
 * (mirrors wormholeClass.ts's effectiveLifeStatus, same as the edge itself)
 * rather than the raw stored field, since that's what's actually true.
 * created_by_name and the contribution history aren't part of
 * WormholeConnectionOut (too expensive to compute for every connection in
 * a bulk fetch) - fetched on demand for just this one connection. */
export function ConnectionDetailsDialog({
  mapId,
  connection,
  topSystemName,
  bottomSystemName,
  signatures,
  onClose,
}: Props) {
  const [details, setDetails] = useState<ConnectionDetailOut | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getConnectionDetails(mapId, connection.id)
      .then(setDetails)
      .catch((err) => setError(String(err)));
  }, [mapId, connection.id]);

  const now = useNow(LIFE_STATUS_CHECK_INTERVAL_MS);
  const wormholeType = connectionWormholeType(connection, signatures);
  const effectiveStatus = effectiveLifeStatus(
    connection.life_status,
    connection.life_status_marked_at,
    wormholeType,
    connection.created_at,
    now,
  );

  return (
    <Dialog title={`${topSystemName} ↔ ${bottomSystemName}`} onClose={onClose}>
      {error && <p className="error">{error}</p>}

      <div className="dialog-section connection-details-grid">
        <span className="dim">Type</span>
        <span>
          {CONNECTION_TYPE_LABEL[connection.connection_type] ??
            connection.connection_type}
        </span>

        {connection.connection_type === "wormhole" && (
          <>
            <span className="dim">Life</span>
            <span>
              {LIFE_STATUS_LABEL[effectiveStatus] ?? effectiveStatus}
              {connection.life_status_marked_at && (
                <span className="dim">
                  {" "}
                  (marked {relativeTimeLabel(connection.life_status_marked_at)})
                </span>
              )}
            </span>

            <span className="dim">Mass</span>
            <span>{connection.mass_status}</span>

            <span className="dim">Ship size</span>
            <span>
              {SHIP_SIZE_LABEL[connection.ship_size_limit] ??
                connection.ship_size_limit}
            </span>

            <span className="dim">Time status</span>
            <span style={{ color: TIME_STATUS_COLOR[connection.time_status] }}>
              {connection.time_status}
            </span>
          </>
        )}

        <span className="dim">Created</span>
        <span>
          {details ? (details.created_by_name ?? "Unknown") : "…"}
          {" · "}
          {relativeTimeLabel(connection.created_at)}
        </span>

        <span className="dim">Updated</span>
        <span>{relativeTimeLabel(connection.updated_at)}</span>
      </div>

      {(connection.top_signature || connection.bottom_signature) && (
        <div className="dialog-section">
          <p className="dim">Signatures</p>
          {connection.top_signature && (
            <SignatureSummary
              signature={connection.top_signature}
              systemName={topSystemName}
            />
          )}
          {connection.bottom_signature && (
            <SignatureSummary
              signature={connection.bottom_signature}
              systemName={bottomSystemName}
            />
          )}
        </div>
      )}

      <div className="dialog-section">
        <p className="dim">Contribution history</p>
        {!details && !error && <LoadingState label="Loading…" />}
        {details && details.contributions.length === 0 && (
          <p className="dim">No recorded contributions yet.</p>
        )}
        {details && details.contributions.length > 0 && (
          <ul className="connection-details-contributions">
            {details.contributions.map((contribution) => (
              <li key={contribution.id}>
                <span>{contribution.name}</span>
                <span className="dim">
                  {CONTRIBUTION_VERB_LABEL[contribution.verb] ??
                    contribution.verb}
                </span>
                <span className="dim">
                  {relativeTimeLabel(contribution.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button type="button" className="link-button" onClick={onClose}>
        Close
      </button>
    </Dialog>
  );
}
