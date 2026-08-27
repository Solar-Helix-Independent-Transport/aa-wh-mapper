import { describe, expect, it } from "vitest";
import { parseProbeScanPaste } from "./parseProbeScan";

describe("parseProbeScanPaste", () => {
  it("parses a tab-separated unresolved signature (id only)", () => {
    expect(parseProbeScanPaste("ABC-123\t50%\t1,200,000 m")).toEqual([
      { signatureId: "ABC-123", sigType: undefined },
    ]);
  });

  it("parses a resolved signature and maps its group to a sig type", () => {
    expect(
      parseProbeScanPaste("abc-123\tCosmic Signature\tWormhole\t100%\t0 m"),
    ).toEqual([{ signatureId: "ABC-123", sigType: "wormhole" }]);
  });

  it.each([
    ["Combat Site", "combat"],
    ["Data Site", "data"],
    ["Relic Site", "relic"],
    ["Gas Site", "gas"],
    ["Ore Site", "ore"],
  ])("maps group %s to sig type %s", (group, expected) => {
    const [row] = parseProbeScanPaste(
      `XYZ-789\tCosmic Signature\t${group}\t100%`,
    );
    expect(row.sigType).toBe(expected);
  });

  it("splits on runs of 2+ spaces, not just tabs", () => {
    expect(
      parseProbeScanPaste("ABC-123    Cosmic Signature    Wormhole"),
    ).toEqual([{ signatureId: "ABC-123", sigType: "wormhole" }]);
  });

  it("ignores a line whose first column isn't a valid signature id", () => {
    expect(parseProbeScanPaste("Not a signature\tsomething")).toEqual([]);
  });

  it("ignores blank lines", () => {
    expect(parseProbeScanPaste("ABC-123\n\nDEF-456")).toEqual([
      { signatureId: "ABC-123", sigType: undefined },
      { signatureId: "DEF-456", sigType: undefined },
    ]);
  });

  it("returns an empty list for empty input", () => {
    expect(parseProbeScanPaste("")).toEqual([]);
  });

  it("leaves sigType undefined for an unrecognized group name", () => {
    const [row] = parseProbeScanPaste(
      "ABC-123\tCosmic Anomaly\tSome New Site Type",
    );
    expect(row.sigType).toBeUndefined();
  });

  describe("assumeWormhole (Drifter systems - nothing else spawns there)", () => {
    it("classifies an unresolved (id-only) signature as a wormhole", () => {
      expect(parseProbeScanPaste("ABC-123\t50%\t1,200,000 m", true)).toEqual([
        { signatureId: "ABC-123", sigType: "wormhole" },
      ]);
    });

    it("overrides a resolved non-wormhole group too", () => {
      const [row] = parseProbeScanPaste(
        "XYZ-789\tCosmic Signature\tCombat Site\t100%",
        true,
      );
      expect(row.sigType).toBe("wormhole");
    });
  });
});
