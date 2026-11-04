import type { WorkspaceState } from "@/lib/workspace-api";

const RECENT_WORKSPACE_KEY = "eve:recent-workspace";
const RECENT_WORKSPACE_EVENT = "eve:recent-workspace-change";
const WORKSPACE_STATES = new Set<WorkspaceState>(["uploading", "queued", "running", "completed", "failed"]);

export type RecentWorkspace = { sessionId: string; status: WorkspaceState };

export function getRecentWorkspaceSnapshot(): string | null {
  try { return sessionStorage.getItem(RECENT_WORKSPACE_KEY); } catch { return null; }
}

export function subscribeToRecentWorkspace(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(RECENT_WORKSPACE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(RECENT_WORKSPACE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function rememberRecentWorkspace(workspace: RecentWorkspace): void {
  try {
    sessionStorage.setItem(RECENT_WORKSPACE_KEY, JSON.stringify(workspace));
    window.dispatchEvent(new Event(RECENT_WORKSPACE_EVENT));
  } catch {
    // Recent-workspace navigation is optional when browser storage is unavailable.
  }
}

export function parseRecentWorkspace(snapshot: string | null): RecentWorkspace | null {
  if (!snapshot) return null;
  try {
    const value: unknown = JSON.parse(snapshot);
    if (!value || typeof value !== "object" || !("sessionId" in value) || typeof value.sessionId !== "string" || !("status" in value) || typeof value.status !== "string" || !WORKSPACE_STATES.has(value.status as WorkspaceState)) return null;
    return { sessionId: value.sessionId, status: value.status as WorkspaceState };
  } catch {
    return null;
  }
}
