import WorkspaceMonitor from "@/components/workspace-monitor";

export default async function WorkspacePage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <main className="page"><div className="workspace-page-content"><section className="panel"><WorkspaceMonitor sessionId={sessionId} /></section></div></main>;
}
