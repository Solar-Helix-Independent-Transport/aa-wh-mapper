import { useEffect, useState } from "react";
import { importRegion, listRegions } from "../api/maps";
import type { RegionImportResult, RegionOut } from "../api/types";
import { Dialog } from "./Dialog";
import { LoadingState } from "./LoadingState";

interface Props {
  mapId: number;
  onClose: () => void;
  onImported: () => void;
}

export function ImportRegionDialog({ mapId, onClose, onImported }: Props) {
  const [regions, setRegions] = useState<RegionOut[] | null>(null);
  const [regionId, setRegionId] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<RegionImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listRegions()
      .then((list) => {
        setRegions(list);
        setRegionId(list[0]?.id ?? null);
      })
      .catch((err) => setError(String(err)));
  }, []);

  const handleImport = async () => {
    if (regionId === null) {
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const summary = await importRegion(mapId, regionId);
      setResult(summary);
      onImported();
    } catch (err) {
      setError(String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog title="Import a region" onClose={onClose}>
      <p className="dim">
        Adds every system in the region to this map, laid out to match its real
        in-game layout, with stargates auto-linked. Flat (regular k-space)
        regions only.
      </p>

      {error && <p className="error">{error}</p>}

      {result ? (
        <p className="dim">
          Added {result.systems_added} system
          {result.systems_added === 1 ? "" : "s"} and {result.connections_added}{" "}
          connection{result.connections_added === 1 ? "" : "s"}.
        </p>
      ) : regions === null ? (
        <LoadingState label="Loading regions…" />
      ) : (
        <select
          value={regionId ?? ""}
          onChange={(event) => setRegionId(Number(event.target.value))}
        >
          {regions.map((region) => (
            <option key={region.id} value={region.id}>
              {region.name}
            </option>
          ))}
        </select>
      )}

      <div className="dialog-actions">
        {!result && (
          <button
            type="button"
            className="button-primary"
            onClick={handleImport}
            disabled={importing || regionId === null}
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
