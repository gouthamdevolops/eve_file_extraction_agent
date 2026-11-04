import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createWorkspace,
  createWorkspaceResponse,
  getWorkspaceStatus,
  listWorkspaces,
  startWorkspaceProcess,
  updateWorkspace,
  uploadWorkspaceFile,
} from "../.test-dist/agent/lib/workspace.js";

const historyFixture = JSON.parse(await readFile(new URL("./fixtures/workspace-history.json", import.meta.url), "utf8"));

async function seedHistoryRecords(root, records = historyFixture.records) {
  const workspaceRoot = path.join(root, "workspaces");
  await mkdir(workspaceRoot, { recursive: true });
  for (const { metadata } of records) {
    const directory = path.join(workspaceRoot, metadata.sessionId);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "workspace.json"), JSON.stringify(metadata, null, 2));
  }
  return workspaceRoot;
}

async function collectionRequest(query = "") {
  return listWorkspaces(new Request(`http://localhost/workspace${query}`));
}

await test("creates a persistent workspace and returns its session ID", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "eve-workspace-"));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = root;
  try {
    const response = await createWorkspaceResponse(new Request("http://localhost/workspace", { method: "POST" }));
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.match(body.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(body.status, "uploading");

    const directory = path.join(root, "workspaces", body.sessionId);
    assert.equal((await stat(path.join(directory, "uploads"))).isDirectory(), true);
    const metadata = JSON.parse(await readFile(path.join(directory, "workspace.json"), "utf8"));
    assert.equal(metadata.sessionId, body.sessionId);
    assert.equal(metadata.status, "uploading");
    assert.deepEqual(metadata.files, []);
    assert.deepEqual(await readdir(path.join(root, "workspaces")), [body.sessionId]);

    const powershellStyleEmptyPost = await createWorkspaceResponse(new Request("http://localhost/workspace", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "",
    }));
    assert.equal(powershellStyleEmptyPost.status, 201);
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  }
});

await test("uploads one valid file into its workspace and returns workspace status", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "eve-workspace-"));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = root;
  try {
    const workspace = await createWorkspace();
    const form = new FormData();
    form.append("file", new File(["%PDF-1.4 test"], "sample.pdf", { type: "application/pdf" }));
    form.append("reportingPeriod", "August 2026");
    const response = await uploadWorkspaceFile(new Request("http://localhost/workspace/uploads", { method: "POST", body: form }), workspace.sessionId);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { sessionId: workspace.sessionId, fileCount: 1, status: "uploading" });
    assert.equal(await readFile(path.join(root, "workspaces", workspace.sessionId, "uploads", "sample.pdf"), "utf8"), "%PDF-1.4 test");
    const savedMetadata = JSON.parse(await readFile(path.join(root, "workspaces", workspace.sessionId, "workspace.json"), "utf8"));
    assert.equal(savedMetadata.reportingPeriod, "August 2026");

    const status = await getWorkspaceStatus(workspace.sessionId);
    assert.equal(status.status, 200);
    assert.equal((await status.json()).fileCount, 1);
    assert.equal((await getWorkspaceStatus("../../escape")).status, 400);
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  }
});

await test("enforces request and total workspace size limits", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "eve-workspace-"));
  const previousDataDir = process.env.DATA_DIR;
  const previousWorkspaceBytes = process.env.WORKSPACE_MAX_BYTES;
  const previousRequestBytes = process.env.WORKSPACE_MAX_REQUEST_BYTES;
  process.env.DATA_DIR = root;
  try {
    const workspace = await createWorkspace();
    process.env.WORKSPACE_MAX_BYTES = "10";
    const form = new FormData();
    form.append("file", new File(["12345678901"], "large.pdf", { type: "application/pdf" }));
    const workspaceTooLarge = await uploadWorkspaceFile(new Request("http://localhost/uploads", { method: "POST", body: form }), workspace.sessionId);
    assert.equal(workspaceTooLarge.status, 413);
    assert.deepEqual((await getWorkspaceStatus(workspace.sessionId)).status, 200);
    const metadata = JSON.parse(await readFile(path.join(root, "workspaces", workspace.sessionId, "workspace.json"), "utf8"));
    assert.deepEqual(metadata.files, []);

    process.env.WORKSPACE_MAX_REQUEST_BYTES = "100";
    const chunkedRequest = new Request("http://localhost/uploads", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=test" },
      body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(101)); } }),
      duplex: "half",
    });
    const requestTooLarge = await uploadWorkspaceFile(chunkedRequest, workspace.sessionId);
    assert.equal(requestTooLarge.status, 413);
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    if (previousWorkspaceBytes === undefined) delete process.env.WORKSPACE_MAX_BYTES;
    else process.env.WORKSPACE_MAX_BYTES = previousWorkspaceBytes;
    if (previousRequestBytes === undefined) delete process.env.WORKSPACE_MAX_REQUEST_BYTES;
    else process.env.WORKSPACE_MAX_REQUEST_BYTES = previousRequestBytes;
    await rm(root, { recursive: true, force: true });
  }
});

