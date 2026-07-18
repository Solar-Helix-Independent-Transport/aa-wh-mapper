import { useCallback, useState } from "react";
import { addSystem, searchSolarSystems } from "../api/maps";
import type { SolarSystemOut } from "../api/types";
import { nextPosition } from "../lib/nextPosition";
import { useSearch } from "../hooks/useSearch";
import { Dialog } from "./Dialog";
import { SearchResultRow } from "./SearchResultRow";

interface Props {
  mapId: number;
  existingSystems: { x: number; y: number }[];
  // Where to place the new system - e.g. the exact point a user right-clicked
  // to open this dialog. Falls back to auto-placement via nextPosition when
  // opened from the toolbar instead of the canvas.
  position?: { x: number; y: number };
  onClose: () => void;
  onAdded: () => void;
}

export function AddSystemDialog({
  mapId,
  existingSystems,
  position,
  onClose,
  onAdded,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const searchAndSort = useCallback(
    (value: string) =>
      searchSolarSystems(value).then((found) =>
        found.slice().sort((a, b) => a.name.localeCompare(b.name)),
      ),
    [],
  );
  const search = useSearch<SolarSystemOut>(searchAndSort, setError);

  const handleAdd = async (system: SolarSystemOut) => {
    try {
      await addSystem(mapId, {
        solar_system_id: system.id,
        ...(position ?? nextPosition(existingSystems)),
      });
      onAdded();
      onClose();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <Dialog title="Add a system" onClose={onClose}>
      <input
        autoFocus
        type="text"
        placeholder="Search solar system…"
        value={search.query}
        onChange={(event) => search.setQuery(event.target.value)}
      />
      {error && <p className="error">{error}</p>}
      <ul className="search-results">
        {search.results.map((system) => (
          <SearchResultRow key={system.id} onSelect={() => handleAdd(system)}>
            {system.name}
          </SearchResultRow>
        ))}
      </ul>
      <button type="button" className="link-button" onClick={onClose}>
        Cancel
      </button>
    </Dialog>
  );
}
