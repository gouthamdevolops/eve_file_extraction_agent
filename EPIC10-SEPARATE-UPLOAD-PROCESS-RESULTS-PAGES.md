# Epic 10: Separate upload, workflow, and results into three pages

> Restructure the browser experience into a clear three-step journey: select/upload documents, monitor and explicitly start processing, then review completed results on a dedicated page. Preserve the existing workspace APIs and their upload/process behavior.

## 1. Goal

The landing page, workflow status, and extraction results currently share too much content and create a long, hard-to-scan page. Give each part of the user's job a focused route:

1. **Upload** — choose documents and upload them.
2. **Process** — start the workflow deliberately and view its actual saved status.
3. **Results** — review extracted aircraft and component information after completion.

The workspace remains the durable source of state. Navigation, page refresh, or opening a route directly must never create a duplicate upload or start another workflow.

## 2. User story

> As an aircraft operations user, I want upload, workflow monitoring, and extraction results on separate focused pages, so I can move through the job clearly and review results without scrolling past the processing interface.

## 3. Page map and responsibilities

| Step | Proposed route | Main responsibility |
|---|---|---|
| Upload | `/` | Select files/folders, review limits and selection, upload files, then continue to the created workspace. |
| Process | `/workspaces/[sessionId]` | Review uploaded files, explicitly start processing, observe actual workflow status, and continue to results when complete. |
| Results | `/workspaces/[sessionId]/results` | Display extraction outcomes and aircraft/component results for a completed workspace. |

Keep `/workspaces/[sessionId]` as the existing workspace/process route so existing links and API contracts remain compatible. The results route is additive.

## 4. Shared journey navigation

- Add a compact, consistent step indicator: **1 Upload → 2 Process → 3 Results**.
- Mark the current step and expose it accessibly (for example, `aria-current="step"`). Completed earlier steps may be shown as links when safe.
- Preserve workspace identity in route parameters; do not put document contents, result JSON, or server paths into URLs.
- Provide clear actions: **Continue to processing**, **Start workflow**, **View results**, **Back to workflow**, and **New batch**, as appropriate to the current state.
- Use ordinary navigation with browser back/forward support. The server's persisted workspace status remains authoritative after every navigation or reload.

## 5. Page requirements

### 5.1 Upload landing page

- Keep the existing aviation-themed landing page and file-selection behavior.
- Keep upload separate from processing. A successful upload creates/updates the workspace and navigates to its process page; it must not implicitly start processing.
- Keep upload confirmation and errors truthful. The page must not claim processing has started.
- A recent-workspace link should route to the process page for uploading/queued/running/failed workspaces and to results for completed workspaces.
- Keep keyboard, mobile, reduced-motion, and file validation behavior intact.

### 5.2 Workflow process page

- Make this page about the workspace and its workflow state only; remove the extraction results and component cards from this route.
- For an `uploading` workspace, show the uploaded file count and an explicit **Start workflow** action. Starting remains a user action.
- For `queued` or `running`, show the backend's real status/stage and refresh/reconnect guidance. Do not invent percentages, document counters, or progress.
- For `completed`, show a completion state and a prominent **View results** action linking to `/workspaces/[sessionId]/results`.
- For `failed`, show the safe failure explanation and a route back to the workspace. Do not display a false completion state or issue an automatic retry.
- Opening/reloading this route only reads the existing workspace. It must not upload files, create a replacement workspace, or start another run.

### 5.3 Results page

- Load the saved workspace status and result for the route's `sessionId`.
- Render results only when workspace status is `completed` and structured result data is present. Reuse the existing aircraft viewer, component details, extraction summaries, validation annotations, and document outcome reasons.
- Keep extraction status separate from database validation; source-supported values remain visible with validation status/reason alongside them.
- Keep skipped and failed document outcomes visible with their reasons. Do not present them as extracted aircraft assets.
- Show a **Back to workflow** link and **New batch** action.
- If the route is opened while `uploading`, `queued`, or `running`, explain that results are not ready and offer a link to the process page. Do not start the workflow from this page.
- If the workspace is `failed`, show a safe failure state and a link back to the process page. If the workspace or results are missing, show a useful unavailable state rather than a blank page or fabricated data.
- Preserve any existing result filters (including a future reporting-period filter) within the results page; they must not affect workflow execution or mutate saved data.

