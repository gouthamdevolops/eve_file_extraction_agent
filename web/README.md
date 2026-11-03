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

## Proxy routes

The Next.js server exposes only these workspace routes and forwards them to Eve:

- `POST /api/extraction/workspace`
- `POST /api/extraction/workspace/:sessionId/uploads`
- `POST /api/extraction/workspace/:sessionId/process`
- `GET /api/extraction/workspace/:sessionId`

Multipart bodies and boundaries are preserved, backend status codes are forwarded, and status responses are not cached. The browser never receives `EVE_API_URL`.
