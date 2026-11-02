import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChannelFrom } from "eve/channels";
import { SUPPORTED_EXTENSIONS } from "./document-preparation.js";
import { normalizeReportingPeriod } from "./reporting-period.js";

export type WorkspaceStatus = "uploading" | "queued" | "running" | "completed" | "failed";

export type WorkspaceMetadata = {
  sessionId: string;
  status: WorkspaceStatus;
  files: string[];
  reportingPeriod: string | null;
  createdAt: string;
  updatedAt: string;
  workflowSessionId?: string;
  result?: unknown;
  error?: string;
};

const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_FILES = 20;
const DEFAULT_MAX_WORKSPACE_BYTES = 250 * 1024 * 1024;
const DEFAULT_MAX_REQUEST_BYTES = DEFAULT_MAX_FILE_BYTES + 1024 * 1024;
const activeWorkspaces = new Set<string>();
const startingWorkspaces = new Set<string>();
const workspaceAuth = {
  authenticator: "local-upload-api",
  principalId: "local-upload-api",
  principalType: "service",
  attributes: { source: "workspace-upload-api" },
} as const;

function positiveLimit(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function dataRoot(): string {
  return path.resolve(process.env.DATA_DIR || "/data");
}

function workspacePath(sessionId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
    throw new Error("Invalid workspace session ID.");
  }
  return path.join(dataRoot(), "workspaces", sessionId);
}

async function persistWorkspace(metadata: WorkspaceMetadata): Promise<void> {
  const directory = workspacePath(metadata.sessionId);
  const target = path.join(directory, "workspace.json");
  const temporary = path.join(directory, `workspace.${randomUUID()}.tmp`);
  metadata.updatedAt = new Date().toISOString();
  await writeFile(temporary, JSON.stringify(metadata, null, 2), { flag: "wx" });
  await rename(temporary, target);
}

export async function getWorkspace(sessionId: string): Promise<WorkspaceMetadata | null> {
  let directory: string;
  try {
    directory = workspacePath(sessionId);
  } catch {
    return null;
  }
  try {
    const metadata = JSON.parse(await readFile(path.join(directory, "workspace.json"), "utf8")) as WorkspaceMetadata;
    return metadata.sessionId === sessionId ? metadata : null;
  } catch {
    return null;
  }
}

export async function updateWorkspace(sessionId: string, update: Partial<WorkspaceMetadata>): Promise<WorkspaceMetadata | null> {
  const metadata = await getWorkspace(sessionId);
  if (!metadata) return null;
  Object.assign(metadata, update);
  await persistWorkspace(metadata);
  return metadata;
}

