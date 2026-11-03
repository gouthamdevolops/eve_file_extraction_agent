import { proxyWorkspace } from "@/lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// here it forwards the workspace creation request to the agent .
export function POST(request: Request): Promise<Response> {
  return proxyWorkspace(request, "/workspace");
}
