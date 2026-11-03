import { proxyWorkspace, safeError, validSessionId } from "@/lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ sessionId: string }> };
// here it forwards the workflow process request to the agent for specific workspace session
export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { sessionId } = await params;
  if (!validSessionId(sessionId)) return safeError("Invalid workspace session ID.", 400);
  return proxyWorkspace(request, `/workspace/${sessionId}/process`);
}
