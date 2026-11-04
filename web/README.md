# EVE web app

The Next.js UI and Eve backend run as separate local/private services. The web UI listens on `http://localhost:3001`; `EVE_API_URL` points server-side to Eve. Do not expose this app publicly: workspace routes do not provide customer authentication or multi-user isolation.

## Configuration and startup

1. Configure the backend in the repository-root `.env` (never commit it): `OPENROUTER_API_KEY` is required for model calls. Database-backed asset validation uses `DB_HOST`, `DB_PORT` (default `1433`), `DB_USERNAME`, `DB_PASSWORD`, and `DB_DATABASE`. `DATA_DIR` controls workspace storage; Docker sets it to `/data`.
2. Start Eve from the repository root in terminal 1:
   ```bash
   npm install
   npm run dev
   ```
   Development commonly uses port `2000`. If using Docker Compose, the backend is published on port `3000` by default; configure the actual port in the web environment.
3. Configure and start Next.js in terminal 2:
   ```bash
   cd web
   npm install
   cp .env.example .env.local
   ```
   Set server-only `EVE_API_URL` in `web/.env.local` to the Eve URL, e.g. `http://127.0.0.1:2000` for Eve development or `http://127.0.0.1:3000` for the default Docker host port. Then run:
   ```bash
   npm run dev
   ```
4. Open `http://localhost:3001`. Never prefix the backend URL with `NEXT_PUBLIC_`; do not commit `.env.local` or credentials.

For Docker backend startup and persistence details, see the repository-root `README.md`. The Next.js UI itself runs locally in this MVP.

## Upload and workflow behavior

The UI supports multiple files and repeated folder selections where the browser supports `webkitdirectory`. Folder-relative paths are labels only: uploads are flattened to basenames, and the backend may suffix duplicate names. Original-folder-to-result mapping is not guaranteed.

UI defaults are 20 files, 25 MiB per file, and 250 MiB per workspace. Keep the constants in `components/upload-workspace.tsx` aligned with backend `UPLOAD_MAX_FILES`, `UPLOAD_MAX_FILE_BYTES`, and `WORKSPACE_MAX_BYTES` if server limits change. The backend remains authoritative.

Files are uploaded sequentially. Uploading never starts processing. The user must explicitly click **Start workflow**. The workspace page polls about every 2.5 seconds; a reload resumes observing the existing workspace and never starts another workflow. Connection errors pause polling until reconnect. Ambiguous process timeouts and HTTP 409 responses are reconciled by fetching the existing workspace before another explicit start is allowed.

The app has no public authentication, multi-tenancy, workflow cancellation, or automatic retry. Keep it local/private and use only non-sensitive sample files for development and smoke checks.

## Tests and checks

From the repository root:

```bash
npm test
npm run typecheck
npm run build
```

For the web app:

```bash
cd web
npm test
npm run lint
npm run typecheck
npm run build
```

The workspace UI tests mock backend delivery. Run the live workspace smoke flow separately from the repository root after Eve is running and configured:

```bash
node scripts/smoke-workspace.mjs
```

This uses the non-sensitive `test/fixtures/api-smoke.pdf` fixture twice (testing duplicate basenames), confirms status remains `uploading` after uploads, explicitly starts the workflow, then prints final per-document outcomes including skips. Set `WORKSPACE_API_BASE_URL` if Eve is not at `http://127.0.0.1:2000`. Allow several minutes for model/database operations. Optionally set `SMOKE_REPORT_PATH` to a new local report file; reports may contain document names and reasons, so keep them private and do not commit them. Never run with customer documents or commit credentials.

### Recorded live smoke result (2026-11-03)

The live workspace smoke completed successfully with workspace `784e838f-02df-4ffc-8f96-69df4bd103f5`. Two uploads were confirmed and status remained `uploading` until the explicit process request. The final workflow status was `completed`; document outcomes were:

