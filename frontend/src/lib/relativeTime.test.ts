import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { relativeTimeLabel } from "./relativeTime";

const NOW = new Date("2026-06-15T12:00:00Z");

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

describe("relativeTimeLabel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("says 'just now' for anything under a minute", () => {
    expect(relativeTimeLabel(ago(30 * 1000))).toBe("just now");
  });

  it("formats minutes", () => {
    expect(relativeTimeLabel(ago(5 * 60 * 1000))).toBe("5m ago");
  });

  it("formats hours", () => {
    expect(relativeTimeLabel(ago(3 * 60 * 60 * 1000))).toBe("3h ago");
  });

  it("formats days", () => {
    expect(relativeTimeLabel(ago(2 * 24 * 60 * 60 * 1000))).toBe("2d ago");
  });

  it("formats months", () => {
    expect(relativeTimeLabel(ago(60 * 24 * 60 * 60 * 1000))).toBe("2mo ago");
  });

  it("formats years", () => {
    expect(relativeTimeLabel(ago(400 * 24 * 60 * 60 * 1000))).toBe("1y ago");
  });

  it("clamps a future timestamp to 'just now' instead of going negative", () => {
    expect(
      relativeTimeLabel(new Date(NOW.getTime() + 60_000).toISOString()),
    ).toBe("just now");
  });
});
