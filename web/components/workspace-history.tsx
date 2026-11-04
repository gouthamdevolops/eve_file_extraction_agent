"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { workspaceApi, type WorkspaceSummary } from "@/lib/workspace-api";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const LOAD_ERROR = "Could not load workspaces. Reload the page to try again.";

type Filters = { valid: boolean; year: number | null; month: number | null };
type LoadState =
  | { key: string; status: "error" }
  | { key: string; status: "success"; workspaces: WorkspaceSummary[] };

function parseFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  if ([...params.keys()].some((key) => key !== "year" && key !== "month")) return { valid: false, year: null, month: null };

  const parse = (key: "year" | "month", pattern: RegExp, minimum: number, maximum: number) => {
    const values = params.getAll(key);
    if (values.length === 0) return { valid: true, value: null as number | null };
    if (values.length !== 1 || !pattern.test(values[0])) return { valid: false, value: null as number | null };
    const value = Number(values[0]);
    return Number.isInteger(value) && value >= minimum && value <= maximum
      ? { valid: true, value }
      : { valid: false, value: null as number | null };
  };

  const year = parse("year", /^\d{4}$/, 1900, 2200);
  const month = parse("month", /^\d{1,2}$/, 1, 12);
  return { valid: year.valid && month.valid, year: year.value, month: month.value };
}

function availableYears(workspaces: WorkspaceSummary[]): number[] {
  return [...new Set(workspaces.map((workspace) => workspace.reportingYear).filter((year): year is number => year !== null))]
    .sort((left, right) => right - left);
}

function formatDate(value: string | null): string {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(date);
}

