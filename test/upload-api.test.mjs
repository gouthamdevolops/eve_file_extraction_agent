import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getRunStatus, receiveUpload } from "../.test-dist/agent/lib/upload-api.js";

let root;
const originalEnv = {};
const testOutputDirectories = new Set();

async function setup() {
  root = await mkdtemp(path.join(os.tmpdir(), "eve-upload-api-"));
  originalEnv.DATA_DIR = process.env.DATA_DIR;
  process.env.DATA_DIR = root;
  for (const [key, value] of Object.entries({
    UPLOAD_MAX_FILES: "20",
    UPLOAD_MAX_FILE_BYTES: String(25 * 1024 * 1024),
    UPLOAD_MAX_REQUEST_BYTES: String(100 * 1024 * 1024),
  })) {
    originalEnv[key] = process.env[key];
    process.env[key] = value;
  }
}

async function teardown() {
  await rm(root, { recursive: true, force: true });
  for (const directory of testOutputDirectories) await rm(directory, { recursive: true, force: true });
  testOutputDirectories.clear();
  if (originalEnv.DATA_DIR === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalEnv.DATA_DIR;
  for (const key of ["UPLOAD_MAX_FILES", "UPLOAD_MAX_FILE_BYTES", "UPLOAD_MAX_REQUEST_BYTES"]) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
}

function requestWithFiles(files, reportingPeriod) {
  const form = new FormData();
  for (const { name, contents = "%PDF-1.4 test" } of files) {
    form.append("files", new File([contents], name, { type: "application/pdf" }));
  }
  if (reportingPeriod !== undefined && reportingPeriod !== null) form.append("reportingPeriod", reportingPeriod);
  return new Request("http://localhost/api/runs", { method: "POST", body: form });
}

function mockChannelFrom(deliveryOutcome, sessionId = `test-${randomUUID()}`, onSend = () => {}, pipelineResult) {
  return (address) => ({
    send: async (message, options) => {
      await onSend({ address, message, options });
      const outputDirectory = path.join(process.cwd(), "output", sessionId);
      testOutputDirectories.add(outputDirectory);
      await mkdir(outputDirectory, { recursive: true });
      await writeFile(path.join(outputDirectory, "pipeline-results.json"), JSON.stringify(pipelineResult ?? { sessionId, resultPath: "/private/result.json", documents: [] }));
      return { sessionId, result: async () => ({ sessionId, ...deliveryOutcome }) };
    },
  });
}

async function submit(files, from = mockChannelFrom({ status: "completed", outcome: "handled" }), reportingPeriod = "August 2026") {
  const tasks = [];
  const response = await receiveUpload(requestWithFiles(files, reportingPeriod), from, (task) => tasks.push(task));
  return { response, tasks, from };
}

await test("rejects requests that are not multipart form data", async () => {
  await setup();
  try {
    const response = await receiveUpload(new Request("http://localhost/api/runs", { method: "POST", body: "not multipart" }), async () => ({}), () => {});
    assert.equal(response.status, 415);
    assert.deepEqual(await response.json(), { error: "Expected a multipart/form-data request." });
  } finally { await teardown(); }
});

await test("rejects missing, unsupported, and invalid-period inputs", async () => {
  await setup();
  try {
    const emptyFormResponse = await receiveUpload(new Request("http://localhost/api/runs", { method: "POST", body: new FormData() }), async () => ({}), () => {});
    assert.equal(emptyFormResponse.status, 400);

    let defaultPeriodInstruction;
    const defaultPeriod = await submit(
      [{ name: "payload.pdf" }],
      mockChannelFrom({ status: "completed", outcome: "handled" }, undefined, ({ message }) => { defaultPeriodInstruction = message; }),
      null,
    );
    assert.equal(defaultPeriod.response.status, 202);
    await defaultPeriod.tasks[0];
    assert.match(defaultPeriodInstruction, /August 2026/);

    const unsupported = await submit([{ name: "payload.exe" }]);
    assert.equal(unsupported.response.status, 415);

    const invalidPeriod = await submit([{ name: "payload.pdf" }], undefined, "sometime last year");
    assert.equal(invalidPeriod.response.status, 400);
  } finally { await teardown(); }
});

await test("applies count and per-file limits", async () => {
  await setup();
  try {
    process.env.UPLOAD_MAX_FILES = "1";
    const tooMany = await submit([{ name: "one.pdf" }, { name: "two.pdf" }]);
    assert.equal(tooMany.response.status, 413);

    process.env.UPLOAD_MAX_FILES = "20";
    process.env.UPLOAD_MAX_FILE_BYTES = "3";
    const tooLarge = await submit([{ name: "large.pdf", contents: "1234" }]);
    assert.equal(tooLarge.response.status, 413);

    process.env.UPLOAD_MAX_FILE_BYTES = "10000";
    process.env.UPLOAD_MAX_REQUEST_BYTES = "100";
    const requestTooLarge = await submit([{ name: "payload.pdf", contents: "x".repeat(200) }]);
    assert.equal(requestTooLarge.response.status, 413);

    const chunkedRequest = new Request("http://localhost/api/runs", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=test" },
      body: new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(101)); } }),
      duplex: "half",
    });
    const chunkedTooLarge = await receiveUpload(chunkedRequest, async () => ({}), () => {});
    assert.equal(chunkedTooLarge.status, 413);
  } finally { await teardown(); }
});