await test("starts workspace processing once and returns completed job status", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "eve-workspace-"));
  const previousDataDir = process.env.DATA_DIR;
  const workflowSessionId = `workspace-test-${Date.now()}`;
  const outputDirectory = path.join(process.cwd(), "output", workflowSessionId);
  process.env.DATA_DIR = root;
  try {
    const workspace = await createWorkspace();
    const form = new FormData();
    form.append("file", new File(["%PDF-1.4 test"], "sample.pdf", { type: "application/pdf" }));
    const upload = await uploadWorkspaceFile(new Request("http://localhost/uploads", { method: "POST", body: form }), workspace.sessionId);
    assert.equal(upload.status, 200);

    const tasks = [];
    const from = () => ({
      send: async () => {
        await mkdir(outputDirectory, { recursive: true });
        await writeFile(path.join(outputDirectory, "pipeline-results.json"), JSON.stringify({ sessionId: workflowSessionId, result: { count: 1 } }));
        return { sessionId: workflowSessionId, result: async () => ({ status: "completed", outcome: "handled" }) };
      },
    });
    const started = await startWorkspaceProcess(workspace.sessionId, from, (task) => tasks.push(task));
    assert.equal(started.status, 202);
    assert.equal((await started.json()).status, "queued");
    assert.equal((await startWorkspaceProcess(workspace.sessionId, from, (task) => tasks.push(task))).status, 409);
    await Promise.all(tasks);

    const status = await getWorkspaceStatus(workspace.sessionId);
    const result = await status.json();
    assert.equal(result.status, "completed");
    assert.equal(result.workflowSessionId, workflowSessionId);
    assert.deepEqual(result.result, { sessionId: workflowSessionId, result: { count: 1 } });
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

await test("preserves a sanitized workflow failure reason for the workspace UI", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "eve-workspace-"));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = root;
  try {
    const workspace = await createWorkspace();
    const form = new FormData();
    form.append("file", new File(["%PDF-1.4 test"], "sample.pdf", { type: "application/pdf" }));
    await uploadWorkspaceFile(new Request("http://localhost/uploads", { method: "POST", body: form }), workspace.sessionId);
    const tasks = [];
    const from = () => ({ send: async () => { throw new Error("Parser failed for /tmp/private.pdf token=abc123"); } });
    await startWorkspaceProcess(workspace.sessionId, from, (task) => tasks.push(task));
    await Promise.all(tasks);
    const response = await getWorkspaceStatus(workspace.sessionId);
    const body = await response.json();
    assert.equal(body.status, "failed");
    assert.equal(body.error, "Parser failed for [path redacted] token=[redacted]");
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  }
});

await test("marks unfinished workspace jobs failed after restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "eve-workspace-"));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = root;
  try {
    const workspace = await createWorkspace();
    await updateWorkspace(workspace.sessionId, { status: "running" });
    const response = await getWorkspaceStatus(workspace.sessionId);
    const body = await response.json();
    assert.equal(body.status, "failed");
    assert.equal(body.error, "Workflow was interrupted by an application restart.");
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  }
});

await test("uses the selected batch period for mixed and all-skipped results and keeps ambiguous periods unknown", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "eve-history-"));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = root;
  try {
    const allSkipped = structuredClone(historyFixture.edgeCases.allSkippedKnownBatch);
    allSkipped.reportingPeriod = "July 2026";
    const mixed = historyFixture.edgeCases.mixedPeriodBatch;
    const ambiguous = historyFixture.edgeCases.ambiguousBatch;
    const records = [
      { metadata: allSkipped },
      { metadata: mixed },
      { metadata: ambiguous },
    ];
    await seedHistoryRecords(root, records);
    const body = await (await collectionRequest()).json();
    const byId = new Map(body.workspaces.map((workspace) => [workspace.sessionId, workspace]));
    assert.equal(body.total, 3);
    assert.deepEqual(byId.get(allSkipped.sessionId), allSkipped.expectedSummary);
    assert.deepEqual(byId.get(mixed.sessionId), mixed.expectedSummary);
    assert.equal(byId.get(ambiguous.sessionId).reportingYear, null);
    assert.equal(byId.get(ambiguous.sessionId).reportingMonth, null);
    assert.equal((await (await collectionRequest("?year=2026&month=5")).json()).total, 1);
    assert.equal((await (await collectionRequest("?year=2026&month=8")).json()).total, 1);
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  }
});

