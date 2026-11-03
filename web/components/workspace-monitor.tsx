"use client";

import { useCallback, useEffect, useRef, useState, type UIEvent } from "react";
import { useRouter } from "next/navigation";
import { workspaceApi, WorkspaceApiError, type WorkspaceStatus } from "@/lib/workspace-api";
import WorkflowStatePreview from "@/components/workflow-state-preview";
import { rememberRecentWorkspace } from "@/lib/recent-workspace";

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const componentCards = [
  { key: "Airframe", label: "Airframe" },
  { key: "Engine1", label: "Engine 1" },
  { key: "Engine2", label: "Engine 2" },
  { key: "APU", label: "APU" },
  { key: "LandingGearLeft", label: "Left landing gear" },
  { key: "LandingGearRight", label: "Right landing gear" },
  { key: "LandingGearNose", label: "Nose landing gear" },
] as const;

const componentFields = [
  ["SerialNumber", "Serial number"], ["TSN", "TSN"], ["CSN", "CSN"],
  ["MonthlyUtil_Hrs", "Monthly utilization · hours"], ["MonthlyUtil_Cyc", "Monthly utilization · cycles"],
  ["attachment_status", "Attachment status"], ["derate", "Derate"], ["location", "Location"],
  ["current_aircraft", "Current aircraft"], ["TSN_raw", "TSN · source format"], ["CSN_raw", "CSN · source format"],
  ["MonthlyUtil_Hrs_raw", "Monthly hours · source format"], ["MonthlyUtil_Cyc_raw", "Monthly cycles · source format"],
  ["available", "Data available"], ["extraction_confidence", "Extraction confidence"],
] as const;

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

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not available";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return sanitizeText(value);
  if (typeof value === "number") return String(value);
  return "Not available";
}

function displayMetric(value: unknown): string {
  return typeof value === "number"
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
    : displayValue(value);
}

