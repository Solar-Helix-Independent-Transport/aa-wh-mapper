import { api } from "./client";
import type { AppStatusOut } from "./types";

export const getAppStatus = () => api.get<AppStatusOut>("/status/");
