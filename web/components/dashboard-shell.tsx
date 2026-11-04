"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import UploadWorkspace from "@/components/upload-workspace";
import CinematicIntro from "@/components/cinematic-intro";

const INTRO_SESSION_KEY = "eve-aircraft-cinematic-intro-seen";
let introStartedForDocument = false;

export default function DashboardShell() {
  const [selectionRevealed, setSelectionRevealed] = useState(false);
  const [introActive, setIntroActive] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    let alreadySeen = false;
    try { alreadySeen = window.sessionStorage.getItem(INTRO_SESSION_KEY) === "1"; } catch { alreadySeen = false; }
    const navigationEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const isReload = navigationEntry?.type === "reload";
    if (introStartedForDocument || (alreadySeen && !isReload)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      try { window.sessionStorage.setItem(INTRO_SESSION_KEY, "1"); } catch { /* Storage may be disabled. */ }
      return;
    }
    const timer = window.setTimeout(() => {
      introStartedForDocument = true;
      try { window.sessionStorage.setItem(INTRO_SESSION_KEY, "1"); } catch { /* The intro still plays for this visit. */ }
      setIntroActive(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function finishIntro() { setIntroActive(false); }
  function replayIntro() {
    try { window.sessionStorage.setItem(INTRO_SESSION_KEY, "1"); } catch { /* Storage may be disabled. */ }
    setIntroActive(true);
  }
  function popHeroAction(action: HTMLAnchorElement) {
    action.classList.remove("is-clicking");
    void action.offsetWidth;
    action.classList.add("is-clicking");
    window.setTimeout(() => action.classList.remove("is-clicking"), 620);
  }
  function revealSelection(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    popHeroAction(event.currentTarget);
    setSelectionRevealed(true);
    window.history.replaceState(null, "", "#document-selection");
    window.setTimeout(() => document.getElementById("document-selection")?.scrollIntoView({ behavior: "smooth", block: "start" }), 140);
  }
  function revealWorkflow(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    popHeroAction(event.currentTarget);
    window.history.replaceState(null, "", "#workflow-overview");
    window.setTimeout(() => document.getElementById("workflow-overview")?.scrollIntoView({ behavior: "smooth", block: "start" }), 140);
  }
  return (
    <div className={`dashboard-shell${selectionRevealed ? " selection-revealed" : ""}`}>
      <CinematicIntro active={introActive} onFinish={finishIntro} />
      <div className="aviation-motif" aria-hidden="true">
        <svg viewBox="0 0 1000 760" fill="none" role="presentation">
          <circle cx="760" cy="235" r="92" />
          <circle cx="760" cy="235" r="168" />
          <circle cx="760" cy="235" r="246" />
          <path className="motif-flight-path" d="M85 620C270 590 300 410 488 435s226-199 374-200 134 64 92 112-113 24-91-14" />
          <circle className="motif-waypoint" cx="488" cy="435" r="5" />
          <circle className="motif-waypoint" cx="862" cy="235" r="5" />
          <path d="M760 205v60M730 235h60" />
        </svg>
      </div>
      <header className="app-header" inert={introActive}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 36 36" role="presentation">
              <path d="M10 5h11l6 6v20H10zM21 5v7h6M14 18h9M14 22h9M14 26h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </span>
          <span className="brand-copy"><strong>Aircraft Document Processing</strong><span>EVE · OPERATIONS</span></span>
        </div>
        <nav className="gt-main-nav" aria-label="Main navigation"><Link className="gt-nav-link active" href="/">Landing</Link><a className="gt-nav-link" href="#document-selection" onClick={revealSelection}>Workflow start</a><Link className="gt-nav-link" href="/workspaces">Results</Link></nav>
        <div className="header-tools"><Link className="workspace-history-sr-only" href="/workspaces">Workspace history</Link><div className="header-note"><span className="header-dot" /> Workspace available</div></div>
      </header>

      <main className="dashboard-main" inert={introActive}>
        <section className="page-intro" aria-labelledby="page-title">
          <div className="hero-copy">
            <p className="section-kicker"><span className="hero-kicker-mark" aria-hidden="true" /> AIRCRAFT OPERATIONS / DOCUMENT INTAKE</p>
            <h1 className="hero-title" id="page-title">Aircraft document processing</h1>
            <p className="hero-subtitle">Turn aircraft utilization documents into structured operational data. Review every file, upload deliberately, and start processing when your batch is ready.</p>
            <div className="hero-actions">
              <a className="hero-action" href="#document-selection" onClick={revealSelection}>Select documents <span aria-hidden="true">↓</span></a>
              <a className="hero-action hero-action-secondary" href="#workflow-overview" onClick={revealWorkflow}>Explore workflow <span aria-hidden="true">↓</span></a>
            </div>
            <button className="replay-intro-button" type="button" onClick={replayIntro}>↻ &nbsp; Replay introduction</button>
          </div>
          <aside className="hero-caption" aria-label="Application sections"><small>THREE-PAGE APPLICATION</small><strong>Landing · Workflow · Results</strong></aside>
          <div className="hero-visual" aria-hidden="true">
            <svg className="hero-flight-route" viewBox="0 0 360 280" fill="none" role="presentation">
              <path className="route-halo" d="M34 215C86 77 148 242 198 163S273 74 316 54" />
              <path className="route-line" d="M34 215C86 77 148 242 198 163S273 74 316 54" />
              <circle className="route-origin" cx="34" cy="215" r="4" />
              <circle className="route-arrival" cx="316" cy="54" r="5" />
            </svg>
            <span className="hero-destination">
              <svg viewBox="0 0 32 32"><rect x="8" y="8" width="16" height="16" rx="3" /><rect x="12" y="12" width="8" height="8" rx="1" /><path d="M12 3v5m8-5v5m-8 16v5m8-5v5M3 12h5m-5 8h5m16-8h5m-5 8h5" /></svg>
            </span>
            <span className="hero-courier">
              <span className="hero-document doc-one">
                <svg viewBox="0 0 24 28"><path d="M4 2.5h10l6 6v17H4z" /><path d="M14 2.5v6h6M8 14h8M8 18h8M8 22h5" /></svg>
              </span>
              <span className="hero-document doc-two">
                <svg viewBox="0 0 24 28"><path d="M4 2.5h10l6 6v17H4z" /><path d="M14 2.5v6h6M8 14h8M8 18h8M8 22h5" /></svg>
              </span>
              <span className="hero-plane">
                <svg viewBox="0 0 48 48"><path d="M24 3.5c-1.8 0-3 1.5-3 3.5v13L5 28.5v4l16-4.7v10.6l-5.8 4.1v2.3L24 42.7l8.8 2.1v-2.3L27 38.4V27.8l16 4.7v-4L27 20V7c0-2-1.2-3.5-3-3.5Z" /><path d="M24 10v26" stroke="#173149" strokeWidth="1.2" opacity=".45" /></svg>
              </span>
            </span>
          </div>
        </section>

        <UploadWorkspace />

        <section id="workflow-overview" className="workflow-overview" aria-labelledby="workflow-heading">
          <div className="overview-heading">
            <div><p className="section-kicker">WORKFLOW</p><h2 id="workflow-heading">A controlled path from file to result</h2></div>
            <p>Uploading and processing stay separate. You decide when the workflow starts.</p>
          </div>
          <ol className="workflow-steps">
            <li><span className="step-number">01</span><span><strong>Gather documents</strong><small>Select utilization files from your device.</small></span></li>
            <li><span className="step-number">02</span><span><strong>Review the batch</strong><small>Check names, file types, and size limits.</small></span></li>
            <li><span className="step-number">03</span><span><strong>Upload, then process</strong><small>Start the workflow after every upload is confirmed.</small></span></li>
          </ol>
        </section>

        <footer className="privacy-note"><span className="lock-mark" aria-hidden="true">▣</span> Private local workspace · Your documents stay within your organization’s workflow.</footer>
      </main>
    </div>
  );
}
