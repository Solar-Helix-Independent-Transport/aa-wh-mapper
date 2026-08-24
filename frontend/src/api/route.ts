import { api } from "./client";
import type {
  ConnectionFlagAcceptResult,
  ConnectionFlagOut,
  RouteOut,
  RouteSummaryOut,
  SharedRouteOut,
} from "./types";

export const getRoute = (startId: number, endId: number) =>
  api.get<RouteOut>(`/route/?start_id=${startId}&end_id=${endId}`);

export const listMyRoutes = () => api.get<RouteSummaryOut[]>("/route/shared/");

export const shareRoute = (startId: number, endId: number) =>
  api.post<SharedRouteOut>("/route/shared/", {
    start_id: startId,
    end_id: endId,
  });

export const getSharedRoute = (routeId: number) =>
  api.get<SharedRouteOut>(`/route/shared/${routeId}/`);

export const deleteSharedRoute = (routeId: number) =>
  api.delete<void>(`/route/shared/${routeId}/`);

export const listConnectionFlags = (connectionId: number) =>
  api.get<ConnectionFlagOut[]>(`/connections/${connectionId}/flags/`);

export const createConnectionFlag = (
  connectionId: number,
  payload: {
    suggested_life_status?: string | null;
    suggested_mass_status?: string | null;
    suggests_collapsed?: boolean;
  },
) => api.post<ConnectionFlagOut>(`/connections/${connectionId}/flag/`, payload);

export const acceptConnectionFlag = (
  mapId: number,
  connectionId: number,
  flagId: number,
) =>
  api.post<ConnectionFlagAcceptResult>(
    `/maps/${mapId}/connections/${connectionId}/flags/${flagId}/accept/`,
  );

export const dismissConnectionFlag = (
  mapId: number,
  connectionId: number,
  flagId: number,
) =>
  api.delete<void>(
    `/maps/${mapId}/connections/${connectionId}/flags/${flagId}/`,
  );
