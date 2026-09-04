import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMapSocket } from "./useMapSocket";
import {
  FakeWebSocket,
  installFakeWebSocket,
} from "../testUtils/fakeWebSocket";
import {
  MAP_PRESENCE_PING_INTERVAL_MS,
  WS_RECONNECT_INITIAL_DELAY_MS,
  WS_RECONNECT_MAX_DELAY_MS,
} from "../constants";

describe("useMapSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFakeWebSocket();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not open a socket when mapId is null", () => {
    renderHook(() => useMapSocket(null, vi.fn()));
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("opens a socket to the map's URL, same-origin by default", () => {
    renderHook(() => useMapSocket(42, vi.fn()));

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toBe(
      "ws://localhost:3000/ws/wh-mapper/maps/42/",
    );
  });

  it("uses the ws_origin override element when present", () => {
    // Mirrors Django's {{ ws_origin|json_script:"wh-mapper-ws-origin" }} -
    // type="application/json" keeps jsdom from trying to execute the
    // content as a script, same as a real browser.
    const el = document.createElement("script");
    el.type = "application/json";
    el.id = "wh-mapper-ws-origin";
    el.textContent = JSON.stringify("wss://example.com");
    document.body.appendChild(el);

    renderHook(() => useMapSocket(42, vi.fn()));

    expect(FakeWebSocket.instances[0].url).toBe(
      "wss://example.com/ws/wh-mapper/maps/42/",
    );
    document.body.removeChild(el);
  });

  it("falls back to same-origin when the override element has invalid JSON", () => {
    const el = document.createElement("script");
    el.type = "application/json";
    el.id = "wh-mapper-ws-origin";
    el.textContent = "not json";
    document.body.appendChild(el);

    renderHook(() => useMapSocket(42, vi.fn()));

    expect(FakeWebSocket.instances[0].url).toBe(
      "ws://localhost:3000/ws/wh-mapper/maps/42/",
    );
    document.body.removeChild(el);
  });

  it("delivers a parsed message to onEvent", () => {
    const onEvent = vi.fn();
    renderHook(() => useMapSocket(42, onEvent));

    FakeWebSocket.instances[0].triggerMessage({
      event: "system.added",
      data: { id: 1 },
    });

    expect(onEvent).toHaveBeenCalledWith({
      event: "system.added",
      data: { id: 1 },
    });
  });

  it("silently ignores a malformed message instead of throwing", () => {
    const onEvent = vi.fn();
    renderHook(() => useMapSocket(42, onEvent));

    expect(() =>
      FakeWebSocket.instances[0].triggerRawMessage("not json"),
    ).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("calls onOpen and starts pinging on open", () => {
    const onOpen = vi.fn();
    renderHook(() => useMapSocket(42, vi.fn(), onOpen));

    FakeWebSocket.instances[0].triggerOpen();
    expect(onOpen).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(MAP_PRESENCE_PING_INTERVAL_MS);
    expect(FakeWebSocket.instances[0].sent).toEqual([
      JSON.stringify({ type: "ping" }),
    ]);
  });

  it("stops pinging once the socket closes", () => {
    renderHook(() => useMapSocket(42, vi.fn()));

    FakeWebSocket.instances[0].triggerOpen();
    FakeWebSocket.instances[0].triggerClose(1006);
    vi.advanceTimersByTime(MAP_PRESENCE_PING_INTERVAL_MS * 2);

    expect(FakeWebSocket.instances[0].sent).toEqual([]);
  });

  it("reconnects with backoff after a non-terminal close", () => {
    renderHook(() => useMapSocket(42, vi.fn()));

    FakeWebSocket.instances[0].triggerClose(1006);
    expect(FakeWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(WS_RECONNECT_INITIAL_DELAY_MS);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("doubles the retry delay on each consecutive close, capped at the max", () => {
    renderHook(() => useMapSocket(42, vi.fn()));

    let delay = WS_RECONNECT_INITIAL_DELAY_MS;
    for (let i = 0; i < 6; i++) {
      FakeWebSocket.instances[FakeWebSocket.instances.length - 1].triggerClose(
        1006,
      );
      vi.advanceTimersByTime(delay);
      delay = Math.min(delay * 2, WS_RECONNECT_MAX_DELAY_MS);
    }

    // 1 initial connection + 6 reconnects.
    expect(FakeWebSocket.instances).toHaveLength(7);
  });

  it("resets the retry delay back to the initial value after a successful open", () => {
    renderHook(() => useMapSocket(42, vi.fn()));

    FakeWebSocket.instances[0].triggerClose(1006);
    vi.advanceTimersByTime(WS_RECONNECT_INITIAL_DELAY_MS);
    FakeWebSocket.instances[1].triggerOpen();
    FakeWebSocket.instances[1].triggerClose(1006);

    // If the delay had kept doubling instead of resetting on open, this
    // wouldn't be enough time for the third connection to appear yet.
    vi.advanceTimersByTime(WS_RECONNECT_INITIAL_DELAY_MS);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it("does not reconnect after a terminal close code", () => {
    renderHook(() => useMapSocket(42, vi.fn()));

    FakeWebSocket.instances[0].triggerClose(4401);
    vi.advanceTimersByTime(WS_RECONNECT_MAX_DELAY_MS);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("closes an already-open socket immediately on unmount", () => {
    const { unmount } = renderHook(() => useMapSocket(42, vi.fn()));

    FakeWebSocket.instances[0].triggerOpen();
    unmount();

    expect(FakeWebSocket.instances[0].closed).toBe(true);

    // A close event arriving after unmount (e.g. the real browser finishing
    // the close handshake) must not trigger a reconnect.
    FakeWebSocket.instances[0].triggerClose(1006);
    vi.advanceTimersByTime(WS_RECONNECT_MAX_DELAY_MS);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  // Closing a still-CONNECTING socket is valid but logs "WebSocket is closed
  // before the connection is established" to the browser console - harmless
  // noise, but it fires on every StrictMode dev double-mount (mount, clean
  // up before the handshake resolves, mount again) since that's the only
  // realistic way to unmount this fast. Deferring the close until the
  // handshake actually resolves avoids it.
  it("defers closing a still-connecting socket until it opens, instead of aborting the handshake", () => {
    const { unmount } = renderHook(() => useMapSocket(42, vi.fn()));

    unmount();
    expect(FakeWebSocket.instances[0].closed).toBe(false);

    FakeWebSocket.instances[0].triggerOpen();
    expect(FakeWebSocket.instances[0].closed).toBe(true);
  });

  it("does not run onOpen or start pinging for a socket that opens after unmount", () => {
    const onOpen = vi.fn();
    const { unmount } = renderHook(() => useMapSocket(42, vi.fn(), onOpen));

    unmount();
    FakeWebSocket.instances[0].triggerOpen();
    vi.advanceTimersByTime(MAP_PRESENCE_PING_INTERVAL_MS);

    expect(onOpen).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances[0].sent).toEqual([]);
  });

  it("reconnects to the new map's URL when mapId changes", () => {
    const { rerender } = renderHook(
      ({ mapId }) => useMapSocket(mapId, vi.fn()),
      {
        initialProps: { mapId: 42 },
      },
    );
    FakeWebSocket.instances[0].triggerOpen();

    rerender({ mapId: 99 });

    expect(FakeWebSocket.instances[0].closed).toBe(true);
    expect(FakeWebSocket.instances[1].url).toBe(
      "ws://localhost:3000/ws/wh-mapper/maps/99/",
    );
  });
});
