import { describe, expect, it } from "vitest";
import type { RouteLegOut, WormholeConnectionOut } from "../api/types";
import {
  routeLegColor,
  routeLegDashed,
  routeLegEdgeStyle,
  routeLegLabel,
  routeLegOrientedSignatures,
} from "./routeLegStyle";

function makeConnection(
  overrides: Partial<WormholeConnectionOut> = {},
): WormholeConnectionOut {
  return {
    id: 1,
    map_id: 1,
    connection_type: "wormhole",
    top_system_id: 10,
    bottom_system_id: 20,
    top_system_solar_system_id: 100,
    bottom_system_solar_system_id: 200,
    top_signature_id: null,
    bottom_signature_id: null,
    top_signature: null,
    bottom_signature: null,
    life_status: "stable",
    life_status_marked_at: null,
    mass_status: "unknown",
    ship_size_limit: "unknown",
    time_status: "unknown",
    created_by_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeLeg(overrides: Partial<RouteLegOut> = {}): RouteLegOut {
  return {
    connection_type: "wormhole",
    life_status: null,
    mass_status: null,
    map_id: null,
    connection_id: null,
    connection: null,
    ...overrides,
  };
}

describe("routeLegOrientedSignatures", () => {
  it("orients top->bottom as source->target when traversed from the top system", () => {
    const topSig = { signature_id: "TOP-111" } as ReturnType<
      typeof makeConnection
    >["top_signature"];
    const bottomSig = { signature_id: "BOT-222" } as ReturnType<
      typeof makeConnection
    >["bottom_signature"];
    const connection = makeConnection({
      top_system_solar_system_id: 100,
      top_signature: topSig,
      bottom_signature: bottomSig,
    });
    const leg = makeLeg({ connection });

    expect(routeLegOrientedSignatures(leg, 100)).toEqual({
      source: topSig,
      target: bottomSig,
    });
  });

  it("orients bottom->top as source->target when traversed from the bottom system", () => {
    const topSig = { signature_id: "TOP-111" } as ReturnType<
      typeof makeConnection
    >["top_signature"];
    const bottomSig = { signature_id: "BOT-222" } as ReturnType<
      typeof makeConnection
    >["bottom_signature"];
    const connection = makeConnection({
      top_system_solar_system_id: 100,
      bottom_system_solar_system_id: 200,
      top_signature: topSig,
      bottom_signature: bottomSig,
    });
    const leg = makeLeg({ connection });

    expect(routeLegOrientedSignatures(leg, 200)).toEqual({
      source: bottomSig,
      target: topSig,
    });
  });

  it("returns nulls for a leg with no connection (e.g. a stargate leg)", () => {
    expect(routeLegOrientedSignatures(makeLeg(), 100)).toEqual({
      source: null,
      target: null,
    });
  });
});

describe("routeLegColor", () => {
  it("uses the fixed stargate color regardless of time_status", () => {
    const leg = makeLeg({
      connection_type: "stargate",
      connection: makeConnection({
        connection_type: "stargate",
        time_status: "red",
      }),
    });
    expect(routeLegColor(leg)).toBe("#ffffff");
  });

  it("uses the fixed ansiblex color regardless of time_status", () => {
    const leg = makeLeg({ connection_type: "ansiblex" });
    expect(routeLegColor(leg)).toBe("var(--text-dim)");
  });

  it("uses the connection's own time_status color for a wormhole leg", () => {
    const leg = makeLeg({
      connection_type: "wormhole",
      connection: makeConnection({ time_status: "green" }),
    });
    expect(routeLegColor(leg)).toBe("#4ade80");
  });

  it("falls back to the unknown time-status color with no connection", () => {
    const leg = makeLeg({ connection_type: "wormhole", connection: null });
    expect(routeLegColor(leg)).toBe("#7ea6c9");
  });
});

describe("routeLegDashed", () => {
  it("is always dashed for an ansiblex leg", () => {
    expect(routeLegDashed(makeLeg({ connection_type: "ansiblex" }))).toBe(true);
  });

  it("is dashed for a critical-mass wormhole leg", () => {
    expect(
      routeLegDashed(
        makeLeg({ connection_type: "wormhole", mass_status: "critical" }),
      ),
    ).toBe(true);
  });

  it("is not dashed for a stable wormhole leg", () => {
    expect(
      routeLegDashed(
        makeLeg({ connection_type: "wormhole", mass_status: "fresh" }),
      ),
    ).toBe(false);
  });

  it("is not dashed for a plain stargate leg", () => {
    expect(routeLegDashed(makeLeg({ connection_type: "stargate" }))).toBe(
      false,
    );
  });
});

describe("routeLegEdgeStyle", () => {
  it("uses the fixed style object for a stargate leg", () => {
    expect(routeLegEdgeStyle(makeLeg({ connection_type: "stargate" }))).toEqual(
      {
        stroke: "#ffffff",
        strokeWidth: 2,
      },
    );
  });

  it("dashes a critical-mass wormhole leg's stroke", () => {
    const style = routeLegEdgeStyle(
      makeLeg({
        connection_type: "wormhole",
        mass_status: "critical",
        connection: makeConnection({
          mass_status: "critical",
          time_status: "red",
        }),
      }),
    );
    expect(style.strokeDasharray).toBe("6 4");
    expect(style.stroke).toBe("#ff5c7a");
  });

  it("leaves a non-critical wormhole leg's stroke undashed", () => {
    const style = routeLegEdgeStyle(
      makeLeg({ connection_type: "wormhole", mass_status: "fresh" }),
    );
    expect(style.strokeDasharray).toBeUndefined();
  });
});

describe("routeLegLabel", () => {
  it("labels a wormhole leg by its ship size limit", () => {
    const leg = makeLeg({
      connection_type: "wormhole",
      connection: makeConnection({ ship_size_limit: "large" }),
    });
    expect(routeLegLabel(leg)).toBe("L");
  });

  it("falls back to the connection type when there's no connection", () => {
    expect(routeLegLabel(makeLeg({ connection_type: "stargate" }))).toBe(
      "stargate",
    );
  });
});