## 6. State and API rules

- Reuse the current workspace status/result API. No upload, workflow, polling, or extraction API contract changes are required for this epic.
- Keep one source of truth: persisted server workspace status. Avoid passing full results between pages through query strings, client storage, or navigation state.
- Fetch the workspace by `sessionId` on direct route load and after browser refresh. Use the existing polling/reconnect rules only on the process page while work is active.
- The results page may fetch once on entry or refresh while it is nonterminal, but it must not start processing. If it chooses to poll, use bounded/appropriate status refresh and clearly indicate that only status is being checked.
- Prevent duplicate starts using the existing backend safeguards and UI pending state. The separation of routes must not weaken idempotency.
- Keep existing API response redaction, text sanitization, escaping, and sensitive-data protections.

## 7. Implementation map

| File | Proposed responsibility |
|---|---|
| `web/app/page.tsx` and `web/components/dashboard-shell.tsx` | Keep the landing/upload step focused; add shared step navigation where appropriate. |
| `web/app/workspaces/[sessionId]/page.tsx` | Remain the process route and render only workflow status/actions. |
| `web/app/workspaces/[sessionId]/results/page.tsx` (proposed) | Add a direct-loadable results route with completed-state gating. |
| `web/components/workspace-monitor.tsx` | Split or configure the existing component so workflow monitoring does not also render the results section. |
| `web/components/aircraft-results.tsx` | Reuse on the results route without changing the underlying aircraft data model. |
| `web/lib/workspace-api.ts` | Reuse status retrieval; change only if route needs a shared, typed result loader. |
| `web/app/globals.css` | Style the step indicator and focused page layouts in the aviation theme. |
| `web/tests/workflow-ui.test.tsx` and route tests | Cover navigation, status gates, direct route access, and no duplicate workflow starts. |

## 8. Accessibility and visual design

- Use consistent headers, page titles, workspace identity, and a compact step indicator across all three routes.
- Visually distinguish the current step while keeping previous/next navigation discoverable.
- Keep focus visible, controls keyboard-operable, and status changes announced politely.
- Use responsive layouts; avoid moving large result sections into accordions that hide important extraction data by default.
- Use subtle page transitions only. Respect reduced-motion settings and never use decorative animation as workflow progress.
- Preserve the existing navy, teal, amber, and aircraft visual theme without reintroducing large white surfaces or excessive vertical spacing.

## 9. Acceptance criteria

- A user can complete the flow as Upload → Process → Results using clear page-level actions.
- Successful upload navigates to the process page but does not start processing.
- Processing starts only after the user explicitly chooses **Start workflow**.
- The process page shows actual workspace state and no extraction result cards.
- On completion, **View results** opens the results route and displays the saved result.
- Directly opening or refreshing the results route correctly handles completed, active, failed, missing-workspace, and missing-result states.
- Results and document outcome behavior match the existing result view; skipped/failed files and validation reasons remain available.
- Browser back/forward and recent-workspace navigation do not duplicate uploads or workflow starts.
- No full result data, document text, absolute paths, or sensitive values are put in URLs or browser storage.
- Desktop and mobile layouts remain usable; keyboard focus, screen-reader status, and reduced-motion behavior pass checks.
- Tests verify route transitions and state gating; web tests, lint, typecheck, and production build pass.

## 10. Out of scope

- Changing file selection rules, upload limits, workflow semantics, extraction schema, database validation, or workspace API contracts.
- Automatically retrying failed workspaces or starting a run from the results page.
- Authentication, multi-user access control, and new server-side result storage formats.
- Adding reporting-period filter behavior beyond preserving it on the results page if implemented separately.

## 11. Definition of done

Upload, process, and results are separate focused pages connected by clear navigation. The upload and explicit-start safeguards remain unchanged, all routes recover from persisted workspace state, and the completed extraction results are available on a dedicated results route without exposing sensitive data.
