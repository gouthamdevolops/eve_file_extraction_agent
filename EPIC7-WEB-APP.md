# Epic 7: Browser app for aircraft-utilization document processing

> Learning document for a junior developer. Read from the beginning. Do not skip the vocabulary, safety rules, or checks. At each checkpoint, run the listed checks and fix failures before continuing. This epic describes a proposed UI and its required backend integration; it does not claim that those UI features are already implemented.

## 1. The goal

A customer opens a local web page, selects a folder containing aircraft-utilization documents, chooses or confirms a target reporting period, and presses **Upload & process**.

The browser sends the selected file bytes and their relative paths to an Eve workspace. The server safely stores the files, starts the existing aircraft-document workflow, and returns progress and results. The page shows the processing journey and, when complete, a useful summary of preparation, reporting-period classification, database identity validation, and extraction.

The UI is for the existing aircraft-document application. It does **not** sort arbitrary customer files into new folders and does not create an organizer `plan.json`.

## 2. What you get at the end

| | Before this epic | After this epic |
|---|---|---|
| How a customer selects files | API client or local agent request | Browser folder picker |
| How files reach the server | Manual API request | One user action starts a workspace upload |
| How processing starts | Workspace/API caller or manual request | The page starts a user-owned Eve turn (Option A) or uses the agreed separate-server contract (Option B) |
| What the user sees | API JSON/status | Per-file preparation, period, validation, extraction outcomes and reasons |
| What the app is | Eve backend and APIs | Eve backend plus a Next.js app under `web/` |
| Main result | `pipeline-results.json` | A rendered view of the same structured pipeline result; no `plan.json` |

## 3. What you need before you start

- Existing Docker/API and workspace work is complete and its checks pass.
- From the repository root, `npm test`, `npm run typecheck`, and `npm run build` pass.
- `npm run dev` starts the Eve server on port `2000`.
- The fixture folder described in Story W.4 exists and contains synthetic aircraft-document samples. Do not use customer documents as committed fixtures.
- The developer can select a folder in the browser and run two terminal processes.
- The lead has answered the wiring question in Section 6.
- For a full extraction test, a valid local model configuration and any required database configuration are available. Never put secrets in the web bundle or commit them.

## 4. Words you need to know

| Word | Meaning in this application |
|---|---|
| eve | The agent framework used by this repository. |
| agent | The program that prepares, classifies, validates, and extracts data from aircraft documents. |
| channel | A set of HTTP routes served by Eve, such as workspace and health routes. |
| workspace | Persistent server-side storage for one browser upload and its processing status. |
| workspace ID / `sessionId` | The UUID returned when a workspace is created. It is not an Eve workflow session ID. |
| Eve session ID | The separate ID for the Eve turn/workflow that runs `process_folder`. |
| turn | One execution of the agent in response to a message. |
| event | One update produced during a turn, such as a tool call or progress update. |
| stream | A live delivery of turn events to the browser. |
| poll | Repeatedly request workspace status until processing finishes. |
| proxy | A web route that forwards an HTTP request to the separate Eve server. |
| upload | Sending file bytes from the browser to the server. The server never reads an arbitrary client-supplied path. |
| multipart | HTTP form format used to send files and metadata. |
| relative path | A path within the selected folder, such as `Reports/Aircraft.pdf`; it is not an absolute path on the customer’s computer. |
| reporting period | The month and year used to filter documents and select period-specific database records. |
| manifest | The preparation record for the files, including prepared/failed status and sidecar locations. |
| pipeline result | The existing structured result containing classification, validation, and extraction results. |
| SDK | A ready-made program library used by the web app to communicate with Eve. |
| `pipeline-results.json` | The persisted result from the existing workflow. It is not an organizer `plan.json`. |

Workspace files are persisted under `DATA_DIR/workspaces/<sessionId>/uploads/`. In Docker Compose, `DATA_DIR=/data` is mounted to the project’s `data/` directory. Eve workflow sidecars/results are persisted under the configured output mount, currently `data/output/<eveSessionId>/`.

## 5. User flow and rules

