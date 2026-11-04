import Link from "next/link";
import WorkspaceMonitor from "@/components/workspace-monitor";

export default async function WorkspacePage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return (
    <main className="page">
      <div className="workspace-page-layout">
        <header className="workspace-app-header">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 36 36" role="presentation"><path d="M10 5h11l6 6v20H10zM21 5v7h6M14 18h9M14 22h9M14 26h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" /></svg></span>
            <span className="brand-copy"><strong>Aircraft Document Processing</strong><span>EVE · OPERATIONS</span></span>
          </div>
          <nav className="gt-main-nav" aria-label="Main navigation"><Link className="gt-nav-link" href="/">Landing</Link><Link className="gt-nav-link" href="/#document-selection">Workflow start</Link><Link className="gt-nav-link active" href="/workspaces">Results</Link></nav>
          <div className="workspace-header-actions"><Link className="workspace-history-sr-only" href="/workspaces">Workspace history</Link><div className="header-note"><span className="header-dot" /> Workspace available</div></div>
        </header>
        <div className="workspace-page-content"><section className="panel workspace-page-panel"><WorkspaceMonitor sessionId={sessionId} /></section></div>
      </div>
    </main>
  );
}
