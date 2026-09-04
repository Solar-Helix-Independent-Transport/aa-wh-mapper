import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRouteSocket } from "./useRouteSocket";
import {
  FakeWebSocket,
  installFakeWebSocket,
} from "../testUtils/fakeWebSocket";
import {
  WS_RECONNECT_INITIAL_DELAY_MS,
  WS_RECONNECT_MAX_DELAY_MS,
} from "../constants";

describe("useRouteSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFakeWebSocket();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not open a socket when routeId is null", () => {
    renderHook(() => useRouteSocket(null, vi.fn()));
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("opens a socket to the route's URL", () => {
    renderHook(() => useRouteSocket(3, vi.fn()));

    expect(FakeWebSocket.instances[0].url).toBe(
      "ws://localhost:3000/ws/wh-mapper/routes/3/",
    );
  });

  it("delivers a parsed message to onEvent", () => {
    const onEvent = vi.fn();
    renderHook(() => useRouteSocket(3, onEvent));

    FakeWebSocket.instances[0].triggerMessage({
      event: "route.updated",
      data: {},
    });

    expect(onEvent).toHaveBeenCalledWith({ event: "route.updated", data: {} });
  });

  it("silently ignores a malformed message instead of throwing", () => {
    renderHook(() => useRouteSocket(3, vi.fn()));

    expect(() =>
      FakeWebSocket.instances[0].triggerRawMessage("not json"),
    ).not.toThrow();
  });

  it("reconnects with backoff after a non-terminal close", () => {
    renderHook(() => useRouteSocket(3, vi.fn()));

    FakeWebSocket.instances[0].triggerClose(1006);
    vi.advanceTimersByTime(WS_RECONNECT_INITIAL_DELAY_MS);

    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("does not reconnect after a terminal close code", () => {
    renderHook(() => useRouteSocket(3, vi.fn()));

    FakeWebSocket.instances[0].triggerClose(4401);
    vi.advanceTimersByTime(WS_RECONNECT_MAX_DELAY_MS);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("closes an already-open socket immediately on unmount", () => {
    const { unmount } = renderHook(() => useRouteSocket(3, vi.fn()));

    FakeWebSocket.instances[0].triggerOpen();
    unmount();

    expect(FakeWebSocket.instances[0].closed).toBe(true);
    FakeWebSocket.instances[0].triggerClose(1006);
    vi.advanceTimersByTime(WS_RECONNECT_MAX_DELAY_MS);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  // See useMapSocket.test.ts's matching case for why this deferral exists -
  // avoids a harmless but noisy Chrome console warning on a StrictMode dev
  // double-mount.
  it("defers closing a still-connecting socket until it opens, instead of aborting the handshake", () => {
    const { unmount } = renderHook(() => useRouteSocket(3, vi.fn()));

    unmount();
    expect(FakeWebSocket.instances[0].closed).toBe(false);

    FakeWebSocket.instances[0].triggerOpen();
    expect(FakeWebSocket.instances[0].closed).toBe(true);
  });

  it("reconnects to the new route's URL when routeId changes", () => {
    const { rerender } = renderHook(
      ({ routeId }) => useRouteSocket(routeId, vi.fn()),
      {
        initialProps: { routeId: 3 },
      },
    );
    FakeWebSocket.instances[0].triggerOpen();

    rerender({ routeId: 5 });

    expect(FakeWebSocket.instances[0].closed).toBe(true);
    expect(FakeWebSocket.instances[1].url).toBe(
      "ws://localhost:3000/ws/wh-mapper/routes/5/",
    );
  });
});
