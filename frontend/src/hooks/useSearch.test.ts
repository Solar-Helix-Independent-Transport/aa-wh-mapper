import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSearch } from "./useSearch";
import { SEARCH_DEBOUNCE_MS } from "../constants";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("never calls search below the minimum query length", () => {
    const search = vi.fn();
    const { result } = renderHook(() => useSearch(search, vi.fn()));

    act(() => {
      result.current.setQuery("a");
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });

    expect(search).not.toHaveBeenCalled();
    expect(result.current.results).toEqual([]);
  });

  it("debounces and searches once the query reaches the minimum length", async () => {
    const search = vi.fn().mockResolvedValue(["a", "b"]);
    const { result } = renderHook(() => useSearch(search, vi.fn()));

    act(() => {
      result.current.setQuery("al");
    });
    expect(search).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      await Promise.resolve();
    });

    expect(search).toHaveBeenCalledWith("al");
    expect(result.current.results).toEqual(["a", "b"]);
  });

  it("trims the query before both the length check and the search call", async () => {
    const search = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useSearch(search, vi.fn()));

    act(() => {
      result.current.setQuery("  al  ");
    });

    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      await Promise.resolve();
    });

    expect(search).toHaveBeenCalledWith("al");
  });

  it("cancels an earlier keystroke's pending debounce instead of firing both", async () => {
    // Each setQuery is its own act() (a separate commit, like a real
    // keystroke event) so the effect for "al" actually mounts - and its
    // cleanup fires - before "ali" replaces it, rather than React batching
    // all three into one render that only ever sees the final value.
    const search = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useSearch(search, vi.fn()));

    act(() => {
      result.current.setQuery("al");
    });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS / 2);
    });
    act(() => {
      result.current.setQuery("ali");
    });

    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      await Promise.resolve();
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("ali");
  });

  it("drops a stale response that resolves after a newer search has started", async () => {
    const first = deferred<string[]>();
    const second = deferred<string[]>();
    const search = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useSearch(search, vi.fn()));

    act(() => {
      result.current.setQuery("al");
    });
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      await Promise.resolve();
    });

    act(() => {
      result.current.setQuery("ali");
    });
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      await Promise.resolve();
    });

    expect(search).toHaveBeenCalledTimes(2);

    // The newer ("ali") request resolves first...
    await act(async () => {
      second.resolve(["ali-result"]);
      await Promise.resolve();
    });
    expect(result.current.results).toEqual(["ali-result"]);

    // ...then the stale ("al") request resolves late and must not clobber it.
    await act(async () => {
      first.resolve(["al-result"]);
      await Promise.resolve();
    });
    expect(result.current.results).toEqual(["ali-result"]);
  });

  it("reports a rejected search via onError", async () => {
    const onError = vi.fn();
    const search = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useSearch(search, onError));

    act(() => {
      result.current.setQuery("al");
    });
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onError).toHaveBeenCalledWith("Error: boom");
  });

  it("reset clears the query and results and invalidates any in-flight request", async () => {
    const pending = deferred<string[]>();
    const search = vi.fn().mockReturnValue(pending.promise);
    const { result } = renderHook(() => useSearch(search, vi.fn()));

    act(() => {
      result.current.setQuery("al");
    });
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      await Promise.resolve();
    });

    act(() => {
      result.current.reset();
    });
    expect(result.current.query).toBe("");
    expect(result.current.results).toEqual([]);

    // The stale in-flight request resolving after reset() must not repopulate
    // results.
    await act(async () => {
      pending.resolve(["late"]);
      await Promise.resolve();
    });
    expect(result.current.results).toEqual([]);
  });
});
