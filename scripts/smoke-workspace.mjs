import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const baseUrl = (process.env.WORKSPACE_API_BASE_URL ?? "http://127.0.0.1:2000").replace(/\/$/, "");
const defaults = ["test/fixtures/api-smoke.pdf", "test/fixtures/api-smoke.pdf"];
const fixturePaths = process.argv.length > 2 ? process.argv.slice(2) : defaults;
const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? 2500);
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 10 * 60 * 1000);

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${url} failed (${response.status}): ${body.error ?? "unexpected response"}`);
  return { response, body };
}

const created = await requestJson(`${baseUrl}/workspace`, { method: "POST" });
const { sessionId } = created.body;
if (!sessionId) throw new Error("Workspace creation did not return a sessionId.");
console.log(`Workspace created: ${sessionId}`);

for (const fixturePath of fixturePaths) {
  const bytes = await readFile(path.resolve(fixturePath));
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/pdf" }), path.basename(fixturePath));
  const uploaded = await requestJson(`${baseUrl}/workspace/${encodeURIComponent(sessionId)}/uploads`, { method: "POST", body: form });
  const observed = await requestJson(`${baseUrl}/workspace/${encodeURIComponent(sessionId)}`);
  if (observed.body.status !== "uploading") throw new Error(`Workspace unexpectedly left uploading state before explicit process request (${observed.body.status}).`);
  console.log(`Uploaded ${path.basename(fixturePath)}; confirmed ${uploaded.body.fileCount}; state remains ${observed.body.status}.`);
}

const started = await requestJson(`${baseUrl}/workspace/${encodeURIComponent(sessionId)}/process`, { method: "POST" });
if (started.response.status !== 202 || started.body.status !== "queued") throw new Error("Process request was not accepted as queued.");
console.log("Workflow explicitly started; polling workspace status...");

const deadline = Date.now() + timeoutMs;
let finalStatus;
while (Date.now() < deadline) {
  const { body } = await requestJson(`${baseUrl}/workspace/${encodeURIComponent(sessionId)}`);
  console.log(`Workflow status: ${body.status}`);
  if (body.status === "completed" || body.status === "failed") { finalStatus = body; break; }
  await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
}
if (!finalStatus) throw new Error(`Timed out waiting for workspace ${sessionId}.`);
if (finalStatus.status === "failed") throw new Error(`Workflow failed: ${finalStatus.error ?? "safe failure"}`);

const outcomes = Array.isArray(finalStatus.result?.extractionResults) ? finalStatus.result.extractionResults : [];
const summary = {
  sessionId,
  status: finalStatus.status,
  fileCount: finalStatus.fileCount,
  outcomes: outcomes.map((entry) => ({ name: entry.sourceName ?? "(unknown)", status: entry.status ?? "unknown", reason: entry.reason ?? null })),
};
console.log("Final document outcomes:");
console.log(JSON.stringify(summary, null, 2));
if (process.env.SMOKE_REPORT_PATH) {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const report = path.resolve(process.env.SMOKE_REPORT_PATH);
  await mkdir(path.dirname(report), { recursive: true });
  await writeFile(report, `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
  console.log(`Outcome report saved to ${report}`);
}
