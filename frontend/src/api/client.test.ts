import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./client";

function mockFetchResponse(options: {
  status?: number;
  contentType?: string | null;
  body?: unknown;
}) {
  const { status = 200, contentType = "application/json", body = {} } = options;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? contentType : null,
    },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === "string" ? body : String(body)),
  } as unknown as Response;
}

function clearAllCookies() {
  // Assigning "" is a no-op in jsdom (as in real browsers) - each cookie
  // must be individually expired to actually remove it from the jar, or it
  // leaks into later tests in this file (jsdom keeps one cookie jar per
  // document, shared across every test here).
  for (const cookie of document.cookie.split("; ")) {
    const name = cookie.split("=")[0];
    if (name) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  }
}

describe("api client", () => {
  beforeEach(() => {
    clearAllCookies();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the map API path under the wh-mapper prefix", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockFetchResponse({ body: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await api.get("/maps/");

    expect(fetchMock).toHaveBeenCalledWith(
      "/wh-mapper/api/maps/",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("does not attach a CSRF token to a GET request", async () => {
    document.cookie = "csrftoken=abc123";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockFetchResponse({ body: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await api.get("/maps/");

    const [, options] = fetchMock.mock.calls[0];
    const headers = options.headers as Headers;
    expect(headers.get("X-CSRFToken")).toBeNull();
  });

  it("attaches the CSRF token from cookies on a mutating request", async () => {
    document.cookie = "csrftoken=abc123";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockFetchResponse({ body: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await api.post("/maps/", { name: "My Map" });

    const [, options] = fetchMock.mock.calls[0];
    const headers = options.headers as Headers;
    expect(headers.get("X-CSRFToken")).toBe("abc123");
  });

  it("omits the CSRF header entirely when no csrftoken cookie is set", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockFetchResponse({ body: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await api.post("/maps/", { name: "My Map" });

    const [, options] = fetchMock.mock.calls[0];
    const headers = options.headers as Headers;
    expect(headers.has("X-CSRFToken")).toBe(false);
  });

  it("sets Content-Type only when a body is present", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockFetchResponse({ body: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await api.delete("/maps/1/");

    const [, options] = fetchMock.mock.calls[0];
    const headers = options.headers as Headers;
    expect(headers.has("Content-Type")).toBe(false);
  });

  it("serializes the body as JSON with a Content-Type header for POST", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockFetchResponse({ body: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await api.post("/maps/", { name: "My Map" });

    const [, options] = fetchMock.mock.calls[0];
    const headers = options.headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(options.body).toBe(JSON.stringify({ name: "My Map" }));
  });

  it("sends no body for a bodyless POST", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockFetchResponse({ body: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await api.post("/maps/1/track/");

    const [, options] = fetchMock.mock.calls[0];
    expect(options.body).toBeUndefined();
  });

  it("returns undefined for a 204 No Content response without parsing a body", async () => {
    const jsonSpy = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      status: 204,
      ok: true,
      headers: { get: () => "application/json" },
      json: jsonSpy,
      text: vi.fn(),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.delete("/maps/1/");

    expect(result).toBeUndefined();
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it("parses a JSON response body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        mockFetchResponse({ body: { id: 1, name: "My Map" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.get("/maps/1/");

    expect(result).toEqual({ id: 1, name: "My Map" });
  });

  it("parses a non-JSON response body as plain text", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        mockFetchResponse({ contentType: "text/plain", body: "pong" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.get("/status/");

    expect(result).toBe("pong");
  });

  it("throws an ApiError with the response's status and text body on failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockFetchResponse({
        status: 404,
        contentType: "text/plain",
        body: "Map not found",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.get("/maps/999/")).rejects.toMatchObject({
      status: 404,
      message: "Map not found",
    });
  });

  it("stringifies a JSON error body into the ApiError message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        mockFetchResponse({ status: 400, body: { detail: "Invalid name" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.get("/maps/")).rejects.toMatchObject({
      status: 400,
      message: JSON.stringify({ detail: "Invalid name" }),
    });
  });

  it("ApiError instances are real Errors with a status property", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockFetchResponse({
        status: 403,
        contentType: "text/plain",
        body: "Forbidden",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await api.get("/maps/1/");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toBeInstanceOf(Error);
      expect((err as ApiError).status).toBe(403);
    }
  });

  it("sends credentials same-origin on every request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockFetchResponse({ body: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await api.get("/maps/");

    const [, options] = fetchMock.mock.calls[0];
    expect(options.credentials).toBe("same-origin");
  });
});