await test("lists workspace summaries by actual result reporting period without writes or sensitive data", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "eve-history-"));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = root;
  try {
    const workspaceRoot = await seedHistoryRecords(root);
    const aPath = path.join(workspaceRoot, historyFixture.records[0].metadata.sessionId, "workspace.json");
    const aMetadata = JSON.parse(await readFile(aPath, "utf8"));
    aMetadata.workflowSessionId = "private-workflow-session";
    aMetadata.error = "private failure /secret/private.pdf";
    aMetadata.result.privatePath = "/secret/private-result.json";
    await writeFile(aPath, JSON.stringify(aMetadata, null, 2));
    const metadataPaths = historyFixture.records.map(({ metadata }) => path.join(workspaceRoot, metadata.sessionId, "workspace.json"));
    const before = await Promise.all(metadataPaths.map((filePath) => readFile(filePath)));

    const unfilteredResponse = await collectionRequest();
    assert.equal(unfilteredResponse.status, 200);
    assert.equal(unfilteredResponse.headers.get("cache-control"), "no-store");
    const unfiltered = await unfilteredResponse.json();
    assert.deepEqual(unfiltered, historyFixture.responses.unfiltered);
    assert.equal(new Set(unfiltered.workspaces.map((workspace) => workspace.sessionId)).size, 6);

    const augustResponse = await collectionRequest("?year=2026&month=8");
    const august = await augustResponse.json();
    assert.equal(august.total, 2);
    assert.deepEqual(august.workspaces.map((workspace) => workspace.sessionId), historyFixture.responses.august2026.workspaces.map((workspace) => workspace.sessionId));
    assert.equal(august.workspaces.some((workspace) => workspace.sessionId === historyFixture.records[0].metadata.sessionId), true);
    assert.equal(august.workspaces.some((workspace) => workspace.sessionId === historyFixture.records[1].metadata.sessionId), true);
    assert.deepEqual((await (await collectionRequest("?year=2026")).json()), historyFixture.responses.year2026);
    assert.deepEqual((await (await collectionRequest("?month=8")).json()), historyFixture.responses.month8);
    assert.deepEqual((await (await collectionRequest("?year=2025&month=8")).json()).workspaces.map((workspace) => workspace.sessionId), [historyFixture.records[3].metadata.sessionId]);
    assert.deepEqual((await (await collectionRequest("?year=2026&month=9")).json()).workspaces.map((workspace) => workspace.sessionId), [historyFixture.records[2].metadata.sessionId]);

    const serialized = JSON.stringify(unfiltered);
    for (const privateValue of ["synthetic-a.pdf", "private-workflow-session", "private failure", "/secret/private-result.json", "resultPaths"]) {
      assert.equal(serialized.includes(privateValue), false, `response leaked ${privateValue}`);
    }
    await collectionRequest();
    const after = await Promise.all(metadataPaths.map((filePath) => readFile(filePath)));
    for (let index = 0; index < before.length; index += 1) assert.deepEqual(after[index], before[index]);
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  }
});

await test("rejects malformed, repeated, out-of-range, and unsupported collection filters", async () => {
  const invalidQueries = [
    "?year=", "?year=1899", "?year=2201", "?year=26", "?year=20260",
    "?month=", "?month=0", "?month=13", "?month=2026-08", "?month=1.5",
    "?year=2026&year=2025", "?month=8&month=9", "?status=completed", "?year=2026&status=completed",
  ];
  for (const query of invalidQueries) {
    const response = await collectionRequest(query);
    assert.equal(response.status, 400, `expected 400 for ${query}`);
    assert.deepEqual(await response.json(), { error: "Invalid workspace collection query." });
  }
});

await test("returns empty history for a missing store and a safe error for store access failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "eve-history-"));
  const previousDataDir = process.env.DATA_DIR;
  try {
    process.env.DATA_DIR = path.join(root, "not-created");
    const missing = await collectionRequest();
    assert.equal(missing.status, 200);
    assert.deepEqual(await missing.json(), { total: 0, workspaces: [] });

    process.env.DATA_DIR = root;
    await writeFile(path.join(root, "workspaces"), "not a directory");
    const inaccessible = await collectionRequest();
    assert.equal(inaccessible.status, 500);
    assert.deepEqual(await inaccessible.json(), { error: "Could not read workspace collection." });
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  }
});

