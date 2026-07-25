import { useState } from "react";
import { removeConnection, updateConnection } from "../api/maps";
import { createConnectionFlag } from "../api/route";
import { ApiError } from "../api/client";
import type { RouteLegOut } from "../api/types";
import {
  LIFE_STATUS_LABEL,
  LIFE_STATUSES,
  MASS_STATUSES,
  SHIP_SIZE_LABEL,
} from "../constants";
import {
  routeLegColor,
  routeLegDashed,
  routeLegOrientedSignatures,
} from "../lib/routeLegStyle";

interface Props {
  leg: RouteLegOut;
  sourceSystemId: number;
  sourceSystemName: string;
  targetSystemName: string;
}

/** One leg of a route's itinerary - for a wormhole/ansiblex leg, offers
 * compact, always-visible controls to mark its mass or time (life) status.
 * Tries the direct connection endpoints first (the same ones the Map view
 * uses); on a 403/404 (no edit access to the underlying map - e.g. a
 * shared Route built from someone else's maps, see the wayfinder map's
 * ticket 08) falls back to creating a ConnectionFlag instead - a
 * suggestion for whoever *can* edit that map to review. See ticket 11. */
export function RouteLegRow({
  leg,
  sourceSystemId,
  sourceSystemName,
  targetSystemName,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const canControl =
    leg.connection_type !== "stargate" &&
    leg.map_id !== null &&
    leg.connection_id !== null;

  const applyOrFlag = async (
    directCall: () => Promise<unknown>,
    flagPayload: {
      suggested_life_status?: string | null;
      suggested_mass_status?: string | null;
      suggests_collapsed?: boolean;
    },
    successMessage: string,
  ) => {
    if (!leg.connection_id) {
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      await directCall();
      setResult(successMessage);
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.status === 403 || err.status === 404)
      ) {
        try {
          await createConnectionFlag(leg.connection_id, flagPayload);
          setResult("Flagged for review by a map editor");
        } catch (flagErr) {
          setResult(String(flagErr));
        }
      } else {
        setResult(String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const setMassStatus = (massStatus: string) =>
    applyOrFlag(
      () =>
        updateConnection(leg.map_id as number, leg.connection_id as number, {
          mass_status: massStatus,
        }),
      { suggested_mass_status: massStatus },
      `Marked ${massStatus}`,
    );

  const setLifeStatus = (lifeStatus: string) =>
    applyOrFlag(
      () =>
        updateConnection(leg.map_id as number, leg.connection_id as number, {
          life_status: lifeStatus,
        }),
      { suggested_life_status: lifeStatus },
      `Marked ${LIFE_STATUS_LABEL[lifeStatus] ?? lifeStatus}`,
    );

  const markCollapsed = () =>
    applyOrFlag(
      () => removeConnection(leg.map_id as number, leg.connection_id as number),
      { suggests_collapsed: true },
      leg.connection_type === "wormhole"
        ? "Marked collapsed"
        : "Marked offline",
    );

  // Mass/life status are wormhole-only concepts (ticket 05: an ansiblex is
  // player-built infrastructure that doesn't decay, so those fields are
  // never meaningful for it) - only removal ("collapsed"/"offline")
  // applies to both.
  const isWormhole = leg.connection_type === "wormhole";

  const { source: sourceSignature, target: targetSignature } =
    routeLegOrientedSignatures(leg, sourceSystemId);

  return (
    <div className="route-leg-row">
      <span
        className={`route-leg-connector${routeLegDashed(leg) ? " route-leg-connector-dashed" : ""}`}
        style={
          { "--route-leg-color": routeLegColor(leg) } as React.CSSProperties
        }
        title={leg.connection_type}
      />
      <div className="route-leg-body">
        <div className="route-leg-summary">
          {leg.life_status && (
            <span className="route-leg-status">
              {LIFE_STATUS_LABEL[leg.life_status] ?? leg.life_status}
            </span>
          )}
          {leg.mass_status && leg.mass_status !== "unknown" && (
            <span className="route-leg-status">{leg.mass_status} mass</span>
          )}
          {leg.connection?.ship_size_limit &&
            SHIP_SIZE_LABEL[leg.connection.ship_size_limit] && (
              <span className="route-leg-status" title="Ship size limit">
                {SHIP_SIZE_LABEL[leg.connection.ship_size_limit]}
              </span>
            )}
        </div>

        {/* Stacked, not inline - a wormhole has two distinct scanned ends,
        one per side, and running them together with the mass/life text
        above made that easy to miss. */}
        {(sourceSignature || targetSignature) && (
          <div className="route-leg-signatures">
            {sourceSignature && (
              <div className="route-leg-sig-row">
                <span className="route-leg-sig-system">{sourceSystemName}</span>
                <span className="route-leg-sig mono">
                  {sourceSignature.signature_id}
                </span>
              </div>
            )}
            {targetSignature && (
              <div className="route-leg-sig-row">
                <span className="route-leg-sig-system">{targetSystemName}</span>
                <span className="route-leg-sig mono">
                  {targetSignature.signature_id}
                </span>
              </div>
            )}
          </div>
        )}

        {canControl && (
          <div className="route-leg-controls">
            {isWormhole && (
              <>
                <select
                  value=""
                  disabled={busy}
                  onChange={(event) => {
                    if (event.target.value) {
                      setLifeStatus(event.target.value);
                    }
                  }}
                >
                  <option value="">Mark time…</option>
                  {LIFE_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {LIFE_STATUS_LABEL[status] ?? status}
                    </option>
                  ))}
                </select>
                <select
                  value=""
                  disabled={busy}
                  onChange={(event) => {
                    if (event.target.value) {
                      setMassStatus(event.target.value);
                    }
                  }}
                >
                  <option value="">Mark mass…</option>
                  {MASS_STATUSES.filter((status) => status !== "unknown").map(
                    (status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ),
                  )}
                </select>
              </>
            )}
            <button
              type="button"
              className="link-button"
              disabled={busy}
              onClick={markCollapsed}
            >
              {isWormhole ? "Mark collapsed" : "Mark offline"}
            </button>
          </div>
        )}
        {result && <span className="route-leg-result">{result}</span>}
      </div>
    </div>
  );
}