await test("rejects traversal filenames and accepts duplicate basenames without overwrite", async () => {
  await setup();
  try {
    const traversal = await submit([{ name: "../outside.pdf" }]);
    assert.equal(traversal.response.status, 400);

    const result = await submit([{ name: "report.pdf", contents: "first" }, { name: "report.pdf", contents: "second" }]);
    assert.equal(result.response.status, 202);
    const { runId } = await result.response.json();
    const directory = path.join(root, "uploads", runId);
    assert.deepEqual((await readdir(directory)).sort(), ["report-2.pdf", "report.pdf"]);
    assert.equal(await readFile(path.join(directory, "report.pdf"), "utf8"), "first");
    assert.equal(await readFile(path.join(directory, "report-2.pdf"), "utf8"), "second");
    assert.equal((await result.tasks[0]), undefined);
  } finally { await teardown(); }
});

await test("keeps concurrent uploads isolated in separate run directories", async () => {
  await setup();
  try {
    const [first, second] = await Promise.all([
      submit([{ name: "same.pdf", contents: "first" }]),
      submit([{ name: "same.pdf", contents: "second" }]),
    ]);
    const firstId = (await first.response.json()).runId;
    const secondId = (await second.response.json()).runId;
    assert.notEqual(firstId, secondId);
    assert.equal(await readFile(path.join(root, "uploads", firstId, "same.pdf"), "utf8"), "first");
    assert.equal(await readFile(path.join(root, "uploads", secondId, "same.pdf"), "utf8"), "second");
    await Promise.all([...first.tasks, ...second.tasks]);
  } finally { await teardown(); }
});

await test("persists queued/running/completed state and returns a redacted result", async () => {
  await setup();
  try {
    let sentMessage;
    const fakeSessionId = `test-${randomUUID()}`;
    const result = await submit(
      [{ name: "report.pdf" }],
      mockChannelFrom(
        { status: "completed", outcome: "handled" },
        fakeSessionId,
        (sent) => { sentMessage = sent; },
        {
          sessionId: fakeSessionId,
          resultPath: "/app/output/private.json",
          documents: [{ sourcePath: "/data/uploads/private/report.pdf", raw_source_text: "secret text", value: 42 }],
        },
      ),
      "August 2026",
    );
    assert.equal(result.response.status, 202);
    const { runId, status } = await result.response.json();
    assert.equal(status, "queued");

    const queued = await getRunStatus(runId);
    assert.equal((await queued.json()).status, "queued");
    await result.tasks[0];
    assert.equal(sentMessage.address, runId);
    assert.ok(sentMessage.message.includes(JSON.stringify(path.join(root, "uploads", runId))));
    assert.match(sentMessage.message, /August 2026/);
    assert.equal(sentMessage.options.auth.principalType, "service");

    const completed = await getRunStatus(runId);
    const body = await completed.json();
    assert.equal(body.status, "completed");
    assert.equal(body.workflowSessionId, fakeSessionId);
    assert.equal(body.result.documents[0].value, 42);
    assert.equal(JSON.stringify(body).includes("/data/uploads"), false);
    assert.equal(JSON.stringify(body).includes("secret text"), false);
    const persisted = JSON.parse(await readFile(path.join(root, "runs", runId, "run.json"), "utf8"));
    assert.equal(persisted.status, "completed");
    assert.equal(persisted.workflowSessionId, fakeSessionId);
  } finally { await teardown(); }
});

await test("persists generic failures and handles malformed/unknown run IDs", async () => {
  await setup();
  try {
    const result = await submit([{ name: "report.pdf" }], mockChannelFrom({ status: "failed", outcome: "failed", error: { message: "sensitive internal error" } }));
    const { runId } = await result.response.json();
    await result.tasks[0];
    const failed = await getRunStatus(runId);
    assert.equal(failed.status, 200);
    assert.deepEqual((await failed.json()).error, "Workflow processing failed.");

    const malformed = await getRunStatus("../../etc/passwd");
    assert.equal(malformed.status, 400);
    const missing = await getRunStatus("123e4567-e89b-42d3-a456-426614174000");
    assert.equal(missing.status, 404);
  } finally { await teardown(); }
});

await test("marks interrupted runs failed after restart recovery", async () => {
  await setup();
  try {
    const runId = "123e4567-e89b-42d3-a456-426614174000";
    const runDirectory = path.join(root, "runs", runId);
    await import("node:fs/promises").then(({ mkdir }) => mkdir(runDirectory, { recursive: true }));
    await writeFile(path.join(runDirectory, "run.json"), JSON.stringify({
      runId, status: "running", files: [], uploadDirectory: "unused", reportingPeriod: null, createdAt: new Date().toISOString(),
    }));
    const response = await getRunStatus(runId);
    const body = await response.json();
    assert.equal(body.status, "failed");
    assert.equal(body.error, "Workflow was interrupted by an application restart.");
  } finally { await teardown(); }
});
