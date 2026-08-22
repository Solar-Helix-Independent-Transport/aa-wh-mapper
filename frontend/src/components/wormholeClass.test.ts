import { describe, expect, it } from "vitest";
import type { SignatureOut, WormholeTypeOut } from "../api/types";
import {
  connectionWormholeType,
  effectiveLifeStatus,
  shipSizeForJumpMass,
  wormholeClassLabel,
  wormholeTypeDatalistOptions,
  wormholeTypeSummary,
} from "./wormholeClass";

function makeWormholeType(
  overrides: Partial<WormholeTypeOut> = {},
): WormholeTypeOut {
  return {
    code: "K162",
    leads_to_class: null,
    max_mass: null,
    max_jump_mass: null,
    max_stable_time: null,
    ...overrides,
  };
}

function makeSignature(overrides: Partial<SignatureOut> = {}): SignatureOut {
  return {
    id: 1,
    map_system_id: 1,
    signature_id: "ABC-123",
    sig_type: "wormhole",
    wormhole_type: null,
    life_status: "stable",
    life_status_marked_at: null,
    is_hidden: false,
    updated_by_id: null,
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("wormholeClassLabel", () => {
  it("returns null for a null class id", () => {
    expect(wormholeClassLabel(null)).toBeNull();
  });

  it.each([
    [1, "C1"],
    [7, "High-sec"],
    [12, "Thera"],
    [14, "Sentinel"],
  ])("maps class %s to %s", (classId, expected) => {
    expect(wormholeClassLabel(classId)).toBe(expected);
  });

  it("falls back to a generic label for an unrecognized class id", () => {
    expect(wormholeClassLabel(999)).toBe("Class 999");
  });
});

describe("shipSizeForJumpMass", () => {
  it("returns null for a null mass", () => {
    expect(shipSizeForJumpMass(null)).toBeNull();
  });

  it.each([
    [5_000_000, "small"],
    [20_000_000, "medium"],
    [375_000_000, "large"],
    [375_000_001, "capital"],
  ])("maps max jump mass %s to %s", (mass, expected) => {
    expect(shipSizeForJumpMass(mass)).toBe(expected);
  });
});

describe("effectiveLifeStatus", () => {
  const now = new Date("2026-01-02T00:00:00Z").getTime();

  it("prefers the wormhole type's max_stable_time once identified", () => {
    const wormholeType = makeWormholeType({ max_stable_time: 24 * 60 });
    const referenceTime = "2026-01-01T12:00:00Z"; // 12h elapsed, 12h remaining

    expect(
      effectiveLifeStatus("stable", null, wormholeType, referenceTime, now),
    ).toBe("lt_12h");
  });

  it("falls back to the manually-picked bucket when no wormhole type is known", () => {
    // lt_4h's bucket starts its countdown from 4h; 3.5h elapsed since
    // markedAt leaves 0.5h remaining, which re-buckets down into lt_1h.
    const markedAt = "2026-01-01T20:30:00Z";

    expect(
      effectiveLifeStatus(
        "lt_4h",
        markedAt,
        undefined,
        "2026-01-01T00:00:00Z",
        now,
      ),
    ).toBe("lt_1h");
  });

  it("returns the stored life_status unchanged when neither source applies", () => {
    expect(
      effectiveLifeStatus(
        "stable",
        null,
        undefined,
        "2026-01-01T00:00:00Z",
        now,
      ),
    ).toBe("stable");
  });
});

describe("connectionWormholeType", () => {
  it("uses the top signature's wormhole type when present", () => {
    const topType = makeWormholeType({ code: "B274" });
    const signatures = [
      makeSignature({ id: 10, wormhole_type: topType }),
      makeSignature({
        id: 20,
        wormhole_type: makeWormholeType({ code: "K162" }),
      }),
    ];

    const result = connectionWormholeType(
      { top_signature_id: 10, bottom_signature_id: 20 },
      signatures,
    );

    expect(result).toBe(topType);
  });

  it("falls back to the bottom signature's wormhole type", () => {
    const bottomType = makeWormholeType({ code: "K162" });
    const signatures = [
      makeSignature({ id: 10, wormhole_type: null }),
      makeSignature({ id: 20, wormhole_type: bottomType }),
    ];

    const result = connectionWormholeType(
      { top_signature_id: 10, bottom_signature_id: 20 },
      signatures,
    );

    expect(result).toBe(bottomType);
  });

  it("returns undefined when neither end resolves to a signature", () => {
    const result = connectionWormholeType(
      { top_signature_id: null, bottom_signature_id: null },
      [],
    );

    expect(result).toBeUndefined();
  });
});

describe("wormholeTypeSummary", () => {
  it("joins every populated field with a middot separator", () => {
    const summary = wormholeTypeSummary(
      makeWormholeType({
        leads_to_class: 7,
        max_mass: 2_000_000_000,
        max_jump_mass: 375_000_000,
        max_stable_time: 16 * 60,
      }),
    );

    expect(summary).toBe(
      "→ High-sec · 2,000,000,000 kg max · 375,000,000 kg/jump · 960m lifetime",
    );
  });

  it("omits unset fields entirely rather than leaving a blank segment", () => {
    const summary = wormholeTypeSummary(
      makeWormholeType({ max_mass: 1_000_000 }),
    );

    expect(summary).toBe("1,000,000 kg max");
  });
});

describe("wormholeTypeDatalistOptions", () => {
  it("dedupes by code, keeping the last row for a repeated code", () => {
    const first = makeWormholeType({ code: "A009" });
    const second = makeWormholeType({ code: "A009", max_mass: 999 });

    const result = wormholeTypeDatalistOptions([first, second]);

    expect(result).toEqual([second]);
  });

  it("keeps distinct codes as separate options", () => {
    const a = makeWormholeType({ code: "A009" });
    const b = makeWormholeType({ code: "K162" });

    expect(wormholeTypeDatalistOptions([a, b])).toEqual([a, b]);
  });
});
