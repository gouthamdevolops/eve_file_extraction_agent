import UploadWorkspace from "@/components/upload-workspace";

export default function DashboardShell() {
  return (
    <div className="dashboard-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 36 36" role="presentation">
              <path d="M18 3.5 21.2 14l10.3 4-10.3 4L18 32.5 14.8 22 4.5 18l10.3-4L18 3.5Z" />
              <path d="M18 11v14M11 18h14" />
            </svg>
          </span>
          <span className="brand-copy"><strong>Aircraft Document Processing</strong><span>EVE WORKSPACE</span></span>
        </div>
        <div className="header-note"><span className="header-dot" /> Local workspace</div>
      </header>

      <main className="dashboard-main">
        <section className="page-intro" aria-labelledby="page-title">
          <p className="section-kicker">AIRCRAFT UTILIZATION · DOCUMENT WORKFLOW</p>
          <h1 id="page-title">A clearer path from documents to data.</h1>
          <p>Bring your utilization documents into one workspace. Review the batch, upload it, then start EVE’s extraction workflow when you’re ready.</p>
        </section>

        <UploadWorkspace />

        <section className="workflow-overview" aria-labelledby="workflow-heading">
          <div className="overview-heading">
            <div><p className="section-kicker">AT A GLANCE</p><h2 id="workflow-heading">One focused workflow</h2></div>
            <p>Uploading and processing are separate actions, so you stay in control.</p>
          </div>
          <ol className="workflow-steps">
            <li><span className="step-number">01</span><span><strong>Gather documents</strong><small>Select utilization files from your device.</small></span></li>
            <li><span className="step-number">02</span><span><strong>Review the batch</strong><small>Check names, file types, and size limits.</small></span></li>
            <li><span className="step-number">03</span><span><strong>Upload, then process</strong><small>Start the workflow after uploads are confirmed.</small></span></li>
          </ol>
        </section>

        <footer className="privacy-note"><span className="lock-mark" aria-hidden="true">▣</span> Designed for private, local use with your organization’s documents.</footer>
      </main>
    </div>
  );
}
