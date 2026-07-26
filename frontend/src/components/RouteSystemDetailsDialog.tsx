import type { RouteLegOut, SolarSystemOut } from "../api/types";
import { LIFE_STATUS_LABEL } from "../constants";
import { Dialog } from "./Dialog";
import { CONNECTION_TYPE_LABEL, wormholeClassLabel } from "./wormholeClass";

interface AdjacentLeg {
  leg: RouteLegOut;
  otherSystemName: string;
}

interface Props {
  system: SolarSystemOut;
  adjacentLegs: AdjacentLeg[];
  onClose: () => void;
}

/** Read-only system details for a route diagram node - a leaner sibling of
 * SystemDetailsDialog (used by the Map view). A route system isn't
 * necessarily backed by any single Map's MapSystem row at all (a route
 * merges the universe's real stargate graph with every visible map's
 * wormhole connections - see wh_mapper.pathfinding), so there's no
 * added_by/pinned to fetch and no live tracked-character data to show -
 * only the solar system's own static facts, plus this route's own
 * adjacent legs (at most two: the hop in, and the hop out), all already
 * present in the RouteDetail the frontend already has. No server call. */
export function RouteSystemDetailsDialog({
  system,
  adjacentLegs,
  onClose,
}: Props) {
  const classLabel =
    system.space_type === "Wormhole"
      ? wormholeClassLabel(system.wormhole_class_id)
      : null;
  const location = [system.constellation_name, system.region_name]
    .filter(Boolean)
    .join(" · ");

  return (
    <Dialog title={system.name} onClose={onClose}>
      <div className="dialog-section connection-details-grid">
        <span className="dim">Class</span>
        <span>{classLabel ?? system.space_type}</span>

        {system.security_status !== null && (
          <>
            <span className="dim">Security</span>
            <span>{system.security_status.toFixed(1)}</span>
          </>
        )}

        {location && (
          <>
            <span className="dim">Location</span>
            <span>{location}</span>
          </>
        )}

        {system.owner && (
          <>
            <span className="dim">Sovereignty</span>
            <span>
              {system.owner.name}
              {system.owner.ticker ? ` [${system.owner.ticker}]` : ""}
            </span>
          </>
        )}
      </div>

      <div className="dialog-section">
        <p className="dim">This route's connections</p>
        {adjacentLegs.length === 0 && (
          <p className="dim">Endpoint of the route - no adjacent hop.</p>
        )}
        {adjacentLegs.length > 0 && (
          <ul className="connection-details-contributions">
            {adjacentLegs.map(({ leg, otherSystemName }, index) => (
              <li key={index}>
                <span>{otherSystemName}</span>
                <span className="dim">
                  {CONNECTION_TYPE_LABEL[leg.connection_type] ??
                    leg.connection_type}
                  {leg.life_status &&
                    ` · ${LIFE_STATUS_LABEL[leg.life_status] ?? leg.life_status}`}
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