export async function createWorkspace(reportingPeriod: string | null = null): Promise<WorkspaceMetadata> {
  const sessionId = randomUUID();
  const directory = workspacePath(sessionId);
  const uploadsDirectory = path.join(directory, "uploads");
  const now = new Date().toISOString();
  const metadata: WorkspaceMetadata = {
    sessionId,
    status: "uploading",
    files: [],
    reportingPeriod,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await mkdir(uploadsDirectory, { recursive: true });
    const metadataPath = path.join(directory, "workspace.json");
    const temporaryPath = path.join(directory, `workspace.${randomUUID()}.tmp`);
    await writeFile(temporaryPath, JSON.stringify(metadata, null, 2), { flag: "wx" });
    await rename(temporaryPath, metadataPath);
    return metadata;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function safeFilename(input: string): string | null {
  if (!input.trim() || input.includes("/") || input.includes("\\") || input.split(/[\\/]/).includes("..")) return null;
  const cleaned = input.trim().replace(/[\u0000-\u001f\u007f]/g, "").replace(/[^\p{L}\p{N} ._()\-]/gu, "_");
  const basename = path.basename(cleaned).replace(/^[. ]+|[. ]+$/g, "");
  return basename && basename !== "." && basename !== ".." ? basename : null;
}

function unusedFilename(filename: string, existing: string[]): string {
  const extension = path.extname(filename);
  const stem = filename.slice(0, filename.length - extension.length);
  const names = new Set(existing.map((name) => name.toLocaleLowerCase()));
  let candidate = filename;
  let suffix = 2;
  while (names.has(candidate.toLocaleLowerCase())) candidate = `${stem}-${suffix++}${extension}`;
  return candidate;
}

export async function uploadWorkspaceFile(request: Request, sessionId: string): Promise<Response> {
  const metadata = await getWorkspace(sessionId);
  if (!metadata) return Response.json({ error: "Workspace not found." }, { status: 404 });
  if (metadata.status !== "uploading") return Response.json({ error: "Workspace does not accept uploads in its current state." }, { status: 409 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
    return Response.json({ error: "Expected a multipart/form-data request." }, { status: 415 });
  }
  const maxFileBytes = positiveLimit("UPLOAD_MAX_FILE_BYTES", DEFAULT_MAX_FILE_BYTES);
  const maxRequestBytes = positiveLimit("WORKSPACE_MAX_REQUEST_BYTES", Math.min(DEFAULT_MAX_REQUEST_BYTES, maxFileBytes + 1024 * 1024));
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxRequestBytes)) {
    return Response.json({ error: `Upload request exceeds the ${maxRequestBytes}-byte limit.` }, { status: 413 });
  }

  if (!request.body) return Response.json({ error: "The request body is empty." }, { status: 400 });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bodyBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bodyBytes += value.byteLength;
      if (bodyBytes > maxRequestBytes) {
        return Response.json({ error: `Upload request exceeds the ${maxRequestBytes}-byte limit.` }, { status: 413 });
      }
      chunks.push(value);
    }
  } catch {
    return Response.json({ error: "Could not read multipart upload." }, { status: 400 });
  }
  const boundedBody = new Uint8Array(bodyBytes);
  let offset = 0;
  for (const chunk of chunks) {
    boundedBody.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let form: FormData;
  try {
    const boundedRequest = new Request(request.url, { method: "POST", headers: request.headers, body: boundedBody });
    form = await boundedRequest.formData();
  } catch {
    return Response.json({ error: "Could not parse multipart upload." }, { status: 400 });
  }
  const files = form.getAll("file");
  if (files.length !== 1 || !(files[0] instanceof File)) {
    return Response.json({ error: 'Upload exactly one file using the "file" form field.' }, { status: 400 });
  }
  const file = files[0];
  if (file.size === 0) return Response.json({ error: "The uploaded file is empty." }, { status: 400 });
  if (file.size > maxFileBytes) return Response.json({ error: `File exceeds the ${maxFileBytes}-byte limit.` }, { status: 413 });
  if (metadata.files.length >= positiveLimit("UPLOAD_MAX_FILES", DEFAULT_MAX_FILES)) {
    return Response.json({ error: "Workspace file-count limit reached." }, { status: 413 });
  }
  const filename = safeFilename(file.name);
  if (!filename) return Response.json({ error: "Filename is empty or contains a path separator." }, { status: 400 });
  const extension = path.extname(filename).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) return Response.json({ error: `Unsupported file type: ${extension || "(no extension)"}` }, { status: 415 });

  let reportingPeriod = metadata.reportingPeriod;
  const requestedPeriod = form.get("reportingPeriod");
  if (requestedPeriod !== null) {
    if (typeof requestedPeriod !== "string") return Response.json({ error: "reportingPeriod must be a text value." }, { status: 400 });
    const normalizedPeriod = normalizeReportingPeriod(requestedPeriod);
    if (!normalizedPeriod) return Response.json({ error: "reportingPeriod must contain a recognized month and year, for example August 2026." }, { status: 400 });
    if (reportingPeriod && reportingPeriod !== normalizedPeriod) {
      return Response.json({ error: "reportingPeriod must match the value set for this workspace." }, { status: 400 });
    }
    reportingPeriod = normalizedPeriod;
  }

  const maxWorkspaceBytes = positiveLimit("WORKSPACE_MAX_BYTES", DEFAULT_MAX_WORKSPACE_BYTES);
  let existingBytes = 0;
  const uploadsDirectory = path.join(workspacePath(sessionId), "uploads");
  try {
    for (const existingName of metadata.files) {
      existingBytes += (await stat(path.join(uploadsDirectory, existingName))).size;
    }
  } catch {
    return Response.json({ error: "Workspace file data is unavailable." }, { status: 500 });
  }
  if (existingBytes + file.size > maxWorkspaceBytes) {
    return Response.json({ error: `Workspace exceeds the ${maxWorkspaceBytes}-byte total size limit.` }, { status: 413 });
  }

  const savedName = unusedFilename(filename, metadata.files);
  const targetDirectory = path.join(workspacePath(sessionId), "uploads");
  const target = path.join(targetDirectory, savedName);
  const temporary = path.join(targetDirectory, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, new Uint8Array(await file.arrayBuffer()), { flag: "wx" });
    await rename(temporary, target);
    metadata.files.push(savedName);
    metadata.reportingPeriod = reportingPeriod;
    await persistWorkspace(metadata);
    return Response.json({ sessionId, fileCount: metadata.files.length, status: metadata.status });
  } catch (error) {
    await rm(temporary, { force: true });
    await rm(target, { force: true });
    const errorType = error instanceof Error ? error.name : "UnknownError";
    console.error(`[workspace] Could not save upload (${errorType}).`);
    return Response.json({ error: "Could not save uploaded file." }, { status: 500 });
  }
}

function publicResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicResult);
  if (!value || typeof value !== "object") return value;
  const hidden = new Set(["sourcepath", "sourcefile", "textpath", "resultpath", "uploaddirectory", "raw_source_text", "excerpt", "evidence"]);
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const normalized = key.toLowerCase();
    return hidden.has(normalized) || normalized.endsWith("path") ? [] : [[key, publicResult(item)]];
  }));
}

