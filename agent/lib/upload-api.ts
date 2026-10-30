import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChannelFrom } from "eve/channels";
import { SUPPORTED_EXTENSIONS } from "./document-preparation.js";
import { normalizeReportingPeriod } from "./reporting-period.js";

const DEFAULT_MAX_FILES = 20;
const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;
const DEFAULT_REPORTING_PERIOD = "August 2026";
const DEFAULT_MAX_REQUEST_BYTES = 100 * 1024 * 1024;
const apiAuth = {
  authenticator: "local-upload-api",
  principalId: "local-upload-api",
  principalType: "service",
  attributes: { source: "local-upload-api" },
} as const;

type RunStatus = "queued" | "running" | "completed" | "failed";
type RunMetadata = {
  runId: string;
  status: RunStatus;
  uploadDirectory: string;
  reportingPeriod: string | null;
  files: string[];
  createdAt: string;
  updatedAt?: string;
  workflowSessionId?: string;
  result?: unknown;
  error?: string;
};

const activeRunIds = new Set<string>();
let recoveryPromise: Promise<void> | undefined;

async function recoverInterruptedRuns(): Promise<void> {
  recoveryPromise ??= (async () => {
    const runsDirectory = path.join(dataRoot(), "runs");
    let entries;
    try {
      entries = await readdir(runsDirectory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || activeRunIds.has(entry.name)) continue;
      const existing = await getRunMetadata(entry.name);
      if (existing?.status === "queued" || existing?.status === "running") {
        existing.status = "failed";
        existing.error = "Workflow was interrupted by an application restart.";
        existing.updatedAt = new Date().toISOString();
        await persistRun(existing);
      }
    }
  })();
  try {
    await recoveryPromise;
  } finally {
    recoveryPromise = undefined;
  }
}

function positiveLimit(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function safeDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown workflow error";
  return message
    .replace(/\b(?:sk|or)-[A-Za-z0-9_-]{12,}\b/g, "[redacted credential]")
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:data|app|home)\/)[^\s"'`]*/gi, "[redacted path]")
    .slice(0, 500);
}

function safeFilename(input: string): string | null {
  if (!input.trim() || input.includes("/") || input.includes("\\") || input.split(/[\\/]/).includes("..")) return null;
  const cleaned = input.trim().replace(/[\u0000-\u001f\u007f]/g, "").replace(/[^\p{L}\p{N} ._()\-]/gu, "_");
  const basename = path.basename(cleaned).replace(/^[. ]+|[. ]+$/g, "");
  return basename && basename !== "." && basename !== ".." ? basename : null;
}

function unusedName(name: string, existing: Set<string>): string {
  const extension = path.extname(name);
  const stem = name.slice(0, name.length - extension.length);
  let candidate = name;
  let suffix = 2;
  while (existing.has(candidate.toLocaleLowerCase())) candidate = `${stem}-${suffix++}${extension}`;
  existing.add(candidate.toLocaleLowerCase());
  return candidate;
}

function dataRoot(): string {
  return path.resolve(process.env.DATA_DIR || "/data");
}

