"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { workspaceApi, WorkspaceApiError, type WorkspaceStatus } from "@/lib/workspace-api";
import WorkflowStatePreview from "@/components/workflow-state-preview";

const POLL_INTERVAL_MS = 2500;
const START_TIMEOUT_MS = 15000;
type ConnectionState = "connecting" | "connected" | "error";

function sanitizeText(value: string): string {
  if (/\n\s*at\s+\S+|\b(?:Error|Exception):\s+.*\n\s*at\s+/i.test(value)) return "[details redacted]";
  return value
    .replace(/(?:[A-Za-z]:\\|\\\\[^\\\s]+\\[^\\\s]+|\/(?:data|app|home|tmp|Users|var|mnt)\/)[^\s"'<>]*/g, "[path redacted]")
    .replace(/\b(password|secret|token|api[_-]?key|credential)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]");
}

function sanitizeResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeResult);
  if (typeof value === "string") return sanitizeText(value);
  if (!value || typeof value !== "object") return value;
  const hidden = new Set(["sourcepath", "sourcepaths", "sourcefile", "textpath", "resultpath", "resultpaths", "uploaddirectory", "rawsourcetext", "documenttext", "fulltext", "markdown", "excerpt", "evidence", "stack", "stacktrace"]);
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (hidden.has(normalized) || normalized.endsWith("path") || normalized.endsWith("paths") || /(password|secret|token|credential|apikey|username)/.test(normalized)) return [];
    return [[key, sanitizeResult(item)]];
  }));
}

function extractionOutcomes(result: unknown): Array<Record<string, unknown>> {
  if (!result || typeof result !== "object" || !("extractionResults" in result)) return [];
  const outcomes = (result as { extractionResults?: unknown }).extractionResults;
  return Array.isArray(outcomes) ? outcomes.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item)) : [];
}

export default function WorkspaceMonitor({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<WorkspaceStatus | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [startPending, setStartPending] = useState(false);
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

  function newBatch() {
    clearTimer();
    request.current?.abort();
    router.push("/");
  }

  const status = workspace?.status;
  const safeWorkflowError = workspace?.error ? sanitizeText(workspace.error) : null;
  const outcomes = extractionOutcomes(workspace?.result);
  const completedCount = outcomes.filter((item) => item.status === "completed").length;
  const skippedCount = outcomes.filter((item) => item.status === "skipped").length;
  const failedCount = outcomes.filter((item) => item.status === "failed").length;
  const extractedDataCount = outcomes.filter((item) => item.status === "completed" && item.data !== null && item.data !== undefined).length;
  const sanitizedResult = sanitizeResult(workspace?.result ?? null);
  const statusText = status === "queued" ? "Workflow queued"
    : status === "running" ? "Workflow running"
    : status === "completed" ? "Workflow finished"
    : status === "failed" ? "Workflow failed"
    : status === "uploading" ? "Files uploaded — workflow not started"
    : "Checking workspace status…";

  return (
    <>
      <p className="eyebrow">EVE · DOCUMENT PROCESSING</p>
      <h1>Workspace</h1>
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
        <div className="actions">
          <button type="button" className="primary-button" onClick={() => void startWorkflow()} disabled={startPending || (workspace?.fileCount ?? 0) < 1}>
            {startPending ? <><span className="button-spinner" aria-hidden="true" />Starting…</> : "Start workflow"}
          </button>
          <button type="button" className="text-button" onClick={newBatch}>New batch</button>
        </div>
      )}
      {status === "queued" || status === "running" ? <p className="hint">Status refreshes automatically about every 2.5 seconds. Reloading this page resumes observation; it does not start another workflow.</p> : null}
      {status === "completed" && (
        <section className="results" aria-labelledby="results-heading">
          <h2 id="results-heading">Workflow finished</h2>
          <p className="outcome-counts" aria-label="Document outcome counts">
            Completed: {completedCount} · Skipped: {skippedCount} · Failed: {failedCount}
          </p>
          {extractedDataCount === 0 && <p className="no-data" role="status">No documents were successfully extracted. Check the document outcomes and reasons below.</p>}
          {outcomes.length > 0 ? (
            <ul className="outcome-list">
              {outcomes.map((item, index) => {
                const statusValue = typeof item.status === "string" ? sanitizeText(item.status) : "unknown";
                const sourceName = typeof item.sourceName === "string" ? sanitizeText(item.sourceName.replace(/\\/g, "/").split("/").pop() || item.sourceName) : `Document ${index + 1}`;
                const reason = typeof item.reason === "string" ? sanitizeText(item.reason) : null;
                return <li className="outcome-item" key={`${sourceName}-${index}`} style={{ animationDelay: `${Math.min(index, 8) * 55}ms` }}><strong>{sourceName}</strong><span className="outcome-label">{statusValue}</span>{(statusValue === "skipped" || statusValue === "failed") && reason && <span className="outcome-reason">{reason}</span>}</li>;
              })}
            </ul>
          ) : <p className="no-data">No document outcome data was returned.</p>}
          <details className="result-json">
            <summary>Inspect sanitized structured result</summary>
            <pre>{JSON.stringify(sanitizedResult, null, 2) ?? "null"}</pre>
          </details>
        </section>
      )}
      {status === "failed" && <div className="error-message" role="alert"><strong>Workflow failed</strong><span>{safeWorkflowError || "The backend did not provide a failure reason."}</span></div>}
      {(status === "completed" || status === "failed") && <button type="button" className="text-button" onClick={newBatch}>New batch</button>}
      <WorkflowStatePreview sessionId={sessionId} status={status ?? null} error={safeWorkflowError} connection={connection} missing={missing} startPending={startPending} uncertainStart={Boolean(message && status === "uploading" && !startPending)} />
    </>
  );
}