export default function WorkspaceMonitor({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<WorkspaceStatus | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [startPending, setStartPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [componentSearch, setComponentSearch] = useState("");
  const [activeComponentIndex, setActiveComponentIndex] = useState<Record<number, number>>({});
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

  function navigateToComponent(documentIndex: number, componentKey: string, componentIndex: number) {
    const rail = document.getElementById(`component-results-${documentIndex}`);
    const card = document.getElementById(`component-${documentIndex}-${componentKey}`);
    setActiveComponentIndex((current) => ({ ...current, [documentIndex]: componentIndex }));
    if (rail && card) {
      const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      rail.scrollTo({ top: rail.scrollTop + card.getBoundingClientRect().top - rail.getBoundingClientRect().top, behavior: prefersReducedMotion ? "auto" : "smooth" });
    }
  }

  function handleComponentScroll(event: UIEvent<HTMLDivElement>, documentIndex: number) {
    const rail = event.currentTarget;
    const cards = Array.from(rail.querySelectorAll<HTMLElement>("[data-component-index]"));
    const closest = cards.reduce<HTMLElement | null>((best, card) => {
      if (!best) return card;
      const currentDistance = Math.abs(card.getBoundingClientRect().top - rail.getBoundingClientRect().top);
      const bestDistance = Math.abs(best.getBoundingClientRect().top - rail.getBoundingClientRect().top);
      return currentDistance < bestDistance ? card : best;
    }, null);
    if (closest) {
      const nextIndex = Number(closest.dataset.componentIndex);
      setActiveComponentIndex((current) => current[documentIndex] === nextIndex ? current : { ...current, [documentIndex]: nextIndex });
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
  const sanitizedResult = sanitizeResult(workspace?.result ?? null);
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
          {outcomes.length > 0 ? (
            <div className="document-results">
              {outcomes.map((item, index) => {
                const statusValue = typeof item.status === "string" ? sanitizeText(item.status) : "unknown";
                const sourceName = typeof item.sourceName === "string" ? sanitizeText(item.sourceName.replace(/\\/g, "/").split("/").pop() || item.sourceName) : `Document ${index + 1}`;
                const reason = typeof item.reason === "string" ? sanitizeText(item.reason) : null;
                const data = asRecord(item.data);
                const fields = Array.isArray(data?.fields) ? data.fields.map(asRecord).filter((field): field is Record<string, unknown> => field !== null) : [];
                const components = asRecord(data?.components) ?? {};
                const validations = Array.isArray(item.componentValidation) ? item.componentValidation.map(asRecord).filter((entry): entry is Record<string, unknown> => entry !== null) : [];
                const matchingComponents = componentCards.map((component, componentIndex) => ({ component, componentIndex })).filter(({ component }) => {
                  const componentData = asRecord(components[component.key]);
                  return `${component.label} ${typeof componentData?.SerialNumber === "string" ? componentData.SerialNumber : ""}`.toLocaleLowerCase().includes(componentSearch.trim().toLocaleLowerCase());
                });
                return (
                  <article className={`document-result document-result-${statusValue}`} key={`${sourceName}-${index}`} style={{ animationDelay: `${Math.min(index, 8) * 55}ms` }}>
                    <header className="document-result-heading"><div><span className="section-kicker">DOCUMENT {index + 1}</span><h3>{sourceName}</h3></div><span className={`document-result-status result-status-${statusValue}`}>{readableLabel(statusValue)}</span></header>
                    {(statusValue === "skipped" || statusValue === "failed") && reason && <p className="document-result-reason">{reason}</p>}
                    {data ? <div className="document-result-body">
                      <section className="extracted-summary" aria-label={`Summary extraction for ${sourceName}`}>
                        <h4>Aircraft summary</h4>
                        {fields.length > 0 ? <dl className="extracted-fields">{fields.map((field, fieldIndex) => {
                          const name = typeof field.name === "string" ? field.name : `Field ${fieldIndex + 1}`;
                          const confidence = typeof field.confidence === "number" ? ` · ${field.confidence}% confidence` : "";
                          return <div className="extracted-field" key={`${name}-${fieldIndex}`}><dt>{readableLabel(name)}</dt><dd>{displayValue(field.value)}<small>{confidence.trim() || " "}</small></dd></div>;
                        })}</dl> : <p className="empty-result-note">No aircraft summary values were returned for this document.</p>}
                      </section>
                      <section className="component-section" aria-label={`Component extraction for ${sourceName}`}>
                        <div className="component-section-heading"><h4>Component details</h4><span>Card {(activeComponentIndex[index] ?? 0) + 1} of {componentCards.length} · {matchingComponents.length} matching</span></div>
                        <label className="component-search"><span aria-hidden="true">⌕</span><input type="search" value={componentSearch} onChange={(event) => {
                          const value = event.target.value;
                          const query = value.trim().toLocaleLowerCase();
                          const firstMatch = componentCards.findIndex(({ key, label }) => {
                            const componentData = asRecord(components[key]);
                            return `${label} ${typeof componentData?.SerialNumber === "string" ? componentData.SerialNumber : ""}`.toLocaleLowerCase().includes(query);
                          });
                          setComponentSearch(value);
                          if (firstMatch >= 0) setActiveComponentIndex((current) => ({ ...current, [index]: firstMatch }));
                        }} placeholder="Find a component or serial number…" aria-label={`Find a component or serial number in ${sourceName}`} /></label>
                        <div className="component-navigation" role="group" aria-label={`Jump to a component in ${sourceName}`}>{matchingComponents.map(({ component, componentIndex }) => <button type="button" key={component.key} aria-pressed={(activeComponentIndex[index] ?? 0) === componentIndex} className={(activeComponentIndex[index] ?? 0) === componentIndex ? "active" : ""} onClick={() => navigateToComponent(index, component.key, componentIndex)}>{component.label}</button>)}</div>
                        <div id={`component-results-${index}`} className="component-card-grid" role="region" tabIndex={0} onScroll={(event) => handleComponentScroll(event, index)} aria-label={`Scrollable component results for ${sourceName}`}>{matchingComponents.map(({ component, componentIndex }) => {
                          const componentData = asRecord(components[component.key]);
                          const validation = validations.find((entry) => entry.component === component.key);
                          const validationStatus = typeof validation?.status === "string" ? validation.status : componentData?.available === true ? "validated" : "not-reported";
                          const validationLabel = validationStatus === "not-reported" ? "Not checked" : readableLabel(validationStatus);
                          const validationReason = typeof validation?.reason === "string" ? sanitizeText(validation.reason) : null;
                          const metricFields = componentFields.filter(([key]) => ["TSN", "CSN", "MonthlyUtil_Hrs", "MonthlyUtil_Cyc"].includes(key) && componentData && Object.prototype.hasOwnProperty.call(componentData, key));
                          const serialNumber = componentData?.SerialNumber;
                          const serialIdentified = typeof serialNumber === "string" && serialNumber.trim() !== "" && serialNumber !== "Not found";
                          return <article id={`component-${index}-${component.key}`} data-component-index={componentIndex} className={`component-card component-tone-${componentIndex}`} key={component.key}>
                            <div className="component-card-heading"><h5><svg className="component-plane-icon" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 3.5c-1.8 0-3 1.5-3 3.5v13L5 28.5v4l16-4.7v10.6l-5.8 4.1v2.3L24 42.7l8.8 2.1v-2.3L27 38.4V27.8l16 4.7v-4L27 20V7c0-2-1.2-3.5-3-3.5Z" /></svg>{component.label}</h5><div className="component-status-chips"><span className={`component-validation component-validation-${validationStatus}`}>DB · {validationLabel}</span><span className={`component-data-status ${componentData?.available === true ? "has-extracted-data" : "no-extracted-data"}`}>{componentData?.available === true ? "Values extracted" : serialIdentified ? "Serial identified" : "No values extracted"}</span></div></div>
                            <div className="component-serial"><span>S/N</span><strong>{displayValue(serialNumber)}</strong></div>
                            <dl className="component-metrics">{metricFields.map(([key, label]) => {
                              const rawKey = key === "TSN" ? "TSN_raw" : key === "CSN" ? "CSN_raw" : key === "MonthlyUtil_Hrs" ? "MonthlyUtil_Hrs_raw" : "MonthlyUtil_Cyc_raw";
                              const rawValue = componentData?.[rawKey];
                              return <div className="component-metric" key={key}><dt>{label}</dt><dd>{displayMetric(componentData?.[key])}</dd>{typeof rawValue === "string" && rawValue && <small>Source format: {sanitizeText(rawValue)}</small>}</div>;
                            })}</dl>
                            <div className="component-card-meta">{["location", "attachment_status", "derate", "current_aircraft"].map((key) => {
                              const value = componentData?.[key];
                              if (typeof value !== "string" || !value.trim() || value === "Not found") return null;
                              const label = componentFields.find(([fieldKey]) => fieldKey === key)?.[1] ?? readableLabel(key);
                              return <span className={key === "location" ? "component-meta-location" : undefined} key={key}>{key === "location" && <svg className="component-location-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M16 8.5c0 4.2-6 9-6 9s-6-4.8-6-9a6 6 0 1 1 12 0Z" /><circle cx="10" cy="8.5" r="2" /></svg>}<strong>{label}:</strong> {sanitizeText(value)}</span>;
                            })}<span className="component-availability">Data available: {componentData?.available === true ? "Yes" : "No"}{typeof componentData?.extraction_confidence === "number" ? ` · ${Math.round(componentData.extraction_confidence * 100)}% confidence` : ""}</span></div>
                            {validationReason && <p className="component-validation-reason">{validationReason}</p>}
                          </article>;
                        })}{matchingComponents.length === 0 && <p className="no-component-match">No components match this search.</p>}</div>
                      </section>
                    </div> : <p className="empty-result-note">No structured extraction data is available for this document.</p>}
                  </article>
                );
              })}
            </div>
          ) : <p className="no-data">No document outcome data was returned.</p>}
          <details className="result-json">
            <summary>View sanitized technical data (JSON)</summary>
            <pre>{JSON.stringify(sanitizedResult, null, 2) ?? "null"}</pre>
          </details>
        </section>
      )}
      {status === "failed" && <div className="error-message" role="alert"><strong>Workflow failed</strong><span>{safeWorkflowError || "The backend did not provide a failure reason."}</span></div>}

    </>
  );
}
