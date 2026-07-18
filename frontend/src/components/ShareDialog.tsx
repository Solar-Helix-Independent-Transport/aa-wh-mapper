import { useEffect, useState } from "react";
import {
  addShare,
  listShares,
  removeShare,
  searchAlliances,
  searchCharacters,
  searchCorporations,
  searchGroups,
  updateMap,
} from "../api/maps";
import type { MapOut, ShareOut, ShareScope } from "../api/types";
import { useSearch } from "../hooks/useSearch";
import { Dialog } from "./Dialog";
import { SearchResultRow } from "./SearchResultRow";

interface Props {
  map: MapOut;
  onClose: () => void;
  onMapUpdated: (map: MapOut) => void;
}

type SearchResult = { id: number; label: string };

const SEARCH_BY_SCOPE: Record<
  ShareScope,
  (query: string) => Promise<SearchResult[]>
> = {
  character: (query) =>
    searchCharacters(query).then((hits) =>
      hits.map((h) => ({ id: h.character_id, label: h.character_name })),
    ),
  corporation: (query) =>
    searchCorporations(query).then((hits) =>
      hits.map((h) => ({ id: h.corporation_id, label: h.corporation_name })),
    ),
  alliance: (query) =>
    searchAlliances(query).then((hits) =>
      hits.map((h) => ({ id: h.alliance_id, label: h.alliance_name })),
    ),
  group: (query) =>
    searchGroups(query).then((hits) =>
      hits.map((h) => ({ id: h.group_id, label: h.group_name })),
    ),
};

export function ShareDialog({ map, onClose, onMapUpdated }: Props) {
  const [scope, setScope] = useState<ShareScope>("character");
  const [shares, setShares] = useState<ShareOut[]>([]);
  const [error, setError] = useState<string | null>(null);
  const search = useSearch<SearchResult>(SEARCH_BY_SCOPE[scope], setError);

  const refreshShares = () => {
    listShares(map.id)
      .then(setShares)
      .catch((err) => setError(String(err)));
  };

  useEffect(refreshShares, [map.id]);

  const handleGrant = async (result: SearchResult) => {
    try {
      if (map.visibility !== "shared") {
        const updated = await updateMap(map.id, { visibility: "shared" });
        onMapUpdated(updated);
      }
      await addShare(map.id, scope, result.id);
      search.reset();
      refreshShares();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleRevoke = async (share: ShareOut) => {
    try {
      await removeShare(map.id, share.scope, share.target_id);
      refreshShares();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <Dialog title={`Share "${map.name}"`} onClose={onClose}>
      {error && <p className="error">{error}</p>}

      {!map.can_edit_sharing && (
        <p className="dim">
          Only the map's owner can change who it's shared with.
        </p>
      )}

      <div className="share-existing">
        {shares.length === 0 ? (
          <p className="dim">Not shared with anyone yet.</p>
        ) : (
          <ul className="entry-list">
            {shares.map((share) => (
              <li
                key={`${share.scope}-${share.target_id}`}
                className="entry-row"
              >
                <span className="badge">{share.scope}</span>
                <span>{share.target_name ?? `#${share.target_id}`}</span>
                {map.can_edit_sharing && (
                  <button
                    type="button"
                    className="link-button danger"
                    onClick={() => handleRevoke(share)}
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {map.can_edit_sharing && (
        <div className="share-search">
          <div className="scope-tabs">
            {(
              ["character", "corporation", "alliance", "group"] as ShareScope[]
            ).map((s) => (
              <button
                key={s}
                type="button"
                className={s === scope ? "scope-tab active" : "scope-tab"}
                onClick={() => {
                  setScope(s);
                  search.reset();
                }}
              >
                {s}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder={`Search ${scope}…`}
            value={search.query}
            onChange={(event) => search.setQuery(event.target.value)}
          />
          <ul className="search-results">
            {search.results.map((result) => (
              <SearchResultRow
                key={result.id}
                onSelect={() => handleGrant(result)}
              >
                {result.label}
              </SearchResultRow>
            ))}
          </ul>
        </div>
      )}

      <button type="button" className="link-button" onClick={onClose}>
        Done
      </button>
    </Dialog>
  );
}
