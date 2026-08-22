import { useEffect, useState } from "react";
import {
  acceptConnectionFlag,
  dismissConnectionFlag,
  listConnectionFlags,
} from "../api/route";
import type {
  ConnectionFlagOut,
  MapSystemOut,
  WormholeConnectionOut,
} from "../api/types";
import { Dialog } from "./Dialog";

interface Props {
  mapId: number;
  systems: MapSystemOut[];
  connections: WormholeConnectionOut[];
  onClose: () => void;
  onChanged: () => void;
  // A read-only reference map (see wh_mapper.models.Map.read_only) -
  // accepting/dismissing a flag is still a content mutation, so both are
  // disabled; viewing pending flags still works.
  readOnly?: boolean;
}

interface FlaggedConnection {
  connection: WormholeConnectionOut;
  flags: ConnectionFlagOut[];
}

function systemLabel(systems: MapSystemOut[], mapSystemId: number): string {
  return systems.find((s) => s.id === mapSystemId)?.solar_system.name ?? "?";
}

/** Pending suggested status changes on this map's connections from users
 * who don't have edit access to it - see wh_mapper.models.ConnectionFlag
 * and the wayfinder map's ticket 11. Opened from the map toolbar rather
 * than shown inline on every edge, to avoid an N+1 fetch on every map
 * load - flags are the uncommon case. */
export function ConnectionFlagsPanel({
  mapId,
  systems,
  connections,
  onClose,
  onChanged,
  readOnly = false,
}: Props) {
  const [flagged, setFlagged] = useState<FlaggedConnection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyFlagId, setBusyFlagId] = useState<number | null>(null);

  const refresh = () => {
    Promise.all(
      connections.map((connection) =>
        listConnectionFlags(connection.id).then((flags) => ({
          connection,
          flags,
        })),
      ),
    )
      .then((results) => setFlagged(results.filter((r) => r.flags.length > 0)))
      .catch((err) => setError(String(err)));
  };

  useEffect(refresh, [connections]);

  const handleAccept = async (flag: ConnectionFlagOut) => {
    setBusyFlagId(flag.id);
    try {
      await acceptConnectionFlag(mapId, flag.connection_id, flag.id);
      refresh();
      onChanged();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyFlagId(null);
    }
  };

  const handleDismiss = async (flag: ConnectionFlagOut) => {
    setBusyFlagId(flag.id);
    try {
      await dismissConnectionFlag(mapId, flag.connection_id, flag.id);
      refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyFlagId(null);
    }
  };

  return (
    <Dialog title="Flagged connections" onClose={onClose}>
      {error && <p className="error">{error}</p>}
      {flagged === null && <p>Loading…</p>}
      {flagged?.length === 0 && <p>No pending flags.</p>}
      {flagged?.map(({ connection, flags }) => (
        <div key={connection.id} className="connection-flags-group">
          <h3>
            {systemLabel(systems, connection.top_system_id)} ↔{" "}
            {systemLabel(systems, connection.bottom_system_id)}
          </h3>
          {flags.map((flag) => (
            <div key={flag.id} className="connection-flag-row">
              <span>
                {flag.flagged_by_name} suggests:{" "}
                {flag.suggests_collapsed
                  ? "collapsed"
                  : [
                      flag.suggested_life_status &&
                        `life: ${flag.suggested_life_status}`,
                      flag.suggested_mass_status &&
                        `mass: ${flag.suggested_mass_status}`,
                    ]
                      .filter(Boolean)
                      .join(", ")}
              </span>
              <button
                type="button"
                disabled={readOnly || busyFlagId === flag.id}
                onClick={() => handleAccept(flag)}
              >
                Accept
              </button>
              <button
                type="button"
                disabled={readOnly || busyFlagId === flag.id}
                onClick={() => handleDismiss(flag)}
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      ))}
    </Dialog>
  );
}
