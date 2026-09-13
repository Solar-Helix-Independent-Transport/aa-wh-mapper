import { useEffect, useMemo, useRef, useState } from "react";
import type { MapSystemOut, TrackedCharacterOut } from "../api/types";
import { SearchResultRow } from "./SearchResultRow";

interface Entry {
  characterId: number;
  characterName: string;
  isOwn: boolean;
  systemId: number | null;
  systemLabel: string | null;
}

interface Props {
  characters: TrackedCharacterOut[];
  systems: MapSystemOut[];
  currentUserId: number;
  onFocus: (systemId: number) => void;
}

// Sits next to MapLegend in the bottom toolbar (see MapCanvas) - a button
// that pops open a searchable list of every currently-active tracked
// character on this map, so jumping to wherever a specific character is
// doesn't mean hunting for them across a big, zoomed-out map by eye.
export function CharacterFinder({
  characters,
  systems,
  currentUserId,
  onFocus,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    // Capture phase, not bubble - see the same pattern in MapLegend.
    document.addEventListener("mousedown", handleClickOutside, true);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside, true);
  }, [open]);

  const entries = useMemo<Entry[]>(() => {
    return characters
      .map((tc) => {
        // Matches MapCanvas's own tracked-character-to-node lookup - a
        // character can be tracked but currently sitting somewhere off this
        // particular map, in which case there's nothing here to focus on.
        const system = tc.last_solar_system
          ? systems.find((s) => s.solar_system.id === tc.last_solar_system?.id)
          : undefined;
        return {
          characterId: tc.character_id,
          characterName: tc.character_name,
          isOwn: tc.added_by_id === currentUserId,
          systemId: system?.id ?? null,
          systemLabel: system ? system.label || system.solar_system.name : null,
        };
      })
      .sort((a, b) => a.characterName.localeCompare(b.characterName));
  }, [characters, systems, currentUserId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return entries;
    }
    return entries.filter((entry) =>
      entry.characterName.toLowerCase().includes(q),
    );
  }, [entries, query]);

  const handleSelect = (entry: Entry) => {
    if (entry.systemId === null) {
      return;
    }
    onFocus(entry.systemId);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="character-finder" ref={ref}>
      <button type="button" onClick={() => setOpen((current) => !current)}>
        Characters{entries.length > 0 ? ` (${entries.length})` : ""}
      </button>
      {open && (
        <div className="character-finder-popover">
          <input
            autoFocus
            type="text"
            placeholder="Find character…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {entries.length === 0 ? (
            <p className="dim">No active characters on this map.</p>
          ) : filtered.length === 0 ? (
            <p className="dim">No match.</p>
          ) : (
            <ul className="search-results character-finder-list">
              {filtered.map((entry) =>
                entry.systemId === null ? (
                  <li
                    key={entry.characterId}
                    className="character-finder-offmap"
                  >
                    <span className="character-finder-row">
                      <span
                        className="legend-dot"
                        style={{
                          background: entry.isOwn
                            ? "var(--success)"
                            : "var(--text-dim)",
                        }}
                      />
                      <span className="character-finder-name">
                        {entry.characterName}
                      </span>
                      <span className="character-finder-system dim">
                        not on this map
                      </span>
                    </span>
                  </li>
                ) : (
                  <SearchResultRow
                    key={entry.characterId}
                    onSelect={() => handleSelect(entry)}
                  >
                    <span className="character-finder-row">
                      <span
                        className="legend-dot"
                        style={{
                          background: entry.isOwn
                            ? "var(--success)"
                            : "var(--text-dim)",
                        }}
                      />
                      <span className="character-finder-name">
                        {entry.characterName}
                      </span>
                      <span className="character-finder-system dim">
                        {entry.systemLabel}
                      </span>
                    </span>
                  </SearchResultRow>
                ),
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
