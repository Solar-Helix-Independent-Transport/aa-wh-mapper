import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./useNow";

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the current time on first render", () => {
    const { result } = renderHook(() => useNow(1000));
    expect(result.current).toBe(new Date("2026-01-01T00:00:00Z").getTime());
  });

  it("re-reads the time every intervalMs", () => {
    const { result } = renderHook(() => useNow(1000));

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current).toBe(new Date("2026-01-01T00:00:01Z").getTime());
  });

  it("clears the interval on unmount", () => {
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = renderHook(() => useNow(1000));

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});
