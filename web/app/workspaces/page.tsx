import { Suspense } from "react";
import Link from "next/link";
import WorkspaceHistory from "@/components/workspace-history";

export default function WorkspacesPage() {
  return (
    <main className="page">
      <div className="workspace-page-layout">
        <header className="workspace-app-header">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 36 36" role="presentation"><path d="M10 5h11l6 6v20H10zM21 5v7h6M14 18h9M14 22h9M14 26h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" /></svg></span>
            <span className="brand-copy"><strong>Aircraft Document Processing</strong><span>EVE · OPERATIONS</span></span>
          </div>
          <nav className="gt-main-nav" aria-label="Main navigation"><Link className="gt-nav-link" href="/">Landing</Link><Link className="gt-nav-link" href="/#document-selection">Workflow start</Link><Link className="gt-nav-link active" href="/workspaces">Results</Link></nav>
          <div className="header-note"><span className="header-dot" /> Workspace available</div>
        </header>
        <div className="workspace-page-content">
          <Suspense fallback={<p className="workspace-history-message" role="status">Loading workspaces…</p>}>
            <WorkspaceHistory />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
