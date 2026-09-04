import { vi } from "vitest";

interface OpenListener {
  fn: () => void;
  once?: boolean;
}

/** Minimal stand-in for the browser WebSocket API, shared by
 * useMapSocket/useFleetSocket/useRouteSocket's tests - each hook only ever
 * touches `readyState`/`onopen`/`onmessage`/`onclose`/`send`/`close`/
 * `addEventListener("open", ...)`, so this is all that's needed to drive
 * their reconnect/ping/graceful-close logic deterministically. */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  // Mirrors the real WebSocket readyState values - closeSocketGracefully
  // (see useMapSocket.ts) branches on this to decide whether to close
  // immediately or wait for the handshake to resolve first.
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  url: string;
  readyState: number = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  sent: string[] = [];
  closed = false;
  private openListeners: OpenListener[] = [];

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.readyState = FakeWebSocket.CLOSED;
  }

  // Only "open" is needed - closeSocketGracefully is the only caller.
  addEventListener(
    type: "open",
    listener: () => void,
    options?: { once?: boolean },
  ) {
    if (type !== "open") {
      return;
    }
    this.openListeners.push({ fn: listener, once: options?.once });
  }

  removeEventListener(type: "open", listener: () => void) {
    if (type !== "open") {
      return;
    }
    this.openListeners = this.openListeners.filter((l) => l.fn !== listener);
  }

  triggerOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
    // Snapshot before iterating - a once listener firing may synchronously
    // close() (which real close() implementations don't further mutate
    // listeners for, but removing while iterating the live array would skip
    // entries either way).
    const listeners = [...this.openListeners];
    for (const listener of listeners) {
      listener.fn();
      if (listener.once) {
        this.removeEventListener("open", listener.fn);
      }
    }
  }

  triggerMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  triggerRawMessage(data: string) {
    this.onmessage?.({ data });
  }

  triggerClose(code: number) {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code });
  }
}

/** Installs FakeWebSocket as the global WebSocket and resets its instance
 * list - call from a beforeEach. */
export function installFakeWebSocket() {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
}
