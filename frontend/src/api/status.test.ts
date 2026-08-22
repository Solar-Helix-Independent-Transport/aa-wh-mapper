import { describe, expect, it, vi } from "vitest";
import { api } from "./client";
import { getAppStatus } from "./status";

vi.mock("./client", () => ({
  api: { get: vi.fn().mockResolvedValue(undefined) },
}));

describe("status api", () => {
  it("getAppStatus", async () => {
    await getAppStatus();
    expect(api.get).toHaveBeenCalledWith("/status/");
  });
});