| Document | Outcome | Reason |
|---|---|---|
| `api-smoke-2.pdf` | Skipped | No identified asset was uniquely confirmed as tracked for this document's reporting period. |
| `api-smoke.pdf` | Skipped | No identified asset was uniquely confirmed as tracked for this document's reporting period. |

This confirms the live process/poll/result path. Workflow completion does not imply successful extraction; both fixture documents were skipped during asset validation.

## Persisted data and cleanup

With Docker Compose, workspaces and uploads are under `data/workspaces/<workspaceId>/` and Eve workflow output is under `data/output/<workflowSessionId>/`. With a direct local backend run, workspace storage follows `DATA_DIR` (the backend default is `/data`) and workflow output is under the backend's working-directory `output/` folder. Workspace metadata, status, and the persisted result are in each workspace's `workspace.json`; workflow output includes `pipeline-results.json`.

To manually delete persisted local development data, first stop Eve and Next.js. Then remove only the generated workspace/output directories you intend to discard, for example `data/workspaces/` and `data/output/` for Docker Compose, or the configured `DATA_DIR/workspaces/` and local `output/` directories. This is destructive, does not cancel any currently running workflow, and cannot be undone. Do not delete `.env` as a cleanup shortcut; keep credentials private.

## Workspace-history collection contract (S1)

The backend collection endpoint, same-origin Next.js proxy, and history page are implemented in S2–S4. This section records their collection contract.

### Reporting-period meaning

A workspace's reporting year and month come only from the selected batch period in a completed extraction result: `result.classification.reportingPeriod.value`. Normalize the value with the existing reporting-period rules, then expose the year and numeric month separately. For example, an August 2026 batch processed in October 2026 has reporting year `2026` and reporting month `8`; creation and update timestamps never supply a missing period.

`WorkspaceMetadata.reportingPeriod` is a requested value and is not evidence of the period actually selected by extraction. Do not use it as a fallback, including when a completed legacy result has no selected period. For mixed-period uploads, index by the batch period selected from the documents, not by individual documents or documents skipped during extraction. A completed all-skipped batch still has its selected batch period when the result records one; `completed` describes workflow state and does not imply successful extraction. Null, tied, missing, or otherwise unrecognized selected periods are unknown. Non-completed workspaces without a persisted selected batch result are also unknown. Unknown periods appear in unfiltered results and do not match an active year or month filter.

### Query, summary, filtering, and ordering

The backend collection is `GET /workspace`; the same-origin browser route is `GET /api/extraction/workspace`. They accept only independent optional query parameters `year` and `month`:

- `year`: exactly one four-digit integer from 1900 through 2200.
- `month`: exactly one integer from 1 through 12. The UI displays month names and sends numeric values.
- No parameters returns every readable workspace, including unknown periods.
- Year only matches that reporting year; month only matches that reporting month across all years; both require both values to match.
- Empty, malformed, repeated, out-of-range values, combined `YYYY-MM` month values, and unsupported query keys return HTTP 400. The proxy forwards only `year` and `month` to the fixed backend route; callers cannot select an upstream host or path.

A successful response has shape `{ "total": number, "workspaces": WorkspaceSummary[] }`, where `total` equals the number of returned rows. A summary contains only `sessionId`, `status`, `fileCount`, `reportingYear`, `reportingMonth`, `createdAt`, and `updatedAt`. Period values are integers or `null`; date values are valid stored timestamp strings or `null` when missing or invalid. `fileCount` is the length of a valid stored files array, or `null` when legacy metadata does not provide one. A missing or unrecognized legacy status is represented as `unknown`; recognized statuses are `uploading`, `queued`, `running`, `completed`, and `failed`. Collection responses never include filenames, document text, full results, failure details, local paths, or workflow session IDs.