1. The customer selects a folder with a browser directory picker. The browser provides each file and its `webkitRelativePath`; it does not grant the server access to the customer’s local folder.
2. The page shows the folder name, supported-file count, total bytes, and target reporting period before upload.
3. The page creates a workspace and uploads the selected files while preserving their safe relative paths.
4. The page starts processing according to the selected wiring option and displays honest status/progress.
5. The existing workflow prepares documents, classifies document types and reporting periods, validates identities against the database, and extracts configured values.
6. The page renders per-file outcomes and reasons from the workflow result.

### 5.1 The multipart rule

- Send file bytes, not the local folder’s absolute path.
- Preserve each file’s relative path. For a browser folder input, use `file.webkitRelativePath || file.name`.
- For the bulk workspace-upload route, the multipart field name for each file is its relative path and the value is the file, for example:
  ```js
  formData.append(file.webkitRelativePath || file.name, file)
  ```
- Reserve and validate any metadata fields separately (workspace name and reporting period). Treat every file field name as untrusted input.
- The server validates paths before writing: reject `..` traversal, absolute paths, drive-letter paths, NUL/control characters, and paths that resolve outside the workspace. Normalize separators consistently. Do not follow symlinks from an upload.
- Preserve nested paths under `data/workspaces/<sessionId>/uploads/` and update preparation to discover supported files recursively. Current preparation only scans direct files, so recursion is a required backend change for folder-picker support.
- Apply the same path-safety policy to all accepted upload formats. Keep existing file-type, per-file, request, file-count, and total-workspace limits. Report validation errors safely.
- Keep the existing `/api/runs` contract and the current per-file workspace upload route compatible unless the lead explicitly approves a migration. Do not silently repurpose either route.
- Do not add a ZIP route merely because another organizer specification has one. This application’s workflow accepts files directly; if ZIP support is later requested, specify and test it separately.

### 5.2 Progress: stream where supported, never invent it

- Option A uses the user-owned Eve turn stream. Reconnect after reload using the stream cursor so the page can resume events.
- Consume `call.settled` for actual stage transitions and `call.progress` only when the backend emits real counters. `content.delta` may be displayed as concise agent text if the lead approves.
- The current workflow does not yet guarantee that all stages emit numeric progress events. Instrument it with real counts before displaying counters; otherwise show stage/status only. Never fabricate `3/10` or smooth progress to imply work that did not happen.
- Option B uses the separate workspace status API and polling if selected. This is a capability trade-off against the live-stream requirement; the lead must explicitly accept it. Do not describe polling as streaming.

### 5.3 The “own your turn” rule

For Option A, the page starts and owns the Eve turn using the selected workspace and server-generated upload directory. The user message must direct the agent to call the existing `process_folder` tool with that server-generated folder and the chosen `reportingPeriod`. Never take a folder path from the browser and pass it to the workflow.

The workspace session ID and Eve turn/session ID are distinct. Store both where needed. The page must be able to observe/rejoin its own turn stream. Do not start an unobservable background turn and claim that the page has live progress.

For Option B, use the agreed workspace process/status routes. The page must make clear that progress is polling-based. Do not implement both wiring options unless the lead explicitly changes the decision.

### 5.4 Reporting-period behavior

- Show the target period in the UI before processing. The current `/api/runs` API defaults to August 2026; the UI must make its target visible and allow a deliberate override. Do not silently apply an unseen period.
- Pass the chosen full month/year period to the workflow.
- Mixed-period folders are allowed. Documents matching the target period proceed to database validation; other-period documents are retained in the result as skipped before database validation, with the exact reason.
- Do not omit a skipped document or imply it was extracted. If a document has no confirmed period, report that explicitly.

### 5.5 Result and privacy rules

- Render the existing pipeline result: per-file preparation/classification status, period, database-validation outcome, extraction status, component summaries, warnings, and skip/failure reasons.
- Do not invent destination folders or call the output `plan.json`. The app may label its response “Processing results” and offer a safe JSON download/copy of the redacted result.
- Do not expose absolute server paths, raw source excerpts, credentials, or full document text in the UI/API response. Escape every string before rendering. Treat document content as untrusted input.
- Keep the app bound to localhost by default. Before production use, require real authentication; never use `none()` for customer documents.

