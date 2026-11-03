"use client";

import { useState } from "react";
import type { WorkspaceState } from "@/lib/workspace-api";

type WorkflowPreviewState = "ready" | "starting" | "queued" | "running" | "completed" | "failed" | "connection-error" | "uncertain";

const states: Array<{ id: WorkflowPreviewState; label: string }> = [
  { id: "ready", label: "Ready" },
  { id: "starting", label: "Starting" },
  { id: "queued", label: "Queued" },
  { id: "running", label: "Running" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
  { id: "connection-error", label: "Connection error" },
  { id: "uncertain", label: "Uncertain start" },
];

const content: Record<WorkflowPreviewState, { status: string; description: string }> = {
  ready: { status: "Ready to start", description: "Files are uploaded. Processing has not started." },
  starting: { status: "Starting workflow…", description: "The start request is being sent. Another start is not available while it is in flight." },
  queued: { status: "Workflow queued", description: "The backend accepted the request and queued the workflow." },
  running: { status: "Workflow running", description: "The workflow is processing this workspace." },
  completed: { status: "Workflow completed", description: "The workflow finished. Document outcomes are reported separately." },
  failed: { status: "Workflow failed", description: "The workflow could not be completed. This is a workflow failure, not a connection issue." },
  "connection-error": { status: "Unable to check status", description: "The workspace status could not be reached. The workflow outcome is not known." },
  uncertain: { status: "Start outcome uncertain", description: "Check the existing workspace before another start is allowed. No automatic retry or second run is sent." },
};

export default function WorkflowStatePreview({
  sessionId,
  status,
  error,
  connection,
  missing,
  startPending,
  uncertainStart,
}: {
  sessionId: string;
  status: WorkspaceState | null;
  error: string | null;
  connection: "connecting" | "connected" | "error";
  missing: boolean;
  startPending: boolean;
  uncertainStart: boolean;
}) {
  const [selected, setSelected] = useState<WorkflowPreviewState | null>(null);
  const liveState: WorkflowPreviewState = connection === "error" ? "connection-error"
    : missing ? "failed"
    : uncertainStart ? "uncertain"
    : startPending ? "starting"
    : status === "uploading" ? "ready"
    : status ?? "ready";
  const showingLive = selected === null;
  const displayState = selected ?? liveState;
  const current = content[displayState];
  const liveStatus = connection === "error" ? "Unable to check status"
    : missing ? "Workspace unavailable"
    : uncertainStart ? "Start outcome uncertain · checking this workspace"
    : startPending ? "Starting workflow…"
    : status === "uploading" ? "Files uploaded · workflow not started"
    : status === "queued" ? "Workflow queued"
    : status === "running" ? "Workflow running"
    : status === "completed" ? "Workflow completed"
    : status === "failed" ? "Workflow failed"
    : "Checking workspace status…";

  return (
    <section className="workflow-preview-panel" aria-labelledby="workflow-preview-title">
      <div className="workflow-preview-heading">
        <div><p className="section-kicker">WORKFLOW STATUS</p><h2 id="workflow-preview-title">Processing state</h2></div>
        <span className="preview-tag">Live + previews</span>
      </div>
      <p className="workflow-preview-copy">The live state follows the backend. Choose a preview to inspect another state without changing the workflow.</p>
      <div className="live-status-reference" role="status" aria-live="polite" aria-atomic="true">
        <span className={`live-status-dot live-${connection === "error" || missing || liveState === "failed" || liveState === "connection-error" ? "error" : liveState === "completed" ? "complete" : liveState === "running" ? "running" : "active"}`} aria-hidden="true" />
        <span className="live-status-label">Live backend status</span>
        <strong>{liveStatus}</strong>
        <code aria-label={`Workspace ID ${sessionId}`}>{sessionId}</code>
      </div>
      <div className="workflow-preview-tabs" role="group" aria-label="Live workflow status and visual previews">
        <button type="button" aria-pressed={showingLive} className={showingLive ? "active" : ""} onClick={() => setSelected(null)}>Live</button>
        {states.map((item) => {
          const isCurrentBackendState = showingLive && liveState === item.id;
          return <button key={item.id} type="button" aria-pressed={selected === item.id} aria-current={isCurrentBackendState ? "true" : undefined} className={`${selected === item.id ? "active" : ""} ${isCurrentBackendState ? "backend-current" : ""}`} onClick={() => setSelected(item.id)}>{item.label}{isCurrentBackendState && <span className="current-state-label"> · current</span>}</button>;
        })}
      </div>
      <div key={displayState} className={`workflow-preview-status preview-${displayState}`} role="status" aria-live="polite" aria-atomic="true">
        <span className="workflow-status-icon" aria-hidden="true">{displayState === "completed" ? "✓" : displayState === "failed" || displayState === "connection-error" ? "!" : displayState === "queued" ? "Ⅱ" : displayState === "running" ? "›" : "•"}</span>
        <div><strong>{current.status}</strong><p>{displayState === "failed" && showingLive ? error || "The backend did not provide a failure reason." : current.description}</p>{displayState === "running" && !showingLive && <small className="stage-label">Current stage · Asset validation (preview)</small>}</div>
      </div>
      <p className="reload-note">After reload, the workspace page rechecks the saved status; it does not start another run.</p>
      <div className="workflow-preview-actions">
        {selected === "ready" && <button className="preview-start-button" type="button" aria-disabled="true">Start workflow</button>}
        {selected === "starting" && <button className="preview-start-button" type="button" disabled><span className="button-spinner" aria-hidden="true" />Starting…</button>}
        {selected === "uncertain" && <button className="preview-secondary-button" type="button" aria-disabled="true">Check existing workspace</button>}
        {selected === "connection-error" && <button className="preview-secondary-button" type="button" aria-disabled="true">Reconnect</button>}
        {(selected === "queued" || selected === "running") && <span className="stage-label">Status is authoritative · no percentage or counter</span>}
      </div>
      <p className="preview-only-footnote">Preview only. These controls do not start, retry, or query a workflow.</p>
    </section>
  );
}
