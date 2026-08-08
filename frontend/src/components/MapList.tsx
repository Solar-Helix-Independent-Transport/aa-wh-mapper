import { useCallback, useEffect, useMemo, useState } from "react";
import { createMap, deleteMap, listMaps, updateMap } from "../api/maps";
import type { MapOut } from "../api/types";
import { relativeTimeLabel } from "../lib/relativeTime";
import { DataTable } from "./DataTable";
import { dataTableColumnHelper } from "./dataTableFeatures";
import { LoadingState } from "./LoadingState";

interface Props {
  onOpen: (map: MapOut) => void;
}

function ActiveUsersBadge({ count }: { count: number }) {
  if (count === 0) {
    return null;
  }
  return (
    <span
      className="map-card-active-users"
      title={`${count} active user${count === 1 ? "" : "s"}`}
    >
      <i className="fas fa-users" /> {count}
    </span>
  );
}

const mineColumnHelper = dataTableColumnHelper<MapOut>();
const sharedColumnHelper = dataTableColumnHelper<MapOut>();

export function MapList({ onOpen }: Props) {
  const [maps, setMaps] = useState<MapOut[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingMapId, setEditingMapId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

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

  const startRename = useCallback((map: MapOut) => {
    setEditingMapId(map.id);
    setEditName(map.name);
  }, []);

  const cancelRename = useCallback(() => {
    setEditingMapId(null);
    setEditName("");
  }, []);

  const saveRename = useCallback(
    async (map: MapOut) => {
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
    },
    [editName, cancelRename],
  );

  const handleDelete = useCallback(async (map: MapOut) => {
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
  }, []);

  // Depends on editingMapId/editName (via startRename/saveRename/
  // cancelRename closing over them) so the rename cell's input re-renders
  // with the right row in edit mode and the right in-progress text -
  // StatusPage's module-scope columns can't close over per-render state the
  // way these need to.
  const mineColumns = useMemo(
    () =>
      mineColumnHelper.columns([
        mineColumnHelper.accessor("name", {
          header: "Name",
          cell: (info) => {
            const map = info.row.original;
            return editingMapId === map.id ? (
              <input
                autoFocus
                className="map-card-rename-input"
                value={editName}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => setEditName(event.target.value)}
                // Blur saves (if the name actually changed - see
                // saveRename) rather than discarding the edit, so clicking
                // away commits it the same way Enter does - there's no
                // separate Save button, so blur has to be the fallback
                // "commit" gesture, not a silent cancel.
                onBlur={() => saveRename(map)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  } else if (event.key === "Escape") {
                    cancelRename();
                  }
                }}
              />
            ) : (
              <span className="map-card-name">{map.name}</span>
            );
          },
        }),
        mineColumnHelper.accessor("visibility", {
          header: "Visibility",
          cell: (info) => (
            <span className={`badge badge-${info.getValue()}`}>
              {info.getValue()}
            </span>
          ),
        }),
        mineColumnHelper.accessor("active_users", {
          header: "Active",
          cell: (info) => <ActiveUsersBadge count={info.getValue()} />,
        }),
        mineColumnHelper.accessor("last_updated", {
          header: "Last updated",
          cell: (info) => relativeTimeLabel(info.getValue()),
        }),
        mineColumnHelper.display({
          id: "actions",
          header: "",
          enableSorting: false,
          cell: (info) => {
            const map = info.row.original;
            return (
              <div
                className="map-card-actions"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="link-button"
                  onClick={() => startRename(map)}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="link-button danger"
                  onClick={() => handleDelete(map)}
                >
                  Delete
                </button>
              </div>
            );
          },
        }),
      ]),
    [
      editingMapId,
      editName,
      startRename,
      cancelRename,
      saveRename,
      handleDelete,
    ],
  );

  const sharedColumns = useMemo(
    () =>
      sharedColumnHelper.columns([
        sharedColumnHelper.accessor("name", {
          header: "Name",
          cell: (info) => (
            <span className="map-card-name">{info.getValue()}</span>
          ),
        }),
        sharedColumnHelper.accessor("owner_name", { header: "Owner" }),
        sharedColumnHelper.accessor("active_users", {
          header: "Active",
          cell: (info) => <ActiveUsersBadge count={info.getValue()} />,
        }),
        sharedColumnHelper.accessor("last_updated", {
          header: "Last updated",
          cell: (info) => relativeTimeLabel(info.getValue()),
        }),
      ]),
    [],
  );

  if (error) {
    return <p className="error">Failed to load maps: {error}</p>;
  }

  if (maps === null) {
    return <LoadingState label="Loading maps…" />;
  }

  const mine = maps.filter((m) => m.is_owner);
  const shared = maps.filter((m) => !m.is_owner);

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

      <section>
        <h2>Your maps</h2>
        <DataTable
          data={mine}
          columns={mineColumns}
          getRowId={(map) => String(map.id)}
          onRowClick={(map) => editingMapId !== map.id && onOpen(map)}
          searchPlaceholder="Search your maps…"
          emptyMessage="No maps yet — create one above."
        />
      </section>

      <section>
        <h2>Shared with you</h2>
        <DataTable
          data={shared}
          columns={sharedColumns}
          getRowId={(map) => String(map.id)}
          onRowClick={onOpen}
          searchPlaceholder="Search shared maps…"
          emptyMessage="Nothing shared with you yet."
        />
      </section>
    </div>
  );
}
