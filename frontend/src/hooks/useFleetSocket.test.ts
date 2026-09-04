import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFleetSocket } from "./useFleetSocket";
import {
  FakeWebSocket,
  installFakeWebSocket,
} from "../testUtils/fakeWebSocket";
import {
  WS_RECONNECT_INITIAL_DELAY_MS,
  WS_RECONNECT_MAX_DELAY_MS,
} from "../constants";

describe("useFleetSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFakeWebSocket();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not open a socket when sessionId is null", () => {
    renderHook(() => useFleetSocket(null, vi.fn()));
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("opens a socket to the session's URL", () => {
    renderHook(() => useFleetSocket(7, vi.fn()));

    expect(FakeWebSocket.instances[0].url).toBe(
      "ws://localhost:3000/ws/wh-mapper/fleets/7/",
    );
  });

  it("delivers a parsed message to onEvent", () => {
    const onEvent = vi.fn();
    renderHook(() => useFleetSocket(7, onEvent));

    FakeWebSocket.instances[0].triggerMessage({
      event: "fleet.updated",
      data: {},
    });

    expect(onEvent).toHaveBeenCalledWith({ event: "fleet.updated", data: {} });
  });

  it("silently ignores a malformed message instead of throwing", () => {
    renderHook(() => useFleetSocket(7, vi.fn()));

    expect(() =>
      FakeWebSocket.instances[0].triggerRawMessage("not json"),
    ).not.toThrow();
  });

  it("reconnects with backoff after a non-terminal close", () => {
    renderHook(() => useFleetSocket(7, vi.fn()));

    FakeWebSocket.instances[0].triggerClose(1006);
    vi.advanceTimersByTime(WS_RECONNECT_INITIAL_DELAY_MS);

    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("caps the retry delay at the configured maximum", () => {
    renderHook(() => useFleetSocket(7, vi.fn()));

    let delay = WS_RECONNECT_INITIAL_DELAY_MS;
    for (let i = 0; i < 6; i++) {
      FakeWebSocket.instances[FakeWebSocket.instances.length - 1].triggerClose(
        1006,
      );
      vi.advanceTimersByTime(delay);
      delay = Math.min(delay * 2, WS_RECONNECT_MAX_DELAY_MS);
    }

    expect(FakeWebSocket.instances).toHaveLength(7);
  });

  it("does not reconnect after a terminal close code", () => {
    renderHook(() => useFleetSocket(7, vi.fn()));

    FakeWebSocket.instances[0].triggerClose(4403);
    vi.advanceTimersByTime(WS_RECONNECT_MAX_DELAY_MS);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("closes an already-open socket immediately on unmount", () => {
    const { unmount } = renderHook(() => useFleetSocket(7, vi.fn()));

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
    const { unmount } = renderHook(() => useFleetSocket(7, vi.fn()));

    unmount();
    expect(FakeWebSocket.instances[0].closed).toBe(false);

    FakeWebSocket.instances[0].triggerOpen();
    expect(FakeWebSocket.instances[0].closed).toBe(true);
  });

  it("reconnects to the new session's URL when sessionId changes", () => {
    const { rerender } = renderHook(
      ({ sessionId }) => useFleetSocket(sessionId, vi.fn()),
      { initialProps: { sessionId: 7 } },
    );
    FakeWebSocket.instances[0].triggerOpen();

    rerender({ sessionId: 9 });

    expect(FakeWebSocket.instances[0].closed).toBe(true);
    expect(FakeWebSocket.instances[1].url).toBe(
      "ws://localhost:3000/ws/wh-mapper/fleets/9/",
    );
  });
});
