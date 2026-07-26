import { useEffect, useState } from "react";
import { getSystemDetails } from "../api/maps";
import type {
  MapSystemOut,
  SystemDetailOut,
  WormholeConnectionOut,
} from "../api/types";
import { relativeTimeLabel } from "../lib/relativeTime";
import { Dialog } from "./Dialog";
import { LoadingState } from "./LoadingState";
import type { SystemNodeCharacter } from "./SystemNode";
import { CONNECTION_TYPE_LABEL, wormholeClassLabel } from "./wormholeClass";

interface Props {
  mapId: number;
  system: MapSystemOut;
  characters: SystemNodeCharacter[];
  connections: WormholeConnectionOut[];
  allSystems: MapSystemOut[];
  onClose: () => void;
}

function systemDisplayName(system: MapSystemOut): string {
  return system.label || system.solar_system.name;
}

/** Read-only "everything known about this system" view, opened from the
 * right-click menu - most of the facts here (security/region/sovereignty,
 * who's currently there, which connections touch it) already sit in the
 * map's own state the frontend already has (get_map_state); only
 * added_by_name is fetched on demand, same reasoning as
 * ConnectionDetailsDialog's created_by_name - too expensive to resolve for
 * every system in a bulk fetch, cheap for the one someone's inspecting. */
export function SystemDetailsDialog({
  mapId,
  system,
  characters,
  connections,
  allSystems,
  onClose,
}: Props) {
  const [details, setDetails] = useState<SystemDetailOut | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSystemDetails(mapId, system.id)
      .then(setDetails)
      .catch((err) => setError(String(err)));
  }, [mapId, system.id]);

  const solarSystem = system.solar_system;
  const classLabel =
    solarSystem.space_type === "Wormhole"
      ? wormholeClassLabel(solarSystem.wormhole_class_id)
      : null;
  const location = [solarSystem.constellation_name, solarSystem.region_name]
    .filter(Boolean)
    .join(" · ");

  return (
    <Dialog title={systemDisplayName(system)} onClose={onClose}>
      {error && <p className="error">{error}</p>}

      <div className="dialog-section connection-details-grid">
        <span className="dim">Class</span>
        <span>{classLabel ?? solarSystem.space_type}</span>

        {solarSystem.security_status !== null && (
          <>
            <span className="dim">Security</span>
            <span>{solarSystem.security_status.toFixed(1)}</span>
          </>
        )}

        {location && (
          <>
            <span className="dim">Location</span>
            <span>{location}</span>
          </>
        )}

        {solarSystem.owner && (
          <>
            <span className="dim">Sovereignty</span>
            <span>
              {solarSystem.owner.name}
              {solarSystem.owner.ticker ? ` [${solarSystem.owner.ticker}]` : ""}
            </span>
          </>
        )}

        <span className="dim">Pinned</span>
        <span>{system.pinned ? "Yes (home base)" : "No"}</span>

        <span className="dim">Added</span>
        <span>
          {details ? (details.added_by_name ?? "Unknown") : "…"}
          {" · "}
          {relativeTimeLabel(system.added_at)}
        </span>
      </div>

      <div className="dialog-section">
        <p className="dim">Present now</p>
        {characters.length === 0 && (
          <p className="dim">No tracked characters here.</p>
        )}
        {characters.length > 0 && (
          <ul className="connection-details-contributions">
            {characters.map((character) => (
              <li key={character.name}>
                <span>{character.name}</span>
                {character.isOwn && <span className="dim">(you)</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="dialog-section">
        <p className="dim">Connections</p>
        {connections.length === 0 && <p className="dim">No connections yet.</p>}
        {connections.length > 0 && (
          <ul className="connection-details-contributions">
            {connections.map((connection) => {
              const otherSystemId =
                connection.top_system_id === system.id
                  ? connection.bottom_system_id
                  : connection.top_system_id;
              const otherSystem = allSystems.find(
                (s) => s.id === otherSystemId,
              );
              return (
                <li key={connection.id}>
                  <span>
                    {otherSystem ? systemDisplayName(otherSystem) : "?"}
                  </span>
                  <span className="dim">
                    {CONNECTION_TYPE_LABEL[connection.connection_type] ??
                      connection.connection_type}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!details && !error && <LoadingState label="Loading…" />}

      <button type="button" className="link-button" onClick={onClose}>
        Close
      </button>
    </Dialog>
  );
}
