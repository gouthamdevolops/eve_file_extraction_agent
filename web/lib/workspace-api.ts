export type WorkspaceState = "uploading" | "queued" | "running" | "completed" | "failed";

export interface WorkspaceStatus<Result = unknown> {
  sessionId: string;
  status: WorkspaceState;
  fileCount: number;
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
  upload: (sessionId: string, file: File) => {
    const form = new FormData();
    form.append("file", file, file.name);
    return jsonRequest<UploadAccepted>(`${root}/${encodeURIComponent(sessionId)}/uploads`, { method: "POST", body: form });
  },
  start: (sessionId: string, signal?: AbortSignal) => jsonRequest<WorkflowAccepted>(`${root}/${encodeURIComponent(sessionId)}/process`, { method: "POST", signal }),
  status: (sessionId: string, signal?: AbortSignal) => jsonRequest<WorkspaceStatus>(`${root}/${encodeURIComponent(sessionId)}`, { method: "GET", signal }),
};
