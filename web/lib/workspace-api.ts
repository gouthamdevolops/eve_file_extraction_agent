export type WorkspaceState = "uploading" | "queued" | "running" | "completed" | "failed";
export type WorkspaceSummaryStatus = WorkspaceState | "unknown";

export interface WorkspaceSummary {
  sessionId: string;
  status: WorkspaceSummaryStatus;
  fileCount: number | null;
  reportingYear: number | null;
  reportingMonth: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface WorkspaceListResponse {
  total: number;
  workspaces: WorkspaceSummary[];
}

export interface WorkspaceListFilters {
  year?: number;
  month?: number;
}

export interface WorkspaceStatus<Result = unknown> {
  sessionId: string;
  status: WorkspaceState;
  fileCount: number;
  files?: string[];
  workflowSessionId: string | null;
  result: Result | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceCreated {
  sessionId: string;
  status: "uploading";
}

export interface UploadAccepted {
  sessionId: string;
  fileCount: number;
  status: "uploading";
}

export interface WorkflowAccepted {
  sessionId: string;
  status: "queued";
}

export class WorkspaceApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "WorkspaceApiError";
  }
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = value && typeof value === "object" && "error" in value && typeof value.error === "string"
      ? value.error
      : "Workspace request failed.";
    throw new WorkspaceApiError(message, response.status);
  }
  return value as T;
}

const root = "/api/extraction/workspace";

export const workspaceApi = {
  create: () => jsonRequest<WorkspaceCreated>(root, { method: "POST" }),
  list: (filters: WorkspaceListFilters = {}, signal?: AbortSignal) => {
    const query = new URLSearchParams();
    if (filters.year !== undefined) query.set("year", String(filters.year));
    if (filters.month !== undefined) query.set("month", String(filters.month));
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return jsonRequest<WorkspaceListResponse>(`${root}${suffix}`, { method: "GET", signal });
  },
  upload: (sessionId: string, file: File) => {
    const form = new FormData();
    form.append("file", file, file.name);
    return jsonRequest<UploadAccepted>(`${root}/${encodeURIComponent(sessionId)}/uploads`, { method: "POST", body: form });
  },
  removeUpload: (sessionId: string, filename: string) => jsonRequest<UploadAccepted>(`${root}/${encodeURIComponent(sessionId)}/uploads?filename=${encodeURIComponent(filename)}`, { method: "DELETE" }),
  start: (sessionId: string, signal?: AbortSignal) => jsonRequest<WorkflowAccepted>(`${root}/${encodeURIComponent(sessionId)}/process`, { method: "POST", signal }),
  status: (sessionId: string, signal?: AbortSignal) => jsonRequest<WorkspaceStatus>(`${root}/${encodeURIComponent(sessionId)}`, { method: "GET", signal }),
  deleteWorkspace: (sessionId: string) => jsonRequest<{ sessionId: string; deleted: true }>(`${root}/${encodeURIComponent(sessionId)}`, { method: "DELETE" }),
};
