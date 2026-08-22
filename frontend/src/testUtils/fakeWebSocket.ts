import { vi } from "vitest";

/** Minimal stand-in for the browser WebSocket API, shared by
 * useMapSocket/useFleetSocket/useRouteSocket's tests - each hook only ever
 * touches `onopen`/`onmessage`/`onclose`/`send`/`close`, so this is all
 * that's needed to drive their reconnect/ping logic deterministically. */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
  }

  triggerOpen() {
    this.onopen?.();
  }

  triggerMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  triggerRawMessage(data: string) {
    this.onmessage?.({ data });
  }

  triggerClose(code: number) {
    this.onclose?.({ code });
  }
}

/** Installs FakeWebSocket as the global WebSocket and resets its instance
 * list - call from a beforeEach. */
export function installFakeWebSocket() {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
}
