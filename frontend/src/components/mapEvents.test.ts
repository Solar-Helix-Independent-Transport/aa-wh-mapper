import { describe, expect, it } from "vitest";
import { applyMapEvent } from "./mapEvents";
import type { MapEvent } from "../hooks/useMapSocket";
import type {
  MapStateOut,
  MapSystemOut,
  SignatureOut,
  TrackedCharacterOut,
  WormholeConnectionOut,
} from "../api/types";

// applyMapEvent only ever reads `.id`/`.character_id` off these fixtures (it
// never touches `map` or `current_user_id`), so the nested shapes each item
// would carry in the real API (solar_system, etc.) are irrelevant here.
function system(id: number, extra: Record<string, unknown> = {}): MapSystemOut {
  return { id, ...extra } as MapSystemOut;
}
function signature(
  id: number,
  extra: Record<string, unknown> = {},
): SignatureOut {
  return { id, ...extra } as SignatureOut;
}
function connection(
  id: number,
  extra: Record<string, unknown> = {},
): WormholeConnectionOut {
  return { id, ...extra } as WormholeConnectionOut;
}
function character(
  characterId: number,
  extra: Record<string, unknown> = {},
): TrackedCharacterOut {
  return { character_id: characterId, ...extra } as TrackedCharacterOut;
}

function makeState(overrides: Partial<MapStateOut> = {}): MapStateOut {
  return {
    map: {} as MapStateOut["map"],
    systems: [],
    signatures: [],
    connections: [],
    tracked_characters: [],
    current_user_id: 1,
    ...overrides,
  };
}

