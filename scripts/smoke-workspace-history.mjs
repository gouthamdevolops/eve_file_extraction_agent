import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const baseValue = process.env.WORKSPACE_HISTORY_SMOKE_BASE_URL;
if (!baseValue) {
  console.error("Set WORKSPACE_HISTORY_SMOKE_BASE_URL to the local web app backed by a synthetic workspace fixture.");
  process.exit(1);
}

let base;
try {
  base = new URL(baseValue);
} catch {
  console.error("WORKSPACE_HISTORY_SMOKE_BASE_URL must be a valid local HTTP URL.");
  process.exit(1);
}
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const hostname = base.hostname.replace(/^\[|\]$/g, "");
if (base.protocol !== "http:" || !localHosts.has(hostname) || base.username || base.password) {
  console.error("For safety, workspace history smoke checks are limited to an unauthenticated local HTTP URL.");
  process.exit(1);
}

const fixture = JSON.parse(await readFile(new URL("../test/fixtures/workspace-history.json", import.meta.url), "utf8"));
const id = (label) => fixture.records.find((record) => record.label === label)?.summary.sessionId;
const expectedIds = (response) => response.workspaces.map((workspace) => workspace.sessionId);
let getCount = 0;

async function getJson(path) {
  const target = new URL(path, base);
  const response = await fetch(target, { method: "GET", cache: "no-store" });
  getCount += 1;
  if (!response.ok) throw new Error(`GET ${target.pathname}${target.search} returned HTTP ${response.status}.`);
  return { body: await response.json(), response };
}

async function checkCollection(query, expectedResponse, label) {
  const { body, response } = await getJson(`/api/extraction/workspace${query}`);
  assert.equal(response.headers.get("cache-control"), "no-store", `${label} should not be cached`);
  assert.equal(body.total, expectedResponse.total, `${label} total`);
  assert.equal(body.total, body.workspaces.length, `${label} total must equal returned rows`);
  assert.deepEqual(expectedIds(body), expectedIds(expectedResponse), `${label} IDs and order`);
  return body;
}

try {
  await checkCollection("", fixture.responses.unfiltered, "unfiltered history");
  await checkCollection("?year=2026", fixture.responses.year2026, "year-only history");
  await checkCollection("?month=8", fixture.responses.month8, "month-only history");
  const august = await checkCollection("?year=2026&month=8", fixture.responses.august2026, "August 2026 history");
  assert.deepEqual(expectedIds(august), [id("A"), id("B")]);
  assert.equal(august.workspaces.find((workspace) => workspace.sessionId === id("A")).reportingYear, 2026);
  assert.equal(august.workspaces.find((workspace) => workspace.sessionId === id("A")).reportingMonth, 8);
  assert.equal(august.workspaces.find((workspace) => workspace.sessionId === id("B")).reportingYear, 2026);
  assert.equal(august.workspaces.find((workspace) => workspace.sessionId === id("B")).reportingMonth, 8);
  await checkCollection("?year=2026&month=12", { total: 0, workspaces: [] }, "empty history filter");

  const { body: detail } = await getJson(`/api/extraction/workspace/${encodeURIComponent(id("A"))}`);
  assert.equal(detail.sessionId, id("A"), "detail session ID");
  assert.equal(detail.status, "completed", "detail status");
  assert.equal(detail.result?.classification?.reportingPeriod?.value, "August 2026", "persisted result reporting period");

  console.log("Workspace history smoke passed:");
  console.log(`- unfiltered: ${fixture.responses.unfiltered.total} synthetic workspaces`);
  console.log(`- year 2026: ${fixture.responses.year2026.total}; month 8: ${fixture.responses.month8.total}`);
  console.log(`- August 2026: A and B; empty filter: 0`);
  console.log("- existing A detail: completed, reporting period August 2026");
  console.log(`- ${getCount} read-only GET requests; no workflow-start request was sent`);
} catch (error) {
  console.error(`Workspace history smoke failed: ${error instanceof Error ? error.message : "unexpected response"}`);
  process.exitCode = 1;
}