async function persistRun(metadata: RunMetadata): Promise<void> {
  const directory = path.join(dataRoot(), "runs", metadata.runId);
  await mkdir(directory, { recursive: true });
  const destination = path.join(directory, "run.json");
  const temporary = path.join(directory, `run.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(metadata, null, 2), { flag: "wx" });
  await rename(temporary, destination);
}

export async function executeUploadedRun(
  metadata: RunMetadata,
  from: ChannelFrom,
): Promise<void> {
  const update = async (patch: Partial<RunMetadata>) => {
    Object.assign(metadata, patch, { updatedAt: new Date().toISOString() });
    await persistRun(metadata);
  };

  activeRunIds.add(metadata.runId);
  try {
    await update({ status: "running" });
    const instruction = [
      "Process this API-uploaded document batch now. You must call the process_folder tool exactly once.",
      `Use folderPath exactly as ${JSON.stringify(metadata.uploadDirectory)}.`,
      ...(metadata.reportingPeriod ? [`Use reportingPeriod exactly as ${JSON.stringify(metadata.reportingPeriod)}.`] : []),
      "Do not ask the user questions. Do not substitute another path or report completion unless the tool succeeds.",
      "After the tool finishes, give a brief confirmation without reproducing extracted document text.",
    ].join(" ");
    const delivery = await from(metadata.runId).send(instruction, { auth: apiAuth });
    await update({ workflowSessionId: delivery.sessionId });
    const outcome = await delivery.result();
    if (outcome.status === "failed") throw new Error(outcome.error.message);
    if (outcome.status !== "completed") throw new Error(`Agent delivery ended with ${outcome.status} (${outcome.outcome}).`);

    const resultPath = path.join(process.cwd(), "output", delivery.sessionId, "pipeline-results.json");
    const result = JSON.parse(await readFile(resultPath, "utf8")) as { sessionId?: unknown };
    if (result.sessionId !== delivery.sessionId) throw new Error("Workflow result did not match the Eve session.");
    await update({ status: "completed", result, workflowSessionId: delivery.sessionId, error: undefined });
  } catch (error) {
    // Keep API-visible failure messages generic; detailed errors are logged without input contents.
    const diagnosticType = error instanceof Error ? error.name : "UnknownError";
    console.error(`[upload-api] Workflow failed for run ${metadata.runId} (${diagnosticType}): ${safeDiagnostic(error)}`);
    try {
      await update({ status: "failed", error: "Workflow processing failed." });
    } catch (persistError) {
      console.error(`[upload-api] Could not persist failed state for run ${metadata.runId}:`, persistError);
    }
  } finally {
    activeRunIds.delete(metadata.runId);
  }
}

export async function receiveUpload(request: Request, from: ChannelFrom, waitUntil: (task: Promise<unknown>) => void): Promise<Response> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
    return json({ error: "Expected a multipart/form-data request." }, 415);
  }

  const maxRequestBytes = positiveLimit("UPLOAD_MAX_REQUEST_BYTES", DEFAULT_MAX_REQUEST_BYTES);
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxRequestBytes)) {
    return json({ error: `Upload request exceeds the ${maxRequestBytes}-byte request limit.` }, 413);
  }
  if (!request.body) return json({ error: "The request body is empty." }, 400);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Could not parse multipart upload." }, 400);
  }

  const uploads = form.getAll("files");
  const maxFiles = positiveLimit("UPLOAD_MAX_FILES", DEFAULT_MAX_FILES);
  const maxFileBytes = positiveLimit("UPLOAD_MAX_FILE_BYTES", DEFAULT_MAX_FILE_BYTES);
  if (uploads.length === 0 || uploads.some((item) => !(item instanceof File))) {
    return json({ error: 'Upload one or more files using the "files" form field.' }, 400);
  }
  if (uploads.length > maxFiles) return json({ error: `At most ${maxFiles} files may be uploaded per run.` }, 413);
  const totalFileBytes = uploads.reduce((total, item) => total + (item instanceof File ? item.size : 0), 0);
  if (totalFileBytes > maxRequestBytes) return json({ error: `Upload request exceeds the ${maxRequestBytes}-byte request limit.` }, 413);

  const requestedPeriod = form.get("reportingPeriod");
  if (requestedPeriod !== null && typeof requestedPeriod !== "string") return json({ error: "reportingPeriod must be a text field." }, 400);
  const reportingPeriod = requestedPeriod === null
    ? DEFAULT_REPORTING_PERIOD
    : normalizeReportingPeriod(requestedPeriod);
  if (!reportingPeriod) {
    return json({ error: "reportingPeriod must contain a recognized month and year, for example August 2026." }, 400);
  }

  const accepted: Array<{ file: File; name: string }> = [];
  const names = new Set<string>();
  for (const item of uploads) {
    const file = item as File;
    const name = safeFilename(file.name);
    if (!name) return json({ error: "A filename is empty or contains a path separator." }, 400);
    const extension = path.extname(name).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) return json({ error: `Unsupported file type: ${extension || "(no extension)"}` }, 415);
    if (file.size === 0) return json({ error: `File "${name}" is empty.` }, 400);
    if (file.size > maxFileBytes) return json({ error: `File "${name}" exceeds the ${maxFileBytes}-byte per-file limit.` }, 413);
    accepted.push({ file, name: unusedName(name, names) });
  }

  await recoverInterruptedRuns();

  const runId = randomUUID();
  const uploadDirectory = path.join(dataRoot(), "uploads", runId);
  const runDirectory = path.join(dataRoot(), "runs", runId);
  const metadata: RunMetadata = {
    runId,
    status: "queued",
    uploadDirectory,
    reportingPeriod,
    files: accepted.map(({ name }) => name),
    createdAt: new Date().toISOString(),
  };

  try {
    await mkdir(uploadDirectory, { recursive: true });
    await mkdir(runDirectory, { recursive: true });
    for (const { file, name } of accepted) {
      await writeFile(path.join(uploadDirectory, name), new Uint8Array(await file.arrayBuffer()), { flag: "wx" });
    }
    await persistRun(metadata);
  } catch (error) {
    await Promise.all([rm(uploadDirectory, { recursive: true, force: true }), rm(runDirectory, { recursive: true, force: true })]);
    console.error(`[upload-api] Failed to persist run ${runId}:`, error);
    return json({ error: "Could not save uploaded files." }, 500);
  }

  activeRunIds.add(runId);
  waitUntil(executeUploadedRun(metadata, from));
  return json({ runId, status: "queued" }, 202);
}

export async function getRunMetadata(runId: string): Promise<RunMetadata | null> {
  try {
    const contents = await readFile(path.join(dataRoot(), "runs", runId, "run.json"), "utf8");
    const metadata = JSON.parse(contents) as RunMetadata;
    return metadata.runId === runId ? metadata : null;
  } catch {
    return null;
  }
}

function publicResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicResult);
  if (!value || typeof value !== "object") return value;

  const hiddenKeys = new Set([
    "sourcepath", "sourcefile", "textpath", "resultpath", "uploaddirectory",
    "raw_source_text", "excerpt", "evidence", "reportingperiodevidence",
  ]);
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const normalizedKey = key.toLowerCase();
    if (hiddenKeys.has(normalizedKey) || normalizedKey.endsWith("path")) return [];
    return [[key, publicResult(item)]];
  }));
}

export async function getRunStatus(runId: string): Promise<Response> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
    return json({ error: "Invalid run ID." }, 400);
  }

  try {
    await recoverInterruptedRuns();
    const metadata = await getRunMetadata(runId);
    if (!metadata) return json({ error: "Run not found." }, 404);

    return json({
      runId: metadata.runId,
      status: metadata.status,
      workflowSessionId: metadata.workflowSessionId ?? null,
      result: metadata.status === "completed" ? publicResult(metadata.result) : null,
      error: metadata.status === "failed" ? metadata.error ?? "Workflow processing failed." : null,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt ?? null,
    });
  } catch (error) {
    const errorType = error instanceof Error ? error.name : "UnknownError";
    console.error(`[upload-api] Could not read run status (${errorType}).`);
    return json({ error: "Could not retrieve run status." }, 500);
  }
}
