import { proxyWorkspace, proxyWorkspaceCollection } from "@/lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request): Promise<Response> {
  return proxyWorkspaceCollection(request);
}

// here it forwards the workspace creation request to the agent .
export function POST(request: Request): Promise<Response> {
  return proxyWorkspace(request, "/workspace");
}