## 6. Step 0: Ask the lead one question

Before building, ask:

> “Option A or Option B?”

- **Option A:** Eve is integrated with the Next.js app via `withEve`. Recommended when the user must own a turn and receive a live event stream.
- **Option B:** Next.js and Eve run separately behind a proxy. Uses workspace process/status routes and polling. It does not meet the same live-stream behavior unless an observable stream endpoint is added.

Wait for the lead’s answer. Write the choice at the top of the implementation notes. Never build both options. If a mandatory live stream is non-negotiable, Option A is the compatible choice; resolve this before implementation.

## 7. Quick start (do this first)

This proves both servers and the fixtures work before implementation:

1. Start Eve with `npm run dev` and confirm it listens on port `2000`.
2. In a second terminal, start the web app with `cd web; npm run dev`.
3. For Option B only, create `web/.env.local` with `EVE_API_URL=http://127.0.0.1:2000`. Never commit this file.
4. Open `http://127.0.0.1:3000`, select `tests/fixtures/aircraft-documents/`, choose a visible reporting period, and click **Upload & process**.
5. Confirm the UI reports file count, status changes, per-file outcomes, and results.

If the model key is unavailable, the upload should still complete and the page should show a safe pipeline-error banner. Do not present failed processing as completed extraction.

## 8. Story W.1: Safe folder upload and workspace handling

> As a customer, I need the browser to upload a folder’s files into one workspace without exposing a local path or losing relative paths.

### What you learn

- How multipart file parts and relative paths work.
- Why `..`, absolute paths, drive letters, and symlink traversal are dangerous.
- How to share validation and atomic-storage logic.
- How to test both safe and unsafe paths.

### What you do

- Keep the existing workspace UUID (`sessionId`) format and existing create/status/process routes.
- Add a bulk relative-path upload endpoint for the UI, for example `POST /workspace/:sessionId/upload-folder`. A workspace must already exist; response names the same `sessionId` and reports accepted `fileCount` and `uploading` status.
- Read multipart file parts where each file field name is its relative path. Validate workspace metadata fields separately.
- Save into `DATA_DIR/workspaces/<sessionId>/uploads/<relativePath>` using containment checks and atomic writes. Preserve duplicate relative paths safely without overwriting prior files; make the chosen behavior deterministic and return the saved relative names.
- Enforce supported extensions, nonempty file checks, per-file/request/workspace size caps, file-count limits, and reporting-period consistency. Keep any configured existing limits; workspace total cap is 250 MB unless the lead changes it.
- Update `workspace.json` only after successful file writes. On failure, remove only the incomplete file and leave previously uploaded files intact.
- Update preparation to recursively enumerate regular supported files under the workspace upload root in stable order, while ensuring no path escapes the workspace.
- Do not change `/api/runs` or the existing per-file upload contract without approval.

### Acceptance criteria and checks

- Valid nested files round-trip to their relative paths and appear in workspace metadata.
- Empty folder/no-file uploads return a clear 400.
- Unsupported, empty, oversized, duplicate, traversal, absolute, drive-letter, and malformed paths are handled safely.
- A rejected path writes nothing outside the workspace; a workspace over the cap leaves no partial new upload.
- Existing workspace/API tests continue to pass.
- Run `npm run typecheck`, `npm test`, and `npm run build`; do not continue until all pass.

## 9. Story W.2: Next.js app

> As a customer, I need a plain browser interface that uploads and displays aircraft-document extraction results.

### What you learn

- How to create a Next.js app under `web/` without initializing a nested Git repository.
- How to send multipart file data from a browser.
- How to connect the UI to Eve using the chosen wiring.
- How to render structured results safely.

### What you do