await test("skips corrupt records and external symlinks and reports interrupted status without writing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "eve-history-"));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = root;
  try {
    const workspaceRoot = await seedHistoryRecords(root, [historyFixture.records[0]]);
    const legacy = historyFixture.edgeCases.legacyMissingFields;
    const legacyDirectory = path.join(workspaceRoot, legacy.sessionId);
    await mkdir(legacyDirectory, { recursive: true });
    await writeFile(path.join(legacyDirectory, "workspace.json"), JSON.stringify(legacy));

    const interruptedId = "20000000-0000-4000-8000-000000000007";
    const interruptedDirectory = path.join(workspaceRoot, interruptedId);
    await mkdir(interruptedDirectory, { recursive: true });
    const interruptedMetadata = {
      sessionId: interruptedId, status: "running", files: ["synthetic-running.pdf"],
      reportingPeriod: "August 2026", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:01:00.000Z",
    };
    const interruptedPath = path.join(interruptedDirectory, "workspace.json");
    const interruptedBytes = JSON.stringify(interruptedMetadata, null, 2);
    await writeFile(interruptedPath, interruptedBytes);

    const corruptId = historyFixture.edgeCases.malformedJson.directoryName;
    const corruptDirectory = path.join(workspaceRoot, corruptId);
    await mkdir(corruptDirectory, { recursive: true });
    await writeFile(path.join(corruptDirectory, "workspace.json"), historyFixture.edgeCases.malformedJson.workspaceJson);

    const externalDirectory = path.join(root, "external-workspace");
    await mkdir(externalDirectory, { recursive: true });
    await writeFile(path.join(externalDirectory, "workspace.json"), JSON.stringify({
      sessionId: historyFixture.edgeCases.externalSymlink.directoryName,
      status: "completed", files: ["secret-external.pdf"],
      result: { classification: { reportingPeriod: { value: "August 2026" } }, secret: "external-private-data" },
    }));
    const symlinkId = historyFixture.edgeCases.externalSymlink.directoryName;
    const symlinkPath = path.join(workspaceRoot, symlinkId);
    await symlink(externalDirectory, symlinkPath, process.platform === "win32" ? "junction" : "dir");

    const response = await collectionRequest();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.total, 3);
    assert.equal(body.workspaces.find((workspace) => workspace.sessionId === interruptedId)?.status, "failed");
    assert.equal(body.workspaces.find((workspace) => workspace.sessionId === legacy.sessionId)?.reportingMonth, null);
    assert.equal(body.workspaces.some((workspace) => workspace.sessionId === corruptId), false);
    assert.equal(body.workspaces.some((workspace) => workspace.sessionId === symlinkId), false);
    assert.equal(JSON.stringify(body).includes("external-private-data"), false);
    assert.equal(await readFile(interruptedPath, "utf8"), interruptedBytes);
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  }
});

await test("sorts ties deterministically and returns every matching workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "eve-history-"));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = root;
  try {
    const workspaceRoot = path.join(root, "workspaces");
    await mkdir(workspaceRoot, { recursive: true });
    const expectedIds = [];
    for (let value = 1; value <= 105; value += 1) {
      const sessionId = `30000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
      expectedIds.push(sessionId);
      const directory = path.join(workspaceRoot, sessionId);
      await mkdir(directory);
      await writeFile(path.join(directory, "workspace.json"), JSON.stringify({
        sessionId, status: "uploading", files: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      }));
    }
    const body = await (await collectionRequest()).json();
    assert.equal(body.total, 105);
    assert.equal(body.workspaces.length, 105);
    assert.deepEqual(body.workspaces.map((workspace) => workspace.sessionId), expectedIds);
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  }
});

await test("validates optional reporting period and rejects malformed metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "eve-workspace-"));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = root;
  try {
    const invalid = await createWorkspaceResponse(new Request("http://localhost/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reportingPeriod: "not a period" }),
    }));
    assert.equal(invalid.status, 400);
    assert.deepEqual(await readdir(path.join(root, "workspaces")).catch(() => []), []);

    const valid = await createWorkspaceResponse(new Request("http://localhost/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reportingPeriod: "August 2026" }),
    }));
    assert.equal(valid.status, 201);
    const { sessionId } = await valid.json();
    const metadata = JSON.parse(await readFile(path.join(root, "workspaces", sessionId, "workspace.json"), "utf8"));
    assert.equal(metadata.reportingPeriod, "August 2026");
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  }
});
