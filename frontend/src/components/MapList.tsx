import { useEffect, useState } from "react";
import { createMap, deleteMap, listMaps, updateMap } from "../api/maps";
import type { MapOut } from "../api/types";
import { LoadingState } from "./LoadingState";

interface Props {
  onOpen: (map: MapOut) => void;
}

export function MapList({ onOpen }: Props) {
  const [maps, setMaps] = useState<MapOut[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingMapId, setEditingMapId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const refresh = () => {
    listMaps()
      .then(setMaps)
      .catch((err) => setError(String(err)));
  };

  useEffect(refresh, []);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) {
      return;
    }
    setCreating(true);
    try {
      const map = await createMap(newName.trim());
      setNewName("");
      refresh();
      onOpen(map);
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  };

  const startRename = (map: MapOut) => {
    setEditingMapId(map.id);
    setEditName(map.name);
  };

  const cancelRename = () => {
    setEditingMapId(null);
    setEditName("");
  };

  const saveRename = async (map: MapOut) => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === map.name) {
      cancelRename();
      return;
    }
    try {
      await updateMap(map.id, { name: trimmed });
      cancelRename();
      refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDelete = async (map: MapOut) => {
    const confirmed = window.confirm(
      `Delete "${map.name}"? This removes the whole map, including all its systems, signatures, and connections.`,
    );
    if (!confirmed) {
      return;
    }
    try {
      await deleteMap(map.id);
      refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  if (error) {
    return <p className="error">Failed to load maps: {error}</p>;
  }

  if (maps === null) {
    return <LoadingState label="Loading maps…" />;
  }

  const query = searchQuery.trim().toLowerCase();
  const matches = (m: MapOut) => !query || m.name.toLowerCase().includes(query);
  const mine = maps.filter((m) => m.is_owner && matches(m));
  const shared = maps.filter((m) => !m.is_owner && matches(m));

  return (
    <div className="map-list">
      <form className="new-map-form" onSubmit={handleCreate}>
        <input
          type="text"
          placeholder="New map name"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <button type="submit" disabled={creating || !newName.trim()}>
          Create map
        </button>
      </form>

      <input
        type="text"
        className="map-search-input"
        placeholder="Search maps…"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
      />

      <section>
        <h2>Your maps</h2>
        {mine.length === 0 ? (
          <p className="dim">
            {query
              ? "No maps match your search."
              : "No maps yet — create one above."}
          </p>
        ) : (
          <ul className="map-cards">
            {mine.map((m) => (
              <li
                key={m.id}
                className="map-card"
                onClick={() => editingMapId !== m.id && onOpen(m)}
              >
                <div className="map-card-info">
                  {editingMapId === m.id ? (
                    <input
                      autoFocus
                      className="map-card-rename-input"
                      value={editName}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => setEditName(event.target.value)}
                      // Blur saves (if the name actually changed - see
                      // saveRename) rather than discarding the edit, so
                      // clicking away commits it the same way Enter does -
                      // there's no separate Save button, so blur has to be
                      // the fallback "commit" gesture, not a silent cancel.
                      onBlur={() => saveRename(m)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur();
                        } else if (event.key === "Escape") {
                          cancelRename();
                        }
                      }}
                    />
                  ) : (
                    <span className="map-card-name">{m.name}</span>
                  )}
                  <span className={`badge badge-${m.visibility}`}>
                    {m.visibility}
                  </span>
                </div>
                <div
                  className="map-card-actions"
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => startRename(m)}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="link-button danger"
                    onClick={() => handleDelete(m)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Shared with you</h2>
        {shared.length === 0 ? (
          <p className="dim">
            {query
              ? "No maps match your search."
              : "Nothing shared with you yet."}
          </p>
        ) : (
          <ul className="map-cards">
            {shared.map((m) => (
              <li key={m.id} className="map-card" onClick={() => onOpen(m)}>
                <span className="map-card-name">{m.name}</span>
                <span className="map-card-owner">by {m.owner_name}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