export default function WorkspaceHistory() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const filters = useMemo(() => parseFilters(query), [query]);
  const [loadState, setLoadState] = useState<LoadState | null>(null);
  const [years, setYears] = useState<number[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceSummary | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const yearOptionsLoaded = useRef(false);

  useEffect(() => {
    if (!filters.valid || (filters.year === null && filters.month === null) || yearOptionsLoaded.current) return;
    const controller = new AbortController();
    let current = true;
    workspaceApi.list({}, controller.signal).then((response) => {
      if (!current) return;
      setYears(availableYears(response.workspaces));
      yearOptionsLoaded.current = true;
    }).catch(() => {
      // The active filter request controls the visible page error state.
    });
    return () => {
      current = false;
      controller.abort();
    };
  }, [filters.valid, filters.year, filters.month]);

  useEffect(() => {
    const key = query;
    if (!filters.valid) return;

    const controller = new AbortController();
    let current = true;
    workspaceApi.list({
      ...(filters.year === null ? {} : { year: filters.year }),
      ...(filters.month === null ? {} : { month: filters.month }),
    }, controller.signal).then((response) => {
      if (!current) return;
      if (filters.year === null && filters.month === null) {
        setYears(availableYears(response.workspaces));
        yearOptionsLoaded.current = true;
      }
      setLoadState({ key, status: "success", workspaces: response.workspaces });
    }).catch(() => {
      if (current && !controller.signal.aborted) setLoadState({ key, status: "error" });
    });

    return () => {
      current = false;
      controller.abort();
    };
  }, [query, filters.valid, filters.year, filters.month]);

  function updateFilters(nextYear: number | null, nextMonth: number | null) {
    const params = new URLSearchParams();
    if (nextYear !== null) params.set("year", String(nextYear));
    if (nextMonth !== null) params.set("month", String(nextMonth));
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    router.push(`${pathname}${suffix}`, { scroll: false });
  }

  const currentState = loadState?.key === query ? loadState : null;

  async function confirmDeleteWorkspace() {
    if (!deleteTarget || deletePending) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      await workspaceApi.deleteWorkspace(deleteTarget.sessionId);
      setLoadState((current) => current?.status === "success"
        ? { ...current, workspaces: current.workspaces.filter((item) => item.sessionId !== deleteTarget.sessionId) }
        : current);
      setDeleteTarget(null);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "Could not delete workspace.");
    } finally {
      setDeletePending(false);
    }
  }
  const yearOptions = [...new Set([...years, ...(filters.year === null ? [] : [filters.year])])]
    .sort((left, right) => right - left);

  return (
    <section className="workspace-history" aria-labelledby="workspace-history-title">
      <header className="workspace-history-heading">
        <div>
          <p className="workspace-history-eyebrow">SAVED EXTRACTION WORKSPACES</p>
          <h1 id="workspace-history-title">Workspaces</h1>
          <p className="workspace-history-description">Browse saved batches by their document reporting period.</p>
        </div>
        <Link className="workspace-history-new-batch" href="/">New batch</Link>
      </header>

      <div className="workspace-history-filters" aria-label="Filter workspaces by reporting period">
        <div className="workspace-history-filter">
          <label htmlFor="workspace-history-year">Year</label>
          <select
            id="workspace-history-year"
            value={filters.year === null ? "" : String(filters.year)}
            onChange={(event) => updateFilters(event.currentTarget.value ? Number(event.currentTarget.value) : null, filters.month)}
          >
            <option value="">All years</option>
            {yearOptions.map((year) => <option value={year} key={year}>{year}</option>)}
          </select>
        </div>
        <div className="workspace-history-filter">
          <label htmlFor="workspace-history-month">Month</label>
          <select
            id="workspace-history-month"
            value={filters.month === null ? "" : String(filters.month)}
            onChange={(event) => updateFilters(filters.year, event.currentTarget.value ? Number(event.currentTarget.value) : null)}
          >
            <option value="">All months</option>
            {MONTHS.map((month, index) => <option value={index + 1} key={month}>{month}</option>)}
          </select>
        </div>
        <button className="workspace-history-clear" type="button" onClick={() => updateFilters(null, null)} disabled={filters.year === null && filters.month === null}>
          Clear filters
        </button>
      </div>

      <div className="workspace-history-content" aria-busy={filters.valid && !currentState}>
        {!filters.valid || currentState?.status === "error" ? (
          <p className="workspace-history-message workspace-history-error" role="alert">{LOAD_ERROR}</p>
        ) : !currentState ? (
          <p className="workspace-history-message" role="status">Loading workspaces…</p>
        ) : currentState.workspaces.length === 0 ? (
          <p className="workspace-history-message" role="status">No workspaces found</p>
        ) : (
          <div className="workspace-history-table-scroll" role="region" aria-label="Saved workspace results" tabIndex={0}>
            <table className="workspace-history-table">
              <caption className="workspace-history-sr-only">Saved workspaces matching the selected reporting period</caption>
              <thead>
                <tr>
                  <th scope="col">Workspace ID</th>
                  <th scope="col">Status</th>
                  <th scope="col">Files</th>
                  <th scope="col">Reporting year</th>
                  <th scope="col">Reporting month</th>
                  <th scope="col">Created</th>
                  <th scope="col">Updated</th>
                  <th scope="col">Open</th>
                  <th scope="col">Delete</th>
                </tr>
              </thead>
              <tbody>
                {currentState.workspaces.map((workspace) => (
                  <tr key={workspace.sessionId}>
                    <th scope="row"><span className="workspace-history-id" title={workspace.sessionId}><span aria-hidden="true">{workspace.sessionId.slice(0, 8)}…</span><span className="workspace-history-sr-only">Full workspace ID: {workspace.sessionId}</span></span></th>
                    <td><span className={`workspace-history-status workspace-history-status-${workspace.status}`}>{workspace.status === "unknown" ? "Unknown" : workspace.status}</span></td>
                    <td>{workspace.fileCount ?? "Not available"}</td>
                    <td>{workspace.reportingYear ?? "Not available"}</td>
                    <td>{workspace.reportingMonth === null ? "Not available" : MONTHS[workspace.reportingMonth - 1]}</td>
                    <td>{workspace.createdAt ? <time dateTime={workspace.createdAt}>{formatDate(workspace.createdAt)}</time> : "Not available"}</td>
                    <td>{workspace.updatedAt ? <time dateTime={workspace.updatedAt}>{formatDate(workspace.updatedAt)}</time> : "Not available"}</td>
                    <td><Link className="workspace-history-open" href={`/workspaces/${encodeURIComponent(workspace.sessionId)}`} aria-label={`Open workspace ${workspace.sessionId}`}>Open</Link></td>
                    <td><button className="workspace-history-delete" type="button" onClick={() => { setDeleteError(null); setDeleteTarget(workspace); }} aria-label={`Delete workspace ${workspace.sessionId}`}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {deleteTarget && <div className="workspace-delete-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !deletePending) setDeleteTarget(null); }}>
        <section className="workspace-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-delete-title" aria-describedby="workspace-delete-description">
          <h2 id="workspace-delete-title">Delete this workspace?</h2>
          <p id="workspace-delete-description">Delete workspace <strong>{deleteTarget.sessionId}</strong> and its uploaded files? This cannot be undone.</p>
          {deleteError && <p className="workspace-delete-error" role="alert">{deleteError}</p>}
          <div className="workspace-delete-actions"><button type="button" className="workspace-delete-cancel" onClick={() => setDeleteTarget(null)} disabled={deletePending}>Cancel</button><button type="button" className="workspace-delete-confirm" onClick={() => void confirmDeleteWorkspace()} disabled={deletePending}>{deletePending ? "Deleting…" : "Delete"}</button></div>
        </section>
      </div>}
    </section>
  );
}
