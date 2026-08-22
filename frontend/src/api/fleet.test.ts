import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";
import * as fleetApi from "./fleet";

vi.mock("./client", () => ({
  api: {
    get: vi.fn().mockResolvedValue(undefined),
    post: vi.fn().mockResolvedValue(undefined),
    patch: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("fleet api", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockClear();
    vi.mocked(api.post).mockClear();
    vi.mocked(api.delete).mockClear();
  });

  it("listAvailableFleetCharacters", async () => {
    await fleetApi.listAvailableFleetCharacters();
    expect(api.get).toHaveBeenCalledWith("/fleet/available-characters/");
  });

  it("startFleetSession", async () => {
    await fleetApi.startFleetSession(123);
    expect(api.post).toHaveBeenCalledWith("/fleet/sessions/123/start/");
  });

  it("stopFleetSession", async () => {
    await fleetApi.stopFleetSession(7);
    expect(api.delete).toHaveBeenCalledWith("/fleet/sessions/7/");
  });

  it("stopWatchingFleetSession", async () => {
    await fleetApi.stopWatchingFleetSession(7);
    expect(api.delete).toHaveBeenCalledWith("/fleet/sessions/7/watch/");
  });

  it("listFleetSessions", async () => {
    await fleetApi.listFleetSessions();
    expect(api.get).toHaveBeenCalledWith("/fleet/sessions/");
  });

  it("getFleetSession", async () => {
    await fleetApi.getFleetSession(7);
    expect(api.get).toHaveBeenCalledWith("/fleet/sessions/7/");
  });
});
