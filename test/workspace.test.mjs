import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createWorkspace,
  createWorkspaceResponse,
  getWorkspaceStatus,
  startWorkspaceProcess,
  updateWorkspace,
  uploadWorkspaceFile,
} from "../.test-dist/agent/lib/workspace.js";

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
