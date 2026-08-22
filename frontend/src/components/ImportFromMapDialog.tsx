import { useEffect, useState } from "react";
import { importFromMap, listMaps } from "../api/maps";
import type { MapImportResult, MapOut } from "../api/types";
import { Dialog } from "./Dialog";
import { LoadingState } from "./LoadingState";

interface Props {
  mapId: number;
  onClose: () => void;
  onImported: () => void;
}

/** Bulk-copies a read-only reference map's (the eve-scout Thera/Turnur
 * maps) current systems/signatures/connections onto this map - mirrors
 * ImportRegionDialog's shape, but the picker lists read-only Maps instead
 * of SDE regions. */
export function ImportFromMapDialog({ mapId, onClose, onImported }: Props) {
  const [sourceMaps, setSourceMaps] = useState<MapOut[] | null>(null);
  const [sourceMapId, setSourceMapId] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<MapImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMaps()
      .then((maps) => {
        const readOnlyMaps = maps.filter((m) => m.read_only && m.id !== mapId);
        setSourceMaps(readOnlyMaps);
        setSourceMapId(readOnlyMaps[0]?.id ?? null);
      })
      .catch((err) => setError(String(err)));
  }, [mapId]);

  const handleImport = async () => {
    if (sourceMapId === null) {
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const summary = await importFromMap(mapId, sourceMapId);
      setResult(summary);
      onImported();
    } catch (err) {
      setError(String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog title="Import from a reference map" onClose={onClose}>
      <p className="dim">
        Adds every system, signature, and connection currently on a read-only
        reference map (like the eve-scout Thera/Turnur maps) to this map.
        Re-importing later only adds whatever's new.
      </p>

      {error && <p className="error">{error}</p>}

      {result ? (
        <p className="dim">
          Added {result.systems_added} system
          {result.systems_added === 1 ? "" : "s"}, {result.signatures_added}{" "}
          signature{result.signatures_added === 1 ? "" : "s"}, and{" "}
          {result.connections_added} connection
          {result.connections_added === 1 ? "" : "s"}.
        </p>
      ) : sourceMaps === null ? (
        <LoadingState label="Loading reference maps…" />
      ) : sourceMaps.length === 0 ? (
        <p className="dim">No read-only reference maps available yet.</p>
      ) : (
        <select
          value={sourceMapId ?? ""}
          onChange={(event) => setSourceMapId(Number(event.target.value))}
        >
          {sourceMaps.map((map) => (
            <option key={map.id} value={map.id}>
              {map.name}
            </option>
          ))}
        </select>
      )}

      <div className="dialog-actions">
        {!result && sourceMaps !== null && sourceMaps.length > 0 && (
          <button
            type="button"
            className="button-primary"
            onClick={handleImport}
            disabled={importing || sourceMapId === null}
          >
            {importing ? "Importing…" : "Import"}
          </button>
        )}
        <button type="button" className="link-button" onClick={onClose}>
          {result ? "Done" : "Cancel"}
        </button>
      </div>
    </Dialog>
  );
}
