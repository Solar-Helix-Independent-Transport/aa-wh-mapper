import { api } from "./client";
import type { AvailableFleetCharacterOut, FleetSessionOut } from "./types";

export const listAvailableFleetCharacters = () =>
  api.get<AvailableFleetCharacterOut[]>("/fleet/available-characters/");

export const startFleetSession = (characterId: number) =>
  api.post<FleetSessionOut>(`/fleet/sessions/${characterId}/start/`);

export const stopFleetSession = (sessionId: number) =>
  api.delete<void>(`/fleet/sessions/${sessionId}/`);

export const stopWatchingFleetSession = (sessionId: number) =>
  api.delete<void>(`/fleet/sessions/${sessionId}/watch/`);

export const listFleetSessions = () =>
  api.get<FleetSessionOut[]>("/fleet/sessions/");

export const getFleetSession = (sessionId: number) =>
  api.get<FleetSessionOut>(`/fleet/sessions/${sessionId}/`);