describe("applyMapEvent", () => {
  it("returns state unchanged for an unrecognized event type", () => {
    const state = makeState({ systems: [system(1)] });
    const result = applyMapEvent(state, {
      event: "something.unknown",
      data: {},
    });
    expect(result).toBe(state);
  });

  describe("system.added / system.updated", () => {
    it("appends a new system", () => {
      const state = makeState({ systems: [system(1)] });
      const event: MapEvent = {
        event: "system.added",
        data: system(2, { label: "New" }),
      };

      const result = applyMapEvent(state, event);

      expect(result.systems.map((s) => s.id)).toEqual([1, 2]);
    });

    it("replaces an existing system in place by id", () => {
      const state = makeState({
        systems: [system(1, { label: "Old" }), system(2)],
      });
      const event: MapEvent = {
        event: "system.updated",
        data: system(1, { label: "Renamed" }),
      };

      const result = applyMapEvent(state, event);

      expect(result.systems).toEqual([
        system(1, { label: "Renamed" }),
        system(2),
      ]);
    });
  });

  describe("system.removed", () => {
    it("removes the system and cascades to its signatures/connections", () => {
      const state = makeState({
        systems: [system(1), system(2)],
        signatures: [signature(10), signature(11)],
        connections: [connection(20), connection(21)],
      });
      const event: MapEvent = {
        event: "system.removed",
        data: {
          id: 1,
          removed_signature_ids: [10],
          removed_connection_ids: [20],
        },
      };

      const result = applyMapEvent(state, event);

      expect(result.systems.map((s) => s.id)).toEqual([2]);
      expect(result.signatures.map((s) => s.id)).toEqual([11]);
      expect(result.connections.map((c) => c.id)).toEqual([21]);
    });

    it("tolerates missing removed_signature_ids/removed_connection_ids", () => {
      const state = makeState({
        systems: [system(1)],
        signatures: [signature(10)],
        connections: [connection(20)],
      });

      const result = applyMapEvent(state, {
        event: "system.removed",
        data: { id: 1 },
      });

      expect(result.systems).toEqual([]);
      expect(result.signatures.map((s) => s.id)).toEqual([10]);
      expect(result.connections.map((c) => c.id)).toEqual([20]);
    });
  });

  describe("signature.added / signature.updated", () => {
    it("appends a new signature", () => {
      const state = makeState({ signatures: [signature(10)] });
      const result = applyMapEvent(state, {
        event: "signature.added",
        data: signature(11),
      });
      expect(result.signatures.map((s) => s.id)).toEqual([10, 11]);
    });

    it("replaces an existing signature in place by id", () => {
      const state = makeState({
        signatures: [signature(10, { life_status: "stable" })],
      });
      const result = applyMapEvent(state, {
        event: "signature.updated",
        data: signature(10, { life_status: "lt_1h" }),
      });
      expect(result.signatures).toEqual([
        signature(10, { life_status: "lt_1h" }),
      ]);
    });
  });

  describe("signature.removed", () => {
    it("removes just the matching signature", () => {
      const state = makeState({ signatures: [signature(10), signature(11)] });
      const result = applyMapEvent(state, {
        event: "signature.removed",
        data: { id: 10 },
      });
      expect(result.signatures.map((s) => s.id)).toEqual([11]);
    });
  });

  describe("signature.bulk_upserted", () => {
    it("upserts every row and prunes signatures/connections/systems named in the payload", () => {
      const state = makeState({
        systems: [system(1), system(2)],
        signatures: [signature(10, { life_status: "stable" }), signature(11)],
        connections: [connection(20), connection(21)],
      });
      const event: MapEvent = {
        event: "signature.bulk_upserted",
        data: {
          signatures: [signature(10, { life_status: "lt_1h" }), signature(12)],
          removed_signature_ids: [11],
          removed_connection_ids: [20],
          removed_system_ids: [2],
        },
      };

      const result = applyMapEvent(state, event);

      expect(result.signatures).toEqual([
        signature(10, { life_status: "lt_1h" }),
        signature(12),
      ]);
      expect(result.connections.map((c) => c.id)).toEqual([21]);
      expect(result.systems.map((s) => s.id)).toEqual([1]);
    });

    it("tolerates every removal list being absent", () => {
      const state = makeState({
        systems: [system(1)],
        signatures: [signature(10)],
        connections: [connection(20)],
      });
      const event: MapEvent = {
        event: "signature.bulk_upserted",
        data: { signatures: [signature(11)] },
      };

      const result = applyMapEvent(state, event);

      expect(result.signatures.map((s) => s.id)).toEqual([10, 11]);
      expect(result.connections.map((c) => c.id)).toEqual([20]);
      expect(result.systems.map((s) => s.id)).toEqual([1]);
    });
  });

  describe("connection.added / connection.updated", () => {
    it("appends a new connection", () => {
      const state = makeState({ connections: [connection(20)] });
      const result = applyMapEvent(state, {
        event: "connection.added",
        data: connection(21),
      });
      expect(result.connections.map((c) => c.id)).toEqual([20, 21]);
    });

    it("replaces an existing connection in place by id", () => {
      const state = makeState({
        connections: [connection(20, { mass_status: "fresh" })],
      });
      const result = applyMapEvent(state, {
        event: "connection.updated",
        data: connection(20, { mass_status: "critical" }),
      });
      expect(result.connections).toEqual([
        connection(20, { mass_status: "critical" }),
      ]);
    });
  });

  describe("connection.removed", () => {
    it("removes just the matching connection", () => {
      const state = makeState({
        connections: [connection(20), connection(21)],
      });
      const result = applyMapEvent(state, {
        event: "connection.removed",
        data: { id: 20 },
      });
      expect(result.connections.map((c) => c.id)).toEqual([21]);
    });
  });

  describe("character.moved", () => {
    it("appends a newly-tracked character", () => {
      const state = makeState({ tracked_characters: [character(1)] });
      const result = applyMapEvent(state, {
        event: "character.moved",
        data: character(2),
      });
      expect(result.tracked_characters.map((c) => c.character_id)).toEqual([
        1, 2,
      ]);
    });

    it("upserts an existing character by character_id, not by array position", () => {
      const state = makeState({
        tracked_characters: [character(1, { last_solar_system_id: 100 })],
      });
      const result = applyMapEvent(state, {
        event: "character.moved",
        data: character(1, { last_solar_system_id: 200 }),
      });
      expect(result.tracked_characters).toEqual([
        character(1, { last_solar_system_id: 200 }),
      ]);
    });
  });

  describe("character.removed", () => {
    it("removes just the matching character by character_id", () => {
      const state = makeState({
        tracked_characters: [character(1), character(2)],
      });
      const result = applyMapEvent(state, {
        event: "character.removed",
        data: { character_id: 1 },
      });
      expect(result.tracked_characters.map((c) => c.character_id)).toEqual([2]);
    });
  });
});
