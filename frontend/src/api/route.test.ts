import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";
import * as routeApi from "./route";

vi.mock("./client", () => ({
  api: {
    get: vi.fn().mockResolvedValue(undefined),
    post: vi.fn().mockResolvedValue(undefined),
    patch: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("route api", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockClear();
    vi.mocked(api.post).mockClear();
    vi.mocked(api.delete).mockClear();
  });

  it("getRoute", async () => {
    await routeApi.getRoute(1, 2);
    expect(api.get).toHaveBeenCalledWith("/route/?start_id=1&end_id=2");
  });

  it("shareRoute", async () => {
    await routeApi.shareRoute(1, 2);
    expect(api.post).toHaveBeenCalledWith("/route/shared/", {
      start_id: 1,
      end_id: 2,
    });
  });

  it("getSharedRoute", async () => {
    await routeApi.getSharedRoute(5);
    expect(api.get).toHaveBeenCalledWith("/route/shared/5/");
  });

  it("deleteSharedRoute", async () => {
    await routeApi.deleteSharedRoute(5);
    expect(api.delete).toHaveBeenCalledWith("/route/shared/5/");
  });

  it("listConnectionFlags", async () => {
    await routeApi.listConnectionFlags(9);
    expect(api.get).toHaveBeenCalledWith("/connections/9/flags/");
  });

  it("createConnectionFlag", async () => {
    await routeApi.createConnectionFlag(9, { suggests_collapsed: true });
    expect(api.post).toHaveBeenCalledWith("/connections/9/flag/", {
      suggests_collapsed: true,
    });
  });

  it("acceptConnectionFlag", async () => {
    await routeApi.acceptConnectionFlag(1, 9, 3);
    expect(api.post).toHaveBeenCalledWith(
      "/maps/1/connections/9/flags/3/accept/",
    );
  });

  it("dismissConnectionFlag", async () => {
    await routeApi.dismissConnectionFlag(1, 9, 3);
    expect(api.delete).toHaveBeenCalledWith("/maps/1/connections/9/flags/3/");
  });
});
