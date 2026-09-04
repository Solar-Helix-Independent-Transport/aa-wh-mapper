import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";
import * as mapsApi from "./maps";

vi.mock("./client", () => ({
  api: {
    get: vi.fn().mockResolvedValue(undefined),
    post: vi.fn().mockResolvedValue(undefined),
    patch: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("maps api", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockClear();
    vi.mocked(api.post).mockClear();
    vi.mocked(api.patch).mockClear();
    vi.mocked(api.delete).mockClear();
  });

  it("searchSolarSystems URL-encodes the query", async () => {
    await mapsApi.searchSolarSystems("J1 2-3");
    expect(api.get).toHaveBeenCalledWith("/solar-systems/search/J1%202-3/");
  });

  it("listMaps", async () => {
    await mapsApi.listMaps();
    expect(api.get).toHaveBeenCalledWith("/maps/");
  });

  it("createMap defaults visibility to private", async () => {
    await mapsApi.createMap("My Map");
    expect(api.post).toHaveBeenCalledWith("/maps/", {
      name: "My Map",
      visibility: "private",
    });
  });

  it("createMap passes an explicit visibility through", async () => {
    await mapsApi.createMap("Shared Map", "shared");
    expect(api.post).toHaveBeenCalledWith("/maps/", {
      name: "Shared Map",
      visibility: "shared",
    });
  });

  it("updateMap", async () => {
    await mapsApi.updateMap(1, { name: "Renamed" });
    expect(api.patch).toHaveBeenCalledWith("/maps/1/", { name: "Renamed" });
  });

  it("deleteMap", async () => {
    await mapsApi.deleteMap(1);
    expect(api.delete).toHaveBeenCalledWith("/maps/1/");
  });

  it("getMapState", async () => {
    await mapsApi.getMapState(1);
    expect(api.get).toHaveBeenCalledWith("/maps/1/state/");
  });

  it("addSystem", async () => {
    await mapsApi.addSystem(1, { solar_system_id: 30000142 });
    expect(api.post).toHaveBeenCalledWith("/maps/1/systems/", {
      solar_system_id: 30000142,
    });
  });

  it("updateSystem", async () => {
    await mapsApi.updateSystem(1, 2, { label: "Home" });
    expect(api.patch).toHaveBeenCalledWith("/maps/1/systems/2/", {
      label: "Home",
    });
  });

  it("removeSystem", async () => {
    await mapsApi.removeSystem(1, 2);
    expect(api.delete).toHaveBeenCalledWith("/maps/1/systems/2/");
  });

  it("autoLayoutSystems", async () => {
    await mapsApi.autoLayoutSystems(1, [{ id: 2, x: 10, y: 20 }]);
    expect(api.post).toHaveBeenCalledWith("/maps/1/systems/auto-layout/", {
      positions: [{ id: 2, x: 10, y: 20 }],
    });
  });

  it("getSystemDetails", async () => {
    await mapsApi.getSystemDetails(1, 2);
    expect(api.get).toHaveBeenCalledWith("/maps/1/systems/2/details/");
  });

  it("addSignature", async () => {
    await mapsApi.addSignature(1, 2, { signature_id: "ABC-123" });
    expect(api.post).toHaveBeenCalledWith("/maps/1/systems/2/signatures/", {
      signature_id: "ABC-123",
    });
  });

  it("updateSignature", async () => {
    await mapsApi.updateSignature(1, 2, 3, { is_hidden: true });
    expect(api.patch).toHaveBeenCalledWith("/maps/1/systems/2/signatures/3/", {
      is_hidden: true,
    });
  });

  it("removeSignature", async () => {
    await mapsApi.removeSignature(1, 2, 3);
    expect(api.delete).toHaveBeenCalledWith("/maps/1/systems/2/signatures/3/");
  });

  it("bulkUpsertSignatures defaults lazyDelete/removeDanglingSystems to false", async () => {
    await mapsApi.bulkUpsertSignatures(1, 2, [{ signature_id: "ABC-123" }]);
    expect(api.post).toHaveBeenCalledWith(
      "/maps/1/systems/2/signatures/bulk/",
      {
        rows: [{ signature_id: "ABC-123" }],
        lazy_delete: false,
        remove_dangling_systems: false,
      },
    );
  });

  it("bulkUpsertSignatures passes explicit flags through", async () => {
    await mapsApi.bulkUpsertSignatures(1, 2, [], true, true);
    expect(api.post).toHaveBeenCalledWith(
      "/maps/1/systems/2/signatures/bulk/",
      {
        rows: [],
        lazy_delete: true,
        remove_dangling_systems: true,
      },
    );
  });

  it("listWormholeTypes", async () => {
    await mapsApi.listWormholeTypes();
    expect(api.get).toHaveBeenCalledWith("/wormhole-types/");
  });

  it("addConnection", async () => {
    await mapsApi.addConnection(1, { top_system_id: 2, bottom_system_id: 3 });
    expect(api.post).toHaveBeenCalledWith("/maps/1/connections/", {
      top_system_id: 2,
      bottom_system_id: 3,
    });
  });

  it("updateConnection", async () => {
    await mapsApi.updateConnection(1, 2, { mass_status: "critical" });
    expect(api.patch).toHaveBeenCalledWith("/maps/1/connections/2/", {
      mass_status: "critical",
    });
  });

  it("removeConnection", async () => {
    await mapsApi.removeConnection(1, 2);
    expect(api.delete).toHaveBeenCalledWith("/maps/1/connections/2/");
  });

  it("getConnectionDetails", async () => {
    await mapsApi.getConnectionDetails(1, 2);
    expect(api.get).toHaveBeenCalledWith("/maps/1/connections/2/details/");
  });

  it("linkConnectionSignature", async () => {
    await mapsApi.linkConnectionSignature(1, 2, 3);
    expect(api.post).toHaveBeenCalledWith("/maps/1/connections/2/signature/", {
      signature_id: 3,
    });
  });

  it("searchCharacters URL-encodes the query", async () => {
    await mapsApi.searchCharacters("O'Brien");
    expect(api.get).toHaveBeenCalledWith("/characters/search/O'Brien/");
  });

  it("searchCorporations URL-encodes the query", async () => {
    await mapsApi.searchCorporations("A & B");
    expect(api.get).toHaveBeenCalledWith("/corporations/search/A%20%26%20B/");
  });

  it("searchAlliances", async () => {
    await mapsApi.searchAlliances("Test");
    expect(api.get).toHaveBeenCalledWith("/alliances/search/Test/");
  });

  it("searchGroups", async () => {
    await mapsApi.searchGroups("Test");
    expect(api.get).toHaveBeenCalledWith("/groups/search/Test/");
  });

  it("listShares", async () => {
    await mapsApi.listShares(1);
    expect(api.get).toHaveBeenCalledWith("/maps/1/shares/");
  });

  it("addShare", async () => {
    await mapsApi.addShare(1, "corporation", 2000);
    expect(api.post).toHaveBeenCalledWith("/maps/1/share/", {
      scope: "corporation",
      target_id: 2000,
    });
  });

  it("removeShare", async () => {
    await mapsApi.removeShare(1, "corporation", 2000);
    expect(api.delete).toHaveBeenCalledWith("/maps/1/share/corporation/2000/");
  });

  it("listTrackableCharacters", async () => {
    await mapsApi.listTrackableCharacters();
    expect(api.get).toHaveBeenCalledWith("/trackable-characters/");
  });

  it("startTrackingCharacter", async () => {
    await mapsApi.startTrackingCharacter(123);
    expect(api.post).toHaveBeenCalledWith("/trackable-characters/123/track/");
  });

  it("removeTrackedCharacter", async () => {
    await mapsApi.removeTrackedCharacter(123);
    expect(api.delete).toHaveBeenCalledWith("/tracked-characters/123/");
  });

  it("trackCharacterUrl with no next param", () => {
    expect(mapsApi.trackCharacterUrl()).toBe("/wh-mapper/track/add/");
  });

  it("trackCharacterUrl encodes an explicit next param", () => {
    expect(mapsApi.trackCharacterUrl("/wh-mapper/maps/1")).toBe(
      "/wh-mapper/track/add/?next=%2Fwh-mapper%2Fmaps%2F1",
    );
  });

  it("listRegions", async () => {
    await mapsApi.listRegions();
    expect(api.get).toHaveBeenCalledWith("/regions/");
  });

  it("getUniverseRegionsGraph", async () => {
    await mapsApi.getUniverseRegionsGraph();
    expect(api.get).toHaveBeenCalledWith("/universe/regions-graph/");
  });

  it("importRegion", async () => {
    await mapsApi.importRegion(1, 10000002);
    expect(api.post).toHaveBeenCalledWith("/maps/1/import-region/", {
      region_id: 10000002,
    });
  });

  it("importFromMap", async () => {
    await mapsApi.importFromMap(1, 2);
    expect(api.post).toHaveBeenCalledWith("/maps/1/import-from-map/", {
      source_map_id: 2,
    });
  });
});
