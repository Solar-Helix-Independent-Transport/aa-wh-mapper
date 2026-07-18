import { useState } from "react";
import {
  addConnection,
  addSystem,
  removeSystem,
  searchSolarSystems,
} from "../api/maps";
import type { MapSystemOut, SolarSystemOut } from "../api/types";
import { nextPosition } from "../lib/nextPosition";
import { useSearch } from "../hooks/useSearch";
import { Dialog } from "./Dialog";
import { SearchResultRow } from "./SearchResultRow";

interface Props {
  mapId: number;
  sourceSystemId: number;
  signatureId: number;
  existingSystems: MapSystemOut[];
  onSystemCreated: (system: MapSystemOut) => void;
  onClose: () => void;
}

export function ConnectSignatureDialog({
  mapId,
  sourceSystemId,
  signatureId,
  existingSystems,
  onSystemCreated,
  onClose,
}: Props) {
  const [existingSystemId, setExistingSystemId] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);
  const search = useSearch<SolarSystemOut>(searchSolarSystems, setError);

  const otherSystems = existingSystems.filter((s) => s.id !== sourceSystemId);

  const handleConnectExisting = async () => {
    if (existingSystemId === "") {
      return;
    }
    try {
      await addConnection(mapId, {
        top_system_id: sourceSystemId,
        bottom_system_id: existingSystemId,
        top_signature_id: signatureId,
      });
      onClose();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleConnectNew = async (system: SolarSystemOut) => {
    let created: MapSystemOut | undefined;
    try {
      created = await addSystem(mapId, {
        solar_system_id: system.id,
        ...nextPosition(existingSystems),
      });
      // Merge into local state right away rather than waiting on the
      // system.added websocket round-trip - otherwise resolving a second
      // signature to another new system before that round-trip completes
      // sees stale existingSystems and nextPosition computes an overlapping
      // position for it.
      onSystemCreated(created);
      await addConnection(mapId, {
        top_system_id: sourceSystemId,
        bottom_system_id: created.id,
        top_signature_id: signatureId,
      });
      onClose();
    } catch (err) {
      if (created) {
        // addSystem succeeded but addConnection failed - roll back so the
        // dialog doesn't leave an orphaned, connection-less system behind,
        // and a retry can't create a duplicate for the same solar system.
        removeSystem(mapId, created.id).catch(() => {});
      }
      setError(String(err));
    }
  };

  return (
    <Dialog title="Link this wormhole to another system" onClose={onClose}>
      {error && <p className="error">{error}</p>}

      {otherSystems.length > 0 && (
        <div className="dialog-section">
          <p className="dim">Already on this map</p>
          <div className="dialog-actions">
            <select
              value={existingSystemId}
              onChange={(event) =>
                setExistingSystemId(
                  event.target.value ? Number(event.target.value) : "",
                )
              }
            >
              <option value="">Select a system…</option>
              {otherSystems.map((system) => (
                <option key={system.id} value={system.id}>
                  {system.label || system.solar_system.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="button-primary"
              disabled={existingSystemId === ""}
              onClick={handleConnectExisting}
            >
              Connect
            </button>
          </div>
        </div>
      )}

      <div className="dialog-section">
        <p className="dim">Or a new system</p>
        <input
          autoFocus
          type="text"
          placeholder="Search solar system…"
          value={search.query}
          onChange={(event) => search.setQuery(event.target.value)}
        />
        <ul className="search-results">
          {search.results.map((system) => (
            <SearchResultRow
              key={system.id}
              onSelect={() => handleConnectNew(system)}
            >
              {system.name}
            </SearchResultRow>
          ))}
        </ul>
      </div>

      <button type="button" className="link-button" onClick={onClose}>
        Cancel
      </button>
    </Dialog>
  );
}