Return all matching summaries without pagination or silent truncation. Response generation, memory use, network transfer, and browser rendering grow with the number of matching workspaces; large histories may take longer and use more resources because pagination is intentionally out of scope. Order by creation time descending (missing or invalid creation times last), then by session ID ascending for deterministic ties. Creation time is for display and ordering only, never reporting-period inference. A missing workspace storage directory is an empty collection; an unreadable individual or malformed workspace record is skipped without preventing other readable rows from being listed. Individual `workspace.json` reads are bounded to 16 MiB; larger records are treated as unreadable and skipped. A workspace-store access failure returns a safe HTTP 500. Invalid query parameters return HTTP 400; the web proxy uses a safe HTTP 503 if the backend is unavailable or unconfigured. Collection reads do not rewrite stored workspace metadata. For interrupted `queued` or `running` workspaces, report `failed` when this backend process does not have the workspace active, without persisting that status during collection listing.

This is a local/private shared history for the single backend deployment. The current workspace routes have no customer authentication or owner field; this contract does not provide per-user or tenant isolation. Do not expose the service publicly or on a shared network without separately approved identity and authorization work.

### Shared synthetic fixture

`test/fixtures/workspace-history.json` is fictional shared input/expected-response data for backend and frontend history stories. Its records A–F cover the agreed filtering examples: A is created in September 2026 but has an August 2026 result; B stores a July 2026 requested period but has an August 2026 result; C is September 2026; D is August 2025; E is uploading with no selected period; F is failed without a persisted result. Expected responses define unfiltered, year-only, month-only, and August 2026 results. Separate edge cases cover a known period with all documents skipped, an ambiguous period, missing legacy fields, malformed JSON, an unrelated directory, and an external symlink. These fixtures are synthetic and must not be populated from customer workspaces.

## Proxy routes

The Next.js server exposes only these workspace routes and forwards them to Eve:

- `GET /api/extraction/workspace` (workspace collection; accepts only `year` and `month`)
- `POST /api/extraction/workspace`
- `POST /api/extraction/workspace/:sessionId/uploads`
- `POST /api/extraction/workspace/:sessionId/process`
- `GET /api/extraction/workspace/:sessionId`

Multipart bodies and boundaries are preserved, backend status codes are forwarded, and collection/status responses are not cached. The browser never receives `EVE_API_URL`.

## Synthetic workspace history smoke check (S5)

The smoke script is read-only and verifies the collection through the same-origin web proxy, then opens one existing detail. It sends only GET requests; it does not create workspaces, upload files, start workflows, write metadata, or invoke a model/database. It requires a pre-seeded **synthetic** Eve fixture service and refuses non-local or non-HTTP base URLs.

1. Populate an isolated temporary `DATA_DIR` with the synthetic records in `test/fixtures/workspace-history.json`, then start Eve with that `DATA_DIR` using the repository-root `npm run dev` command.
2. Start the web app with server-only `EVE_API_URL` pointed at that local Eve process, using the existing `web/.env.local` configuration and `cd web && npm run dev` command.
3. Set an explicit local web base URL and run the smoke check from the repository root:
   ```bash
   WORKSPACE_HISTORY_SMOKE_BASE_URL=http://127.0.0.1:3001 node scripts/smoke-workspace-history.mjs
   ```
   In PowerShell:
   ```powershell
   $env:WORKSPACE_HISTORY_SMOKE_BASE_URL = "http://127.0.0.1:3001"
   node scripts/smoke-workspace-history.mjs
   ```

The script checks unfiltered, year-only, month-only, combined August 2026, empty-match, and A's existing detail responses against the shared fixture. It never defaults to a base URL, so set the variable only for the isolated local fixture environment. Do not run it against customer data or a non-local service.

The automated UI tests cover URL-driven filtering, history links, stale-response handling, and error-state behavior. A manual browser check should additionally verify reload and back/forward filter restoration, keyboard operation, narrow-width usability, and recovery after reloading once Eve is restored. Record only checks actually performed in the implementation pull request; do not include customer data or credentials.
