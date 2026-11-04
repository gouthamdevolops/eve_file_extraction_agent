const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeError(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function backendUrl(path: string): URL | null {
  const configured = process.env.EVE_API_URL;
  if (!configured) return null;
  try {
    const base = new URL(configured);
    if (base.protocol !== "http:" && base.protocol !== "https:") return null;
    return new URL(path, base);
  } catch {
    return null;
  }
}

export async function proxyWorkspaceCollection(request: Request): Promise<Response> {
  const incoming = new URL(request.url);
  const upstream = new URL("/workspace", "http://eve-backend.invalid");
  for (const key of incoming.searchParams.keys()) {
    if (key !== "year" && key !== "month") return safeError("Invalid workspace collection query.", 400);
  }
  for (const key of ["year", "month"] as const) {
    const values = incoming.searchParams.getAll(key);
    if (values.length > 1) return safeError("Invalid workspace collection query.", 400);
    if (values.length === 1) upstream.searchParams.set(key, values[0]);
  }
  return proxyWorkspace(request, `${upstream.pathname}${upstream.search}`);
}

export async function proxyWorkspace(request: Request, backendPath: string): Promise<Response> {
  const target = backendUrl(backendPath);
  if (!target) return safeError("Eve backend is not configured.", 503);

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("accept", "application/json");

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "POST" ? await request.arrayBuffer() : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
    const responseHeaders = new Headers({ "Cache-Control": "no-store" });
    const upstreamType = upstream.headers.get("content-type");
    if (upstreamType) responseHeaders.set("content-type", upstreamType);
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return safeError("Eve backend is unavailable. Check that it is running and try again.", 503);
  }
}

export function validSessionId(sessionId: string): boolean {
  return UUID_PATTERN.test(sessionId);
}

export { safeError };
