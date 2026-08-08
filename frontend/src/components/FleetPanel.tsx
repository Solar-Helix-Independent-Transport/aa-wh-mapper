import { useCallback, useEffect, useState } from "react";
import {
  getFleetSession,
  listAvailableFleetCharacters,
  listFleetSessions,
  startFleetSession,
  stopFleetSession,
  stopWatchingFleetSession,
} from "../api/fleet";
import type { AvailableFleetCharacterOut, FleetSessionOut } from "../api/types";
import { useFleetSocket, type FleetEvent } from "../hooks/useFleetSocket";
import { FleetOverlay } from "./FleetOverlay";

/** Backseat fleet-mass-tracking panel, integrated into the Navigate view
 * per the fleet-mass-tracking wayfinder map's ticket 03 (not a standalone
 * page) - picks an available FC token to start tracking, or an already-
 * active session to watch, then shows ticket 10's Variant C overlay live. */
export function FleetPanel() {
  const [availableCharacters, setAvailableCharacters] = useState<
    AvailableFleetCharacterOut[]
  >([]);
  const [sessions, setSessions] = useState<FleetSessionOut[]>([]);
  const [selectedSession, setSelectedSession] =
    useState<FleetSessionOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshLists = useCallback(() => {
    listAvailableFleetCharacters()
      .then(setAvailableCharacters)
      .catch(() => {});
    listFleetSessions()
      .then(setSessions)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshLists();
  }, [refreshLists]);

  const handleStart = async (characterId: number) => {
    setLoading(true);
    setError(null);
    try {
      const session = await startFleetSession(characterId);
      setSelectedSession(session);
      refreshLists();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSession = async (sessionId: number) => {
    setError(null);
    try {
      setSelectedSession(await getFleetSession(sessionId));
    } catch (err) {
      setError(String(err));
    }
  };

  const handleStop = async () => {
    if (!selectedSession) return;
    try {
      await stopFleetSession(selectedSession.id);
      setSelectedSession(null);
      refreshLists();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleStopWatching = async () => {
    if (!selectedSession) return;
    try {
      await stopWatchingFleetSession(selectedSession.id);
      setSelectedSession(null);
      refreshLists();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleSocketEvent = useCallback(
    (event: FleetEvent) => {
      if (!selectedSession) return;
      if (event.event === "fleet.session_ended") {
        setSelectedSession(null);
        refreshLists();
        return;
      }
      if (event.event === "fleet.updated") {
        getFleetSession(selectedSession.id)
          .then(setSelectedSession)
          .catch(() => {});
      }
    },
    [selectedSession, refreshLists],
  );

  useFleetSocket(selectedSession?.id ?? null, handleSocketEvent);

  return (
    <div className="fleet-panel">
      {error && <p className="error">{error}</p>}

      {!selectedSession && (
        <>
          {sessions.length > 0 && (
            <div className="fleet-panel-sessions">
              <h4>Active fleet-tracking sessions</h4>
              <ul>
                {sessions.map((session) => (
                  <li key={session.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectSession(session.id)}
                    >
                      {session.fc_character_name}&apos;s fleet (
                      {session.members.length} tracked)
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="fleet-panel-picker">
            <h4>Start tracking a fleet</h4>
            {availableCharacters.length === 0 && (
              <p className="fleet-panel-empty">
                No characters with fleet-read ESI access granted yet.
              </p>
            )}
            <ul>
              {availableCharacters.map((character) => (
                <li key={character.character_id}>
                  <span>
                    {character.character_name} ({character.owner_name})
                  </span>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => handleStart(character.character_id)}
                  >
                    {character.has_active_session ? "Watch" : "Start"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {selectedSession && (
        <div className="fleet-panel-session">
          <div className="fleet-panel-session-header">
            <h4>{selectedSession.fc_character_name}&apos;s fleet</h4>
            <div className="fleet-panel-session-actions">
              <button type="button" onClick={() => setSelectedSession(null)}>
                Back
              </button>
              {selectedSession.is_starter ? (
                <button type="button" onClick={handleStop}>
                  Stop tracking
                </button>
              ) : selectedSession.is_watcher ? (
                <button type="button" onClick={handleStopWatching}>
                  Stop watching
                </button>
              ) : null}
            </div>
          </div>
          <FleetOverlay session={selectedSession} />
        </div>
      )}
    </div>
  );
}
