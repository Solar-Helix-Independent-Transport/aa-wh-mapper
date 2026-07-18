import { useEffect, useState } from "react";
import {
  listTrackableCharacters,
  removeTrackedCharacter,
  startTrackingCharacter,
  trackCharacterUrl,
} from "../api/maps";
import type { TrackableCharacterOut } from "../api/types";
import { TRACKED_CHARACTERS_REFRESH_INTERVAL_MS } from "../constants";
import { useNow } from "../hooks/useNow";
import { Dialog } from "./Dialog";
import { LoadingState } from "./LoadingState";

interface Props {
  onClose: () => void;
}

function lastSeenLabel(tc: TrackableCharacterOut): string {
  if (!tc.last_seen_at) {
    return "never seen";
  }
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(tc.last_seen_at).getTime()) / 1000),
  );
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function TrackedCharactersPanel({ onClose }: Props) {
  const [characters, setCharacters] = useState<TrackableCharacterOut[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  // Keeps the "Xm ago" labels below ticking over time even though nothing
  // else about the list changes in the meantime.
  useNow(TRACKED_CHARACTERS_REFRESH_INTERVAL_MS);

  const refresh = () => {
    listTrackableCharacters()
      .then(setCharacters)
      .catch((err) => setError(String(err)));
  };

  useEffect(refresh, []);

  const handleToggle = (tc: TrackableCharacterOut) => {
    const request = tc.is_tracked
      ? removeTrackedCharacter(tc.character_id)
      : startTrackingCharacter(tc.character_id);
    request.then(refresh).catch((err) => setError(String(err)));
  };

  return (
    <Dialog title="Tracked characters" onClose={onClose}>
      <p className="dim">
        Toggle on any of your characters with ESI location access granted.
        Live-tracked characters update while you have any map open, and appear
        on every map they're currently on.
      </p>

      {error && <p className="error">{error}</p>}

      {characters === null ? (
        <LoadingState label="Loading characters…" />
      ) : characters.length === 0 ? (
        <p className="dim">
          None of your characters have ESI location access granted yet - use the
          link below to add one.
        </p>
      ) : (
        <ul className="entry-list">
          {characters.map((tc) => {
            const offline = tc.is_tracked && !tc.is_online;
            return (
              <li
                key={tc.character_id}
                className={`entry-row${offline ? " entry-row-stale" : ""}`}
              >
                <div className="entry-row-title">
                  {tc.is_tracked && (
                    <span
                      className={`tracked-status-dot${offline ? " stale" : " live"}`}
                      title={offline ? "Offline" : "Live"}
                    />
                  )}
                  <span>{tc.character_name}</span>
                  <label
                    className="toggle-switch"
                    title={tc.is_tracked ? "Stop tracking" : "Start tracking"}
                  >
                    <input
                      type="checkbox"
                      checked={tc.is_tracked}
                      onChange={() => handleToggle(tc)}
                      aria-label={`${tc.is_tracked ? "Stop" : "Start"} tracking ${tc.character_name}`}
                    />
                    <span className="toggle-switch-slider" />
                  </label>
                </div>
                {tc.is_tracked && (
                  <div className="entry-row-controls dim">
                    <span>{tc.last_solar_system?.name ?? "unknown"}</span>
                    <span>{lastSeenLabel(tc)}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <a
        className="track-character-link"
        href={trackCharacterUrl(window.location.pathname)}
      >
        + Grant access to another character
      </a>

      <button type="button" className="link-button" onClick={onClose}>
        Close
      </button>
    </Dialog>
  );
}
