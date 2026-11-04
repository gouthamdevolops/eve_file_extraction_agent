"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { workspaceApi, WorkspaceApiError, type WorkspaceStatus } from "@/lib/workspace-api";
import WorkflowStatePreview from "@/components/workflow-state-preview";
import AircraftResults from "@/components/aircraft-results";
import { buildAircraftViews } from "@/lib/aircraft-view";
import { rememberRecentWorkspace } from "@/lib/recent-workspace";
import { sanitizeText } from "@/lib/sanitize";

const POLL_INTERVAL_MS = 2500;
const START_TIMEOUT_MS = 15000;
type ConnectionState = "connecting" | "connected" | "error";

function extractionOutcomes(result: unknown): Array<Record<string, unknown>> {
  if (!result || typeof result !== "object" || !("extractionResults" in result)) return [];
  const outcomes = (result as { extractionResults?: unknown }).extractionResults;
  return Array.isArray(outcomes) ? outcomes.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item)) : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readableLabel(value: string): string {
  const labels: Record<string, string> = {
    total_month_cycles: "Total monthly cycles",
    total_month_hours: "Total monthly hours",
    total_new_cycles: "Total new cycles",
    total_new_time: "Total new time",
    aircraft_type: "Aircraft type",
  };
  return labels[value] ?? value.replace(/[_-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function WorkspaceMonitor({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<WorkspaceStatus | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [startPending, setStartPending] = useState(false);
  const [fileActionPending, setFileActionPending] = useState(false);
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const additionalFilesInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const mounted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef<AbortController | null>(null);
  const startInFlight = useRef(false);
  const pollRef = useRef<() => void>(() => {});

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const fetchStatus = useCallback(async (): Promise<WorkspaceStatus> => {
    const controller = new AbortController();
    request.current = controller;
    try {
      const status = await workspaceApi.status(sessionId, controller.signal);
      rememberRecentWorkspace({ sessionId, status: status.status });
      if (mounted.current) {
        setWorkspace(status);
        setConnection("connected");
        setMissing(false);
        setMessage(null);
      }
      return status;
    } catch (cause) {
      if (cause instanceof WorkspaceApiError && (cause.status === 400 || cause.status === 404)) {
        if (mounted.current) { setMissing(true); setConnection("connected"); setMessage(cause.message); }
      } else if (mounted.current && !(cause instanceof DOMException && cause.name === "AbortError")) {
        setConnection("error");
        setMessage("Could not reach the workspace. Check your connection and reconnect.");
      }
      throw cause;
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, [sessionId]);

  const poll = useCallback(async () => {
    clearTimer();
    try {
      const current = await fetchStatus();
      if (mounted.current && (current.status === "queued" || current.status === "running")) {
        timer.current = setTimeout(() => { void pollRef.current(); }, POLL_INTERVAL_MS);
      }
    } catch {
      // Pause on connection errors; the user can reconnect without starting another run.
    }
  }, [clearTimer, fetchStatus]);

  const reconnect = useCallback(async () => {
    clearTimer();
    setConnection("connecting");
    try {
      const current = await fetchStatus();
      if (current.status === "queued" || current.status === "running") {
        timer.current = setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
      }
    } catch {
      // fetchStatus has updated the connection/error message.
    }
  }, [clearTimer, fetchStatus, poll]);

  useEffect(() => {
    mounted.current = true;
    pollRef.current = () => { void poll(); };
    void (async () => {
      try {
        const current = await fetchStatus();
        if (current.status === "queued" || current.status === "running") {
          timer.current = setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
        }
      } catch {
        // Initial load shows a distinct reconnect state for transient errors.
      }
    })();
    return () => {
      mounted.current = false;
      clearTimer();
      request.current?.abort();
      request.current = null;
    };
  }, [clearTimer, fetchStatus, poll]);

  async function startWorkflow() {
    if (startInFlight.current || startPending || workspace?.status !== "uploading" || workspace.fileCount < 1) return;
    startInFlight.current = true;
    setStartPending(true);
    setMessage(null);
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), START_TIMEOUT_MS);
    try {
      const accepted = await workspaceApi.start(sessionId, controller.signal);
      if (mounted.current) {
        setWorkspace((current) => current ? { ...current, status: accepted.status } : current);
        setConnection("connected");
      }
      void poll();
    } catch (cause) {
      // A timeout, network error, or 409 can be ambiguous. Reconcile with the existing workspace;
      // never automatically issue another process request or create a replacement workspace.
      try {
        const current = await fetchStatus();
        if (current.status === "queued" || current.status === "running") {
          void poll();
        } else if (current.status === "uploading") {
          setMessage(cause instanceof WorkspaceApiError && cause.status === 409
            ? "The backend did not start processing. The workspace is still uploading; you may explicitly try Start workflow again."
            : "The start request could not be confirmed. The workspace is still uploading; you may explicitly try Start workflow again.");
        }
      } catch {
        // Keep connection error distinct; reconnect reads the workspace before another start is possible.
      }
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) request.current = null;
      startInFlight.current = false;
      if (mounted.current) setStartPending(false);
    }
  }

  async function addWorkspaceFiles(fileList: FileList | null) {
    if (!fileList?.length || fileActionPending || status !== "uploading") return;
    setFileActionPending(true);
    setFileActionError(null);
    try {
      for (const file of Array.from(fileList)) await workspaceApi.upload(sessionId, file);
      await fetchStatus();
    } catch (cause) {
      setFileActionError(cause instanceof Error ? cause.message : "Could not add files to this workspace.");
      await fetchStatus().catch(() => undefined);
    } finally {
      setFileActionPending(false);
      if (additionalFilesInput.current) additionalFilesInput.current.value = "";
    }
  }

  async function removeWorkspaceFile(filename: string) {
    if (fileActionPending || status !== "uploading") return;
    setFileActionPending(true);
    setFileActionError(null);
    try {
      await workspaceApi.removeUpload(sessionId, filename);
      await fetchStatus();
    } catch (cause) {
      setFileActionError(cause instanceof Error ? cause.message : "Could not remove this file.");
    } finally {
      setFileActionPending(false);
    }
  }

  function newBatch() {
    clearTimer();
    request.current?.abort();
    router.push("/");
  }

  const status = workspace?.status;
  const safeWorkflowError = workspace?.error ? sanitizeText(workspace.error) : null;
  const outcomes = extractionOutcomes(workspace?.result);
  const otherOutcomes = outcomes.filter((item) => item.status !== "completed");
  const completedCount = outcomes.filter((item) => item.status === "completed").length;
  const skippedCount = outcomes.filter((item) => item.status === "skipped").length;
  const failedCount = outcomes.filter((item) => item.status === "failed").length;
  const componentValidations = outcomes.flatMap((item) => Array.isArray(item.componentValidation)
    ? item.componentValidation.map(asRecord).filter((entry): entry is Record<string, unknown> => entry !== null)
    : []);
  const validatedComponentCount = componentValidations.filter((entry) => entry.status === "validated").length;
  const excludedComponentCount = componentValidations.filter((entry) => entry.status === "excluded").length;
  const resultRoot = asRecord(workspace?.result);
  const classification = asRecord(resultRoot?.classification);
  const reportingPeriodResult = asRecord(classification?.reportingPeriod);
  const reportingPeriod = typeof reportingPeriodResult?.value === "string" ? sanitizeText(reportingPeriodResult.value) : "Not confirmed";
  const extractedDataCount = outcomes.filter((item) => item.status === "completed" && item.data !== null && item.data !== undefined).length;
  const aircraft = status === "completed" ? buildAircraftViews(workspace?.result) : [];
  const statusText = status === "queued" ? "Workflow queued"
    : status === "running" ? "Workflow running"
    : status === "completed" ? "Workflow finished"
    : status === "failed" ? "Workflow failed"
    : status === "uploading" ? "Files uploaded — workflow not started"
    : "Checking workspace status…";

  return (
    <>
      <div className="workspace-page-heading">
        <div><p className="eyebrow">EVE · DOCUMENT PROCESSING</p><h1>Workspace</h1></div>
        {(status === "completed" || status === "failed") && <button type="button" className="text-button workspace-new-batch-top" onClick={newBatch}>New batch</button>}
      </div>
      <p className="intro">Workspace ID: <code>{sessionId}</code></p>
      {connection !== "error" && !missing && (
        <p className={`workspace-status ${status === "failed" ? "failed" : status === "completed" ? "complete" : ""}`} role="status" aria-live="polite">
          {statusText}{workspace ? ` · ${workspace.fileCount} file${workspace.fileCount === 1 ? "" : "s"}` : ""}
        </p>
      )}
      {connection === "error" && (
        <div className="error-message" role="alert">
          <strong>Connection problem</strong>
          <span>{message ?? "Could not reach the workspace."}</span>
          <button type="button" className="primary-button" onClick={() => void reconnect()}>Reconnect</button>
        </div>
      )}
      {missing && <div className="error-message" role="alert"><strong>Workspace unavailable</strong><span>{message}</span><button type="button" className="text-button" onClick={newBatch}>New batch</button></div>}
      {message && connection === "connected" && <p className="status" role="status">{message}</p>}
      {status === "uploading" && connection === "connected" && (
        <section className="workspace-upload-management" aria-label="Manage workspace files">
          <div className="workspace-upload-toolbar">
            <div><h2>Workspace files</h2><p>Add more documents or remove an upload before starting the workflow.</p></div>
            <label className="workspace-add-files">
              {fileActionPending ? "Updating files…" : "Add files"}
              <input ref={additionalFilesInput} type="file" multiple tabIndex={-1} onChange={(event) => void addWorkspaceFiles(event.currentTarget.files)} disabled={fileActionPending || (workspace?.fileCount ?? 0) >= 20} />
            </label>
          </div>
          {fileActionError && <p className="error-message" role="alert">{fileActionError}</p>}
          {(workspace?.files ?? []).length > 0 && <ul className="workspace-uploaded-files">{workspace?.files?.map((filename) => <li key={filename}><span>{filename}</span><button type="button" onClick={() => void removeWorkspaceFile(filename)} disabled={fileActionPending}>Remove</button></li>)}</ul>}
        </section>
      )}
      {status === "uploading" && connection === "connected" && (
        <div className="actions">
          <button type="button" className="primary-button" onClick={() => void startWorkflow()} disabled={startPending || (workspace?.fileCount ?? 0) < 1}>
            {startPending ? <><span className="button-spinner" aria-hidden="true" />Starting…</> : "Start workflow"}
          </button>
          <button type="button" className="text-button" onClick={newBatch}>New batch</button>
        </div>
      )}
      {status === "queued" || status === "running" ? <p className="hint">Status refreshes automatically about every 2.5 seconds. Reloading this page resumes observation; it does not start another workflow.</p> : null}
      <WorkflowStatePreview sessionId={sessionId} status={status ?? null} error={safeWorkflowError} connection={connection} missing={missing} startPending={startPending} uncertainStart={Boolean(message && status === "uploading" && !startPending)} />
      {status === "completed" && (
        <section className="results" aria-labelledby="results-heading">
          <h2 id="results-heading">Workflow finished</h2>
          <div className="result-overview" aria-label="Extraction overview">
            <div><span>Reporting period</span><strong>{reportingPeriod}</strong></div>
            <div><span>Documents completed</span><strong>{completedCount}</strong></div>
            <div><span>Documents skipped / failed</span><strong>{skippedCount} / {failedCount}</strong></div>
            <div><span>Components validated / excluded</span><strong>{validatedComponentCount} / {excludedComponentCount}</strong></div>
          </div>
          {extractedDataCount === 0 && <p className="no-data" role="status">No documents were successfully extracted. Check the document outcomes and reasons below.</p>}
          {aircraft.length > 0 && <AircraftResults aircraft={aircraft} />}
          {otherOutcomes.length > 0 && (
            <section className="document-outcomes" aria-labelledby="document-outcomes-heading">
              <div className="document-outcomes-heading"><h3 id="document-outcomes-heading">Skipped and failed documents</h3><span>{otherOutcomes.length} outcome{otherOutcomes.length === 1 ? "" : "s"}</span></div>
              <div className="document-results">
                {otherOutcomes.map((item, index) => {
                  const statusValue = typeof item.status === "string" ? sanitizeText(item.status) : "unknown";
                  const sourceName = typeof item.sourceName === "string" ? sanitizeText(item.sourceName.replace(/\\/g, "/").split("/").pop() || item.sourceName) : `Document outcome ${index + 1}`;
                  const reason = typeof item.reason === "string" ? sanitizeText(item.reason) : null;
                  return (
                    <article className={`document-result document-result-${statusValue}`} key={`${sourceName}-${index}`}>
                      <header className="document-result-heading"><div><span className="section-kicker">DOCUMENT OUTCOME {index + 1}</span><h4>{sourceName}</h4></div><span className={`document-result-status result-status-${statusValue}`}>{readableLabel(statusValue)}</span></header>
                      {reason ? <p className="document-result-reason">{reason}</p> : <p className="document-result-reason">No additional reason was provided.</p>}
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </section>
      )}
      {status === "failed" && <div className="error-message" role="alert"><strong>Workflow failed</strong><span>{safeWorkflowError || "The backend did not provide a failure reason."}</span></div>}

    </>
  );
}