- Create `web/` using the approved Next.js setup; do not create `web/.git`.
- Option A: integrate Eve with `withEve` as documented for the selected Eve version; keep the root Eve app behavior intact.
- Option B: create a catch-all proxy route that forwards method, raw body bytes, content type, status, and response type to `EVE_API_URL`; never commit `.env.local`.
- Build a plain page with a hidden folder input using `webkitdirectory`, a **Choose a folder** button, visible folder name/count/total size, target-period selector, and **Upload & process** button. Add the required TypeScript type cast for `webkitdirectory` because React’s standard input attributes may not declare it.
- Send file bytes and relative paths through the approved workspace upload route. Show safe per-file upload progress without implying pipeline completion.
- Do not use external fonts or CDN-hosted assets.
- On upload completion, start the pipeline according to the chosen wiring. For Option A, start the page-owned turn with `process_folder` and the server-owned workspace path/selected target period. For Option B, use the agreed process and status routes.
- Render per-file status, reporting period, identity-validation outcome, extraction status, component summary, and exact skip/failure reasons from the returned result.
- Escape all rendered strings. Do not display absolute paths or raw extracted source text.

### Acceptance criteria and checks

- Folder picker shows supported files and relative names; no client absolute path is sent.
- The target period is visible and is passed to the workflow.
- Other-period files appear as skipped with their reasons, not silently dropped.
- The result view distinguishes completed, skipped, and failed files/components.
- Option B requests are proxied without corrupting multipart bodies.
- Run `cd web; npm run build` and `npm run lint`, plus root `npm run typecheck`, `npm test`, and `npm run build`.
- Complete a browser smoke test using synthetic fixtures before continuing.

## 10. Story W.3: Truthful animated processing screen

> As a customer, I want to understand what the server is doing without misleading progress.

### What you learn

- How to model UI phases in React.
- How to use the approved motion library and `prefers-reduced-motion`.
- How to drive animation from real workflow events.

### What you do

- Read the relevant animation skill available in the workspace before implementing motion.
- Install/use `motion` only in `web/`; wrap the interface in `<MotionConfig reducedMotion="user">`.
- Define phases: `idle`, `uploading`, `preparing`, `classifying`, `validating`, `extracting`, `done`, `error`. Use a fixed-height animation stage so the page layout does not jump.
- Show “Your computer” at the bottom-left and “Processing server” at the top-right. Each chip represents a selected document, shows an icon (📄 PDF, 📝 document, 📊 spreadsheet, 🖼️ image, 📦 other) and short filename, and is sourced only from the picker’s file list. Show at most 12 chips plus `+N more`.
- On selection, place chips in a fan next to the computer. On upload, animate each chip toward the server with a 60 ms stagger and 800 ms flight. Set delays to zero when reduced motion is requested.
- After upload, chips may burst into a processing pile and gently wobble while preparation/classification/validation/extraction are underway. Use a seeded, stable pseudo-random position so chips do not jump between renders. Label the server with the real current stage, such as “Extracting…”. Use only actual stage/progress events. If no numeric event exists, display a stage label only—never invent counters.
- When results arrive, stop the wobble and assemble chips into up to three result lanes: **Extracted**, **Skipped**, and **Failed**, based only on each file’s actual extraction result. Stagger movement by lane; use spring movement without bouncy easing. Do not animate into invented destination folders.
- For each completed document, let the result panel expand to component extraction and validation details. Keep skip reasons visible.
- Add a “Copy/download results JSON” action and “Start over” action; do not expose local paths or unredacted excerpts.
- Provide empty, upload-error, processing-error, and reduced-motion states. The status line must use `aria-live`. Every action must remain usable when animation is disabled.

### Motion timing guidance

| Purpose | Duration |
|---|---:|
| Button feedback | 100–150 ms |
| State change | 200–300 ms |
| Layout move | 300–500 ms |
| Entrance | 500–800 ms |
| Exit | 75% of the entrance duration |

### Acceptance criteria and checks

- File flight, processing phase, and final result grouping correspond to real state.
- A document marked skipped cannot appear as extracted.
- Reduced motion completes every phase with no stuck transition; set stagger delays to zero.
- Avoid Tailwind translate utilities that conflict with Motion transforms; use the CSS `translate` property where appropriate.
- No console errors; all text is escaped; keyboard focus and live status are accessible (`aria-live`).
- Verify animations against the actual result payload, not a visual mock alone.

