import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const baseUrl = (process.env.API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const fixturePath = path.resolve(process.argv[2] ?? "test/fixtures/api-smoke.pdf");
const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? 3000);
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 10 * 60 * 1000);

const fixture = await readFile(fixturePath);
const form = new FormData();
form.append("files", new Blob([fixture], { type: "application/pdf" }), path.basename(fixturePath));
form.append("reportingPeriod", "August 2026");

const uploadResponse = await fetch(`${baseUrl}/api/runs`, { method: "POST", body: form });
const uploadBody = await uploadResponse.json();
if (uploadResponse.status !== 202) {
  throw new Error(`Upload failed (${uploadResponse.status}): ${uploadBody.error ?? "unexpected response"}`);
}
console.log(`Created run ${uploadBody.runId}; polling for completion...`);

const deadline = Date.now() + timeoutMs;
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  const response = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(uploadBody.runId)}`);
  const status = await response.json();
  if (!response.ok) throw new Error(`Status request failed (${response.status}): ${status.error ?? "unexpected response"}`);
  console.log(`Run status: ${status.status}`);
  if (status.status === "completed") {
    console.log("Smoke test passed: uploaded fixture was processed and a structured result was retrieved.");
    process.exit(0);
  }
  if (status.status === "failed") throw new Error(`Workflow failed: ${status.error ?? "unknown failure"}`);
}
throw new Error(`Timed out waiting for run ${uploadBody.runId} after ${timeoutMs}ms.`);
