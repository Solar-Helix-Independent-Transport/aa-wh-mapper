import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSocket } from "./useSocket";
import {
  FakeWebSocket,
  installFakeWebSocket,
} from "../testUtils/fakeWebSocket";
import {
  WS_RECONNECT_INITIAL_DELAY_MS,
  WS_RECONNECT_MAX_DELAY_MS,
} from "../constants";

// Generic tests for the connect/backoff/reconnect/ping state machine shared
// by useMapSocket/useFleetSocket/useRouteSocket - each of those hooks' own
// test files cover their specific URL path and ping-or-not behavior; this
// file covers the machinery those three are thin wrappers around.
describe("useSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFakeWebSocket();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not open a socket when id is null", () => {
    renderHook(() =>
      useSocket(null, (id) => `/x/${id}/`, { onEvent: vi.fn() }),
    );
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("connects to buildPath(id) under the same-origin ws URL", () => {
    renderHook(() => useSocket(5, (id) => `/x/${id}/`, { onEvent: vi.fn() }));

    expect(FakeWebSocket.instances[0].url).toBe("ws://localhost:3000/x/5/");
  });

  it("delivers a parsed message to onEvent", () => {
    const onEvent = vi.fn();
    renderHook(() => useSocket(5, (id) => `/x/${id}/`, { onEvent }));

    FakeWebSocket.instances[0].triggerMessage({ event: "thing", data: 1 });

    expect(onEvent).toHaveBeenCalledWith({ event: "thing", data: 1 });
  });

  it("calls onOpen when provided", () => {
    const onOpen = vi.fn();
    renderHook(() =>
      useSocket(5, (id) => `/x/${id}/`, { onEvent: vi.fn(), onOpen }),
    );

    FakeWebSocket.instances[0].triggerOpen();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("sends the configured ping message on an interval once open", () => {
    renderHook(() =>
      useSocket(5, (id) => `/x/${id}/`, {
        onEvent: vi.fn(),
        ping: { message: { type: "ping" }, intervalMs: 1000 },
      }),
    );

    FakeWebSocket.instances[0].triggerOpen();
    vi.advanceTimersByTime(1000);

    expect(FakeWebSocket.instances[0].sent).toEqual([
      JSON.stringify({ type: "ping" }),
    ]);
  });

  it("never sends anything when no ping option is given", () => {
    renderHook(() => useSocket(5, (id) => `/x/${id}/`, { onEvent: vi.fn() }));

    FakeWebSocket.instances[0].triggerOpen();
    vi.advanceTimersByTime(60_000);

    expect(FakeWebSocket.instances[0].sent).toEqual([]);
  });

  it("stops pinging once the socket closes", () => {
    renderHook(() =>
      useSocket(5, (id) => `/x/${id}/`, {
        onEvent: vi.fn(),
        ping: { message: { type: "ping" }, intervalMs: 1000 },
      }),
    );

    FakeWebSocket.instances[0].triggerOpen();
    FakeWebSocket.instances[0].triggerClose(1006);
    vi.advanceTimersByTime(2000);

    expect(FakeWebSocket.instances[0].sent).toEqual([]);
  });

  it("reconnects with backoff after a non-terminal close", () => {
    renderHook(() => useSocket(5, (id) => `/x/${id}/`, { onEvent: vi.fn() }));

    FakeWebSocket.instances[0].triggerClose(1006);
    expect(FakeWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(WS_RECONNECT_INITIAL_DELAY_MS);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("does not reconnect after a terminal close code", () => {
    renderHook(() => useSocket(5, (id) => `/x/${id}/`, { onEvent: vi.fn() }));

    FakeWebSocket.instances[0].triggerClose(4401);
    vi.advanceTimersByTime(WS_RECONNECT_MAX_DELAY_MS);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("closes an already-open socket immediately on unmount", () => {
    const { unmount } = renderHook(() =>
      useSocket(5, (id) => `/x/${id}/`, { onEvent: vi.fn() }),
    );

    FakeWebSocket.instances[0].triggerOpen();
    unmount();

    expect(FakeWebSocket.instances[0].closed).toBe(true);
  });

  it("defers closing a still-connecting socket until it opens", () => {
    const { unmount } = renderHook(() =>
      useSocket(5, (id) => `/x/${id}/`, { onEvent: vi.fn() }),
    );

    unmount();
    expect(FakeWebSocket.instances[0].closed).toBe(false);

    FakeWebSocket.instances[0].triggerOpen();
    expect(FakeWebSocket.instances[0].closed).toBe(true);
  });

  it("reconnects to the new id's path when id changes", () => {
    const { rerender } = renderHook(
      ({ id }) => useSocket(id, (i) => `/x/${i}/`, { onEvent: vi.fn() }),
      { initialProps: { id: 5 } },
    );
    FakeWebSocket.instances[0].triggerOpen();

    rerender({ id: 9 });

    expect(FakeWebSocket.instances[0].closed).toBe(true);
    expect(FakeWebSocket.instances[1].url).toBe("ws://localhost:3000/x/9/");
  });

  it("does not reconnect merely because buildPath/onEvent/onOpen/ping are new references on every render", () => {
    // Regression test for the whole point of pulling this state machine out
    // of useMapSocket/useFleetSocket/useRouteSocket: each of those calls
    // useSocket with brand-new inline functions/objects on every render, so
    // if those were effect dependencies instead of refs, every render would
    // force a reconnect.
    let renders = 0;
    const { rerender } = renderHook(() => {
      renders += 1;
      return useSocket(5, (id) => `/x/${id}/`, {
        onEvent: vi.fn(),
        onOpen: vi.fn(),
        ping: { message: { type: "ping" }, intervalMs: 1000 },
      });
    });

    expect(FakeWebSocket.instances).toHaveLength(1);

    rerender();
    rerender();

    expect(renders).toBe(3);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].closed).toBe(false);
  });

  it("uses the latest onEvent after a render passes a new function", () => {
    const firstOnEvent = vi.fn();
    const secondOnEvent = vi.fn();
    const { rerender } = renderHook(
      ({ onEvent }) => useSocket(5, (id) => `/x/${id}/`, { onEvent }),
      { initialProps: { onEvent: firstOnEvent } },
    );

    rerender({ onEvent: secondOnEvent });
    FakeWebSocket.instances[0].triggerMessage({ event: "thing", data: 1 });

    expect(firstOnEvent).not.toHaveBeenCalled();
    expect(secondOnEvent).toHaveBeenCalledWith({ event: "thing", data: 1 });
  });
});
