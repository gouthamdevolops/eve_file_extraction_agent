"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";

type Props = { active: boolean; onFinish: () => void };

export default function CinematicIntro({ active, onFinish }: Props) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active || !root.current) return;
    const element = root.current;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const handleEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onFinish(); };
    window.addEventListener("keydown", handleEscape);
    document.documentElement.classList.add("cinematic-intro-playing");
    if (reduced) {
      const timer = window.setTimeout(onFinish, 160);
      return () => {
        window.clearTimeout(timer);
        window.removeEventListener("keydown", handleEscape);
        document.documentElement.classList.remove("cinematic-intro-playing");
      };
    }

    const context = gsap.context(() => {
      const q = gsap.utils.selector(element);
      const open = q(".intro-open-scene");
      const brand = q(".intro-brand-scene");
      const application = q(".intro-app-scene");
      const processing = q(".intro-processing-scene");
      const final = q(".intro-final-scene");
      const timeline = gsap.timeline({
        defaults: { ease: "power3.inOut" },
        onComplete: () => onFinish(),
      });

      timeline.set(open, { autoAlpha: 1 }, 0)
        .fromTo(q(".intro-aircraft-image"), { scale: 1.04, xPercent: 1.5, yPercent: 1 }, { scale: 1.15, xPercent: -1.2, yPercent: -1, duration: 3, ease: "sine.inOut" }, 0)
        .fromTo(q(".intro-open-logo"), { autoAlpha: 0, y: 24, z: -80, rotateX: 14 }, { autoAlpha: 1, y: 0, z: 0, rotateX: 0, duration: .85, ease: "power3.out" }, .5)
        .fromTo(q(".intro-open-rule"), { scaleX: 0 }, { scaleX: 1, duration: .65, ease: "power2.out" }, 1.2)
        .fromTo(q(".intro-open-caption"), { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: .65 }, 1.45)
        .fromTo(q(".intro-opening-card"), { autoAlpha: 0, x: (i) => i % 2 ? 90 : -90, y: 26, z: -100, rotateY: (i) => i % 2 ? -18 : 18, rotateZ: (i) => i % 2 ? 3 : -3 }, { autoAlpha: 1, x: 0, y: 0, z: 0, rotateY: 0, rotateZ: 0, duration: .72, stagger: .18, ease: "back.out(1.15)" }, .8)
        .to(q(".intro-opening-card"), { autoAlpha: 0, x: 55, z: -60, rotateY: -8, duration: .28, stagger: .04, ease: "power2.in" }, 2.26)
        .to(open, { autoAlpha: 0, duration: .4 }, 2.58)
        .set(brand, { autoAlpha: 1 }, 2.72)
        .fromTo(q(".intro-brand-lockup"), { autoAlpha: 0, z: -100, rotateY: -12, scale: .8 }, { autoAlpha: 1, z: 0, rotateY: 0, scale: 1, duration: .8, ease: "power3.out" }, 2.75)
        .fromTo(q(".intro-brand-word"), { yPercent: 112, rotateX: -16 }, { yPercent: 0, rotateX: 0, duration: .72, stagger: .095, ease: "power4.out" }, 3.15)
        .fromTo(q(".intro-brand-subtitle"), { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: .65 }, 4.05)
        .to(brand, { autoAlpha: 0, duration: .38 }, 4.72)
        .set(application, { autoAlpha: 1 }, 4.92)
        .fromTo(q(".intro-browser"), { autoAlpha: 0, z: -280, y: 82, rotateX: 17, rotateY: -13, scale: .72 }, { autoAlpha: 1, z: 0, y: 0, rotateX: 4, rotateY: -3, scale: 1, duration: 1.1, ease: "power3.out" }, 4.95)
        .fromTo(q(".intro-panel"), { autoAlpha: 0, z: -50, y: 24 }, { autoAlpha: 1, z: 0, y: 0, duration: .58, stagger: .15, ease: "power2.out" }, 5.8)
        .fromTo(q(".intro-document-card"), { autoAlpha: 0, z: -140, x: (i) => i % 2 ? 110 : -110, y: 45, rotateY: (i) => i % 2 ? -18 : 18, rotateZ: (i) => i % 2 ? 5 : -5 }, { autoAlpha: 1, z: 40, x: 0, y: 0, rotateY: 0, rotateZ: 0, duration: .72, stagger: .18, ease: "back.out(1.25)" }, 6.18)
        .to(q(".intro-browser"), { rotateX: 1, rotateY: 0, z: 50, scale: 1.025, duration: 1.3, ease: "power2.inOut" }, 7.4)
        .to(application, { autoAlpha: 0, duration: .38 }, 8.63)
        .set(processing, { autoAlpha: 1 }, 8.83)
        .fromTo(q(".intro-process-core"), { autoAlpha: 0, scale: .5, z: -100, rotateY: -35 }, { autoAlpha: 1, scale: 1, z: 0, rotateY: 0, duration: .65, ease: "back.out(1.45)" }, 9.02)
        .fromTo(q(".intro-flow-line"), { scaleX: 0, transformOrigin: "left center" }, { scaleX: 1, duration: .75, stagger: .13, ease: "power2.inOut" }, 9.2)
        .to(q(".intro-document-card"), { x: (i) => i % 2 ? -190 : 190, y: 24, z: 170, scale: .72, rotateY: (i) => i % 2 ? 28 : -28, autoAlpha: .3, duration: .72, stagger: .07, ease: "power3.inOut" }, 9.12)
        .fromTo(q(".intro-process-step"), { autoAlpha: 0, y: 28, z: -30, rotateX: 8 }, { autoAlpha: 1, y: 0, z: 0, rotateX: 0, duration: .55, stagger: .35, ease: "power3.out" }, 9.68)
        .fromTo(q(".intro-sample-fields .intro-field"), { autoAlpha: 0, x: -20, z: -30 }, { autoAlpha: 1, x: 0, z: 0, duration: .34, stagger: .16, ease: "power2.out" }, 10.35)
        .fromTo(q(".intro-check"), { scale: 0, rotate: -45 }, { scale: 1, rotate: 0, duration: .38, stagger: .2, ease: "back.out(1.7)" }, 12.05)
        .fromTo(q(".intro-output-card"), { autoAlpha: 0, y: 30, z: -80, rotateY: -8 }, { autoAlpha: 1, y: 0, z: 0, rotateY: 0, duration: .55, stagger: .14, ease: "power3.out" }, 12.8)
        .to(processing, { autoAlpha: 0, scale: .95, duration: .42 }, 13.88)
        .set(final, { autoAlpha: 1 }, 14.18)
        .fromTo(q(".intro-final-copy"), { autoAlpha: 0, y: 22 }, { autoAlpha: 1, y: 0, duration: .62, ease: "power3.out" }, 14.55)
        .fromTo(q(".intro-final-word"), { yPercent: 110 }, { yPercent: 0, duration: .64, stagger: .09, ease: "power4.out" }, 14.65)
        .fromTo(q(".intro-final-subtitle"), { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: .48 }, 15.35)
        .fromTo(q(".intro-final-header .intro-final-brand, .intro-final-header nav span, .intro-final-status"), { autoAlpha: 0, y: -12 }, { autoAlpha: 1, y: 0, duration: .42, stagger: .09, ease: "power2.out" }, 14.42)
        .fromTo(q(".intro-final-cta"), { autoAlpha: 0, y: 14, scale: .96 }, { autoAlpha: 1, y: 0, scale: 1, duration: .45, stagger: .12 }, 15.72)
        .to(element, { autoAlpha: 0, duration: .8, ease: "power2.inOut" }, 17.15);
    }, root);

    return () => {
      context.revert();
      window.removeEventListener("keydown", handleEscape);
      document.documentElement.classList.remove("cinematic-intro-playing");
    };
  }, [active, onFinish]);

  if (!active) return null;

  return (
    <div className="cinematic-intro" ref={root} role="dialog" aria-modal="true" aria-label="Aircraft Document Processing introduction">
      <section className="intro-scene intro-open-scene" aria-label="Aircraft opening">
        <div className="intro-aircraft-image" />
        <div className="intro-open-shade" />
        <div className="intro-open-light" />
        <div className="intro-opening-cards" aria-hidden="true">
          <article className="intro-opening-card opening-card-one"><span className="intro-opening-icon">PDF</span><span><small>DOCUMENT INTAKE</small><strong>PDFs &amp; spreadsheets</strong></span><i>↗</i></article>
          <article className="intro-opening-card opening-card-two"><span className="intro-opening-icon">02</span><span><small>USER CONTROL</small><strong>Upload, then start</strong></span><i>↗</i></article>
          <article className="intro-opening-card opening-card-three"><span className="intro-opening-icon">✓</span><span><small>RESULTS</small><strong>Source-reported data</strong></span><i>↗</i></article>
          <span className="intro-opening-connector" />
        </div>
        <div className="intro-open-brand intro-open-logo">
          <span className="intro-logo-mark" aria-hidden="true"><svg viewBox="0 0 36 36"><path d="M10 5h11l6 6v20H10zM21 5v7h6M14 18h9M14 22h9M14 26h6" /></svg></span>
          <span><strong>Aircraft Document Processing</strong><small>EVE · OPERATIONS</small></span>
        </div>
        <div className="intro-open-bottom"><span className="intro-open-rule" /><p className="intro-open-caption">AIRCRAFT OPERATIONS &nbsp;·&nbsp; DOCUMENT INTAKE</p></div>
      </section>

      <section className="intro-scene intro-brand-scene" aria-label="Application introduction">
        <div className="intro-brand-backdrop" />
        <div className="intro-brand-content">
          <div className="intro-brand-lockup"><span className="intro-logo-mark large" aria-hidden="true"><svg viewBox="0 0 36 36"><path d="M10 5h11l6 6v20H10zM21 5v7h6M14 18h9M14 22h9M14 26h6" /></svg></span><span className="intro-brand-name">EVE <i>·</i> OPERATIONS</span></div>
          <h1 className="intro-brand-title"><span className="intro-title-line"><span className="intro-brand-word">Aircraft</span><span className="intro-brand-word">Document</span></span><span className="intro-title-line"><span className="intro-brand-word">Processing</span></span></h1>
          <p className="intro-brand-subtitle">Transform aircraft operational documents into structured, validated operational intelligence.</p>
          <div className="intro-scene-caption">AIRCRAFT OPERATIONS &nbsp;·&nbsp; DOCUMENT INTAKE</div>
        </div>
      </section>

      <section className="intro-scene intro-app-scene" aria-label="Three-dimensional application interface preview">
        <div className="intro-app-glow" />
        <div className="intro-app-kicker">YOUR DOCUMENT WORKSPACE &nbsp; / &nbsp; VISUAL PREVIEW</div>
        <div className="intro-browser" aria-label="Illustrative workspace, no files selected">
          <div className="intro-browser-bar"><span className="intro-window-dots"><i /><i /><i /></span><span className="intro-address">Aircraft Document Processing</span><span className="intro-browser-brand">EVE OPERATIONS</span></div>
          <div className="intro-browser-body">
            <aside className="intro-sidebar"><div className="intro-sidebar-brand"><b>E</b> Aircraft operations</div><div className="intro-sidebar-link active"><i /> Document intake</div><div className="intro-sidebar-link"><i /> Workflow</div><div className="intro-sidebar-link"><i /> Results</div></aside>
            <div className="intro-app-main"><div className="intro-app-topline"><small>AIRCRAFT OPERATIONS / DOCUMENT INTAKE</small><span>WORKSPACE PREVIEW</span></div><h2>Upload aircraft utilization records</h2><p>Review each source document before starting the workflow.</p><div className="intro-upload-panel intro-panel"><span className="intro-upload-icon">↑</span><strong>No documents selected</strong><small>Choose files in the live application</small><div className="intro-file-choices"><span>PDF documents</span><span>Spreadsheets</span></div></div><div className="intro-app-footer"><span>Upload and processing are separate actions</span><button type="button" disabled>Start workflow</button></div></div>
          </div>
        </div>
        <div className="intro-document-card intro-card-pdf"><b>PDF</b><span><strong>Utilization report</strong><small>Aircraft source document</small></span></div>
        <div className="intro-document-card intro-card-xls"><b>XLS</b><span><strong>Engine records</strong><small>Spreadsheet source</small></span></div>
        <div className="intro-app-footnote">Illustrative interface only &nbsp;·&nbsp; No workspace data loaded</div>
      </section>

      <section className="intro-scene intro-processing-scene" aria-label="Illustrative document processing stages">
        <div className="intro-processing-heading"><p className="intro-scene-kicker">SOURCE DOCUMENTS &nbsp; → &nbsp; STRUCTURED OUTPUT</p><h2>One controlled path.<br /><span>Source-supported results.</span></h2></div>
        <div className="intro-processing-stage">
          <div className="intro-process-rail"><span className="intro-flow-line" /><span className="intro-flow-line" /><span className="intro-flow-line" /></div>
          <div className="intro-process-core"><span className="intro-core-orbit" /><span className="intro-core-icon">✳</span><small>DOCUMENT<br />WORKFLOW</small></div>
          <article className="intro-process-step step-intake"><span>01</span><strong>Document intake</strong><small>Files reviewed before upload</small></article>
          <article className="intro-process-step step-extract"><span>02</span><strong>Data extraction</strong><small>Fields reported from sources</small></article>
          <article className="intro-process-step step-validate"><span>03</span><strong>Validation</strong><small>Service-reported checks</small></article>
          <div className="intro-sample-fields"><div className="intro-field"><small>AIRCRAFT REGISTRATION</small><strong>SAMPLE · N123XX</strong></div><div className="intro-field"><small>FLIGHT HOURS</small><strong>SAMPLE · 1,248 h</strong></div><div className="intro-field"><small>ENGINE RECORDS</small><strong>SAMPLE · 2 entries</strong></div></div>
          <div className="intro-check check-one">✓</div><div className="intro-check check-two">✓</div><div className="intro-check check-three">✓</div>
          <article className="intro-output-card output-aircraft"><small>ILLUSTRATIVE SAMPLE</small><strong>Aircraft utilization</strong><span>Operational records · sample data</span></article>
          <article className="intro-output-card output-engine"><small>ILLUSTRATIVE SAMPLE</small><strong>Engine records</strong><span>Component records · sample data</span></article>
          <article className="intro-output-card output-valid"><small>SAMPLE VALIDATION</small><strong>Validation states</strong><span>Actual states come from the workflow</span></article>
        </div>
        <div className="intro-sample-disclaimer">DEMONSTRATION DATA ONLY · NOT REAL AIRCRAFT RECORDS · NO FILES WERE PROCESSED</div>
      </section>

      <section className="intro-scene intro-final-scene" aria-label="Landing page transition">
        <header className="intro-final-header"><div className="intro-final-brand"><span className="intro-logo-mark small" aria-hidden="true"><svg viewBox="0 0 36 36"><path d="M10 5h11l6 6v20H10zM21 5v7h6M14 18h9M14 22h9M14 26h6" /></svg></span><span><b>Aircraft Document Processing</b><small>EVE · OPERATIONS</small></span></div><nav><span className="active">Landing</span><span>Workflow start</span><span>Results</span></nav><span className="intro-final-status"><i /> Workspace available</span></header>
        <div className="intro-final-hero"><div className="intro-final-copy"><p className="intro-final-kicker">AIRCRAFT OPERATIONS / DOCUMENT INTAKE</p><h2><span className="intro-title-line"><span className="intro-final-word">Aircraft</span><span className="intro-final-word">document</span></span><span className="intro-title-line"><span className="intro-final-word">processing</span></span></h2><p className="intro-final-subtitle">Turn aircraft utilization documents into structured operational data. Review every file, upload deliberately, and start processing when your batch is ready.</p><div className="intro-final-actions"><span className="intro-final-cta">Select documents <b>↓</b></span><span className="intro-final-cta secondary">Explore workflow <b>↓</b></span></div></div></div>
      </section>

      <button className="intro-skip" type="button" autoFocus onClick={onFinish}>Skip intro <span aria-hidden="true">↗</span></button>
      <div className="intro-progress" aria-hidden="true"><span /></div>
    </div>
  );
}
