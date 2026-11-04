import WorkspaceMonitor from "@/components/workspace-monitor";

export default async function WorkspacePage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return (
    <main className="page">
      <div className="workspace-page-layout">
        <header className="workspace-app-header">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 36 36" role="presentation"><path d="M24 3.5c-1.8 0-3 1.5-3 3.5v13L5 28.5v4l16-4.7v10.6l-5.8 4.1v2.3L24 42.7l8.8 2.1v-2.3L27 38.4V27.8l16 4.7v-4L27 20V7c0-2-1.2-3.5-3-3.5Z" transform="scale(.75)" /></svg></span>
            <span className="brand-copy"><strong>Aircraft Document Processing</strong><span>EVE · OPERATIONS</span></span>
          </div>
          <div className="header-note"><span className="header-dot" /> Local workspace</div>
        </header>
        <div className="workspace-page-content"><section className="panel workspace-page-panel"><WorkspaceMonitor sessionId={sessionId} /></section></div>
      </div>
    </main>
  );
}
