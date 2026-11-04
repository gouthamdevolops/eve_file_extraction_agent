import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/extraction/workspace/route";
import { WorkspaceApiError, workspaceApi } from "@/lib/workspace-api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubJsonFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
    void args;
    return jsonResponse(status, body);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("workspace collection proxy", () => {
  it.each([
    ["?year=2026&month=8", [["year", "2026"], ["month", "8"]]],
    ["?year=2026", [["year", "2026"]]],
    ["?month=8", [["month", "8"]]],
    ["", []],
  ])("forwards only the allowed filters for %s to the fixed backend route", async (query, expectedEntries) => {
    vi.stubEnv("EVE_API_URL", "http://127.0.0.1:2000/private/base?ignored=1");
    const fetchMock = stubJsonFetch(200, { total: 0, workspaces: [] });

    const response = await GET(new Request(`https://web.example/api/extraction/workspace${query}`));
    const upstream = new URL(String(fetchMock.mock.calls[0][0]));
    expect(response.status).toBe(200);
    expect(upstream.origin).toBe("http://127.0.0.1:2000");
    expect(upstream.pathname).toBe("/workspace");
    expect([...upstream.searchParams.entries()]).toEqual(expectedEntries);
    expect(upstream.searchParams.has("ignored")).toBe(false);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "GET", cache: "no-store" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it.each([
    "?year=2026&year=2025",
    "?month=8&month=9",
    "?year=2026&debug=true",
    "?unsupported=value",
  ])("rejects duplicate or unsupported query parameters before proxying: %s", async (query) => {
    vi.stubEnv("EVE_API_URL", "http://127.0.0.1:2000");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request(`https://web.example/api/extraction/workspace${query}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid workspace collection query." });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([400, 500])("preserves backend HTTP %i errors and disables caching", async (status) => {
    vi.stubEnv("EVE_API_URL", "http://127.0.0.1:2000");
    stubJsonFetch(status, { error: "Backend request rejected." });

    const response = await GET(new Request("https://web.example/api/extraction/workspace?year=2026&month=8"));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: "Backend request rejected." });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns safe 503 responses when configuration is missing or Eve is unavailable", async () => {
    vi.stubEnv("EVE_API_URL", "");
    const unconfigured = await GET(new Request("https://web.example/api/extraction/workspace"));
    expect(unconfigured.status).toBe(503);
    expect(await unconfigured.json()).toEqual({ error: "Eve backend is not configured." });

    vi.stubEnv("EVE_API_URL", "http://127.0.0.1:2000");
    vi.stubGlobal("fetch", vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      throw new TypeError("private backend address");
    }));
    const unavailable = await GET(new Request("https://web.example/api/extraction/workspace"));
    expect(unavailable.status).toBe(503);
    const unavailableBody = await unavailable.json();
    expect(unavailableBody).toEqual({ error: "Eve backend is unavailable. Check that it is running and try again." });
    expect(JSON.stringify(unavailableBody).includes("private backend address")).toBe(false);
  });

  it("keeps collection creation POST behavior unchanged", async () => {
    vi.stubEnv("EVE_API_URL", "http://127.0.0.1:2000");
    const body = JSON.stringify({ reportingPeriod: "August 2026" });
    const fetchMock = stubJsonFetch(201, { sessionId: "synthetic", status: "uploading" });

    const response = await POST(new Request("https://web.example/api/extraction/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }));
    const [target, init] = fetchMock.mock.calls[0];
    expect(String(target)).toBe("http://127.0.0.1:2000/workspace");
    expect(init?.method).toBe("POST");
    expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe(body);
    expect(response.status).toBe(201);
  });
});

describe("workspaceApi.list", () => {
  it("encodes separate filters, sends no-store GET, and forwards AbortSignal", async () => {
    const controller = new AbortController();
    const fetchMock = stubJsonFetch(200, { total: 0, workspaces: [] });

    await expect(workspaceApi.list({ year: 2026, month: 8 }, controller.signal)).resolves.toEqual({ total: 0, workspaces: [] });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/extraction/workspace?year=2026&month=8");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "GET", cache: "no-store", signal: controller.signal });
  });

  it("exposes backend validation failures as WorkspaceApiError with the HTTP status", async () => {
    stubJsonFetch(400, { error: "Invalid workspace collection query." });

    let thrown: unknown;
    try {
      await workspaceApi.list({ year: 2026, month: 8 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(WorkspaceApiError);
    expect(thrown).toMatchObject({ status: 400, message: "Invalid workspace collection query." });
  });
});