## 11. Story W.4: End-to-end test

> As the team, we need proof that the browser, workspace API, workflow, and result view agree.

### What you do

- Use a synthetic fixture folder with supported PDF/document samples representing multiple reporting periods and at least one preparation/validation edge case.
- Start Eve and Next.js; choose the fixture folder and a target period; upload and process.
- Record preparation totals (prepared/failed), period-matched/skipped files, identity-validation outcomes, completed/skipped/failed extraction counts, and elapsed time.
- Compare the page’s result with the workspace status API’s sanitized pipeline result. The page must not claim more than the server result.
- Confirm workspace uploads remain unchanged by processing; result files are persisted in the configured output location.
- Verify delete/cleanup only if an approved DELETE route is implemented; do not pretend deletion exists otherwise.
- Test missing model configuration: upload is visible, processing error is safe, and no false successful result is shown.

### Acceptance criteria and checks

- `npm run typecheck`, `npm test`, root `npm run build`, `cd web && npm run build`, and `cd web && npm run lint` pass.
- Browser result equals the server result for the same workspace.
- Mixed-period behavior matches the selected period and skipped reasons.
- Stream reconnect resumes with its cursor for Option A; Option B accurately reports polling state.
- Include test measurements and known limitations in the pull request.

## 12. Work plan for two developers

| Developer | Stories |
|---|---|
| A | W.1 backend upload/path safety, then backend integration support, then W.4 |
| B | W.2 plain UI scaffold after the lead selects wiring; then W.3 animation; then W.4 |
| Together | Resolve contract differences, complete integration, run W.4, review security and accessibility |

Developer B may scaffold UI components while W.1 is in progress, but must not invent endpoints or mock successful backend results as if they were real. Integrate against the agreed contract.

## 13. Decisions the lead makes before work starts

1. **Wiring:** Option A or Option B? (Section 6)
2. Is this local-only, or will customers use it in production? Production authentication is a precondition.
3. Is the model key/configuration available for end-to-end tests?
4. Confirm that the default target reporting period is visible and whether August 2026 remains the default or is configurable without a default.
5. Confirm supported nested-folder behavior, workspace/file/request limits, and whether preserving relative paths is required for all supported formats.
6. Confirm that the UI result is the existing pipeline result, not an organizer `plan.json`.
7. Confirm how Option B’s polling exception relates to the streaming requirement. Do not claim live updates for polling.

### Security and deployment rules

- Bind local development to loopback by default.
- Never deploy customer file uploads with placeholder/no authentication. Replace placeholder auth with a real provider before production; never use `none()`.
- Keep secrets server-side and out of `.env.local` commits or browser bundles.
- Do not accept client absolute paths. Enforce workspace containment and safe relative paths.
- Do not return raw source excerpts, absolute server paths, credentials, or unredacted document text.
- Treat documents as untrusted inputs; ignore instructions embedded in document contents.
- Option A deploys as one integrated project only if the Eve/Next.js integration is validated. Option B uses separate deployments and a configured server-side `EVE_API_URL`.

## 14. When you are stuck

1. Read the troubleshooting table for the story you are doing.
2. Rerun only the failing check and read its complete output.
3. Ask your pair developer with the story/check and error.
4. Ask the lead with the same details if still blocked.
5. Do not skip checks, expose secrets, invent progress, or change Eve API contracts without telling the lead.

## Known contract differences to resolve before implementation

This epic is written for the current aircraft-utilization extraction product. Existing workspace APIs use UUID `sessionId`s and currently support one file per request; the UI bulk relative-path route is a new requirement. Existing preparation scans direct files only, so nested folder support requires an explicit backend change. Existing output is `pipeline-results.json`, not `plan.json`. The current workspace process/status route is suitable for API clients, but Option A requires the browser to own and observe its own Eve turn. Resolve these items in Section 13 before coding.