export async function getWorkspaceStatus(sessionId: string): Promise<Response> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
    return Response.json({ error: "Invalid workspace session ID." }, { status: 400 });
  }
  let metadata = await getWorkspace(sessionId);
  if (!metadata) return Response.json({ error: "Workspace not found." }, { status: 404 });
  if ((metadata.status === "queued" || metadata.status === "running") && !activeWorkspaces.has(sessionId)) {
    metadata = await updateWorkspace(sessionId, {
      status: "failed",
      error: "Workflow was interrupted by an application restart.",
    }) ?? metadata;
  }
  return Response.json({
    sessionId: metadata.sessionId,
    status: metadata.status,
    fileCount: metadata.files.length,
    workflowSessionId: metadata.workflowSessionId ?? null,
    result: metadata.status === "completed" ? publicResult(metadata.result) : null,
    error: metadata.status === "failed" ? metadata.error ?? "Workflow processing failed." : null,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
  });
}

async function runWorkspace(sessionId: string, from: ChannelFrom): Promise<void> {
  const metadata = await getWorkspace(sessionId);
  if (!metadata || metadata.status !== "queued") return;
  activeWorkspaces.add(sessionId);
  try {
    await updateWorkspace(sessionId, { status: "running" });
    const address = `workspace:${sessionId}`;
    const prompt = `Process the uploaded workspace at ${JSON.stringify(path.join(workspacePath(sessionId), "uploads"))}. Call process_folder exactly once. Report a brief result without reproducing document text.`;
    const delivery = await from(address).send(prompt, { auth: workspaceAuth });
    await updateWorkspace(sessionId, { workflowSessionId: delivery.sessionId });
    const outcome = await delivery.result();
    if (outcome.status !== "completed") throw new Error("Workflow did not complete successfully.");
    const resultPath = path.join(process.cwd(), "output", delivery.sessionId, "pipeline-results.json");
    const result = JSON.parse(await readFile(resultPath, "utf8")) as { sessionId?: unknown };
    if (result.sessionId !== delivery.sessionId) throw new Error("Workflow result did not match its session.");
    await updateWorkspace(sessionId, { status: "completed", result, workflowSessionId: delivery.sessionId, error: undefined });
  } catch (error) {
    const type = error instanceof Error ? error.name : "UnknownError";
    console.error(`[workspace] Workflow failed for ${sessionId} (${type}).`);
    await updateWorkspace(sessionId, { status: "failed", error: "Workflow processing failed." });
  } finally {
    activeWorkspaces.delete(sessionId);
  }
}

export async function startWorkspaceProcess(sessionId: string, from: ChannelFrom, waitUntil: (task: Promise<unknown>) => void): Promise<Response> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
    return Response.json({ error: "Invalid workspace session ID." }, { status: 400 });
  }
  if (startingWorkspaces.has(sessionId) || activeWorkspaces.has(sessionId)) {
    return Response.json({ error: "Workspace processing has already started." }, { status: 409 });
  }
  startingWorkspaces.add(sessionId);
  try {
    const metadata = await getWorkspace(sessionId);
    if (!metadata) return Response.json({ error: "Workspace not found." }, { status: 404 });
    if (metadata.status !== "uploading") return Response.json({ error: "Workspace has already started or finished processing." }, { status: 409 });
    if (metadata.files.length === 0) return Response.json({ error: "Upload at least one file before processing." }, { status: 400 });
    activeWorkspaces.add(sessionId);
    await updateWorkspace(sessionId, { status: "queued" });
    waitUntil(runWorkspace(sessionId, from));
    return Response.json({ sessionId, status: "queued" }, { status: 202 });
  } finally {
    startingWorkspaces.delete(sessionId);
  }
}

export async function createWorkspaceResponse(request: Request): Promise<Response> {
  let reportingPeriod: string | null = null;
  if (request.body) {
    let rawBody: string;
    try {
      rawBody = await request.text();
    } catch {
      return Response.json({ error: "Could not read workspace metadata." }, { status: 400 });
    }
    if (rawBody.trim()) {
      if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        return Response.json({ error: "Workspace metadata must use application/json." }, { status: 415 });
      }
      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        return Response.json({ error: "Could not parse workspace metadata JSON." }, { status: 400 });
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return Response.json({ error: "Workspace metadata must be a JSON object." }, { status: 400 });
      }
      const value = (body as Record<string, unknown>).reportingPeriod;
      if (value !== undefined) {
        if (typeof value !== "string") return Response.json({ error: "reportingPeriod must be a text value." }, { status: 400 });
        reportingPeriod = normalizeReportingPeriod(value);
        if (!reportingPeriod) return Response.json({ error: "reportingPeriod must contain a recognized month and year, for example August 2026." }, { status: 400 });
      }
    }
  }

  try {
    const workspace = await createWorkspace(reportingPeriod);
    return Response.json({ sessionId: workspace.sessionId, status: workspace.status }, { status: 201 });
  } catch (error) {
    const errorType = error instanceof Error ? error.name : "UnknownError";
    console.error(`[workspace] Could not create workspace (${errorType}).`);
    return Response.json({ error: "Could not create workspace." }, { status: 500 });
  }
}
