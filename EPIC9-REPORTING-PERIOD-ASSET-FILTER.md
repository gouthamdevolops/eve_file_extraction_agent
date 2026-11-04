# Epic 9: Filter extracted aircraft by reporting period

> Extends Epic 8's aircraft results viewer. A user selects a reporting month and year, sees only aircraft assets extracted for that period, and selects an asset to inspect its extraction details below.

## 1. Goal

Make completed extraction results easier to browse across multiple reporting periods. The user can filter the aircraft asset list by an exact month-and-year period, choose an aircraft asset, and review that asset's summary, component extraction, and validation information.

The filter is a view-only control over the saved workflow result. Changing it must not upload files, start/retry a workflow, or alter extraction data.

## 2. User story

> As an aircraft operations user, I want to select a reporting month and year and see the aircraft assets extracted for that period, so I can open an asset and inspect its extraction details without unrelated periods in the way.

## 3. User experience

1. On the completed workflow results page, show a **Reporting period** filter above the aircraft asset list.
2. Offer **All periods**, one option per exact confirmed period (for example, **August 2026**), and **Period not confirmed** when such completed assets exist. Show an asset count for each option where practical.
3. Sort confirmed periods newest first. Never combine the same month from different years.
4. Selecting a period filters the aircraft asset choices to completed extractions for that exact period. A visible selected-period label makes the scope clear.
5. Show the matching aircraft assets as distinct selectable cards or rows, with useful identity labels such as registration, MSN, aircraft type, and source filename where available.
6. Selecting an asset displays its existing aircraft viewer and extraction details below the asset choices: identity, summary tiles, aircraft silhouette, component details, and component table. Selecting another asset updates that detail area.
7. **All periods** shows every completed extracted asset. The initial selection is **All periods** so the page does not hide results by default.
8. If a period has no completed aircraft assets, show a clear empty state; do not leave stale details from a previously selected asset on screen.

Skipped and failed documents are not aircraft assets. Keep them and their reasons available in the existing document-outcomes section, regardless of the selected aircraft period. Label batch-wide overview counts as applying to the entire workflow so the filter cannot make them appear period-specific.

## 4. Period and asset rules

- A period is a canonical **month plus year**, such as `August 2026`. `August 2025` and `August 2026` are separate options.
- Derive options from reporting periods on completed aircraft views; do not hard-code a calendar or include periods with no extracted assets.
- Normalize equivalent explicit spellings before comparison (for example, `Aug 2026` and `August 2026`). Invalid, conflicting, or missing periods must not be silently assigned to a month.
- Prefer each document's confirmed reporting period. A batch target may be a fallback only if the workflow guarantees that the completed extraction passed that exact period filter. Otherwise place the asset under **Period not confirmed**.
- Preserve distinct completed extraction records, even if two documents resolve to the same registration/MSN and period. Do not merge aircraft or component values in this epic.
- Filtering is client-side over the already returned, sanitized result. It must not query the database or trigger another workflow run.

## 5. Data and privacy

- Reuse the `AircraftView[]` model and its whitelisted fields. Add a small period-filter/view-model helper only if needed to normalize/sort periods and filter assets deterministically.
- Keep source paths, document text, raw excerpts, credentials, and other non-whitelisted data out of the filter options, asset cards, and detail view.
- Continue sanitizing user-visible strings. Period labels must come from parsed result values, not HTML or document markup.
- A selected asset is identified by a stable per-result key, not by registration or MSN alone, because multiple documents can describe the same aircraft in one period.

## 6. Implementation map

| File | Responsibility |
|---|---|
| `web/lib/aircraft-view.ts` | Preserve each completed extraction's document-level confirmed reporting period and stable asset key. Avoid treating an unconfirmed period as confirmed. |
| `web/lib/reporting-period-filter.ts` (proposed) | Normalize display/comparison keys, derive unique period options, sort newest first, and filter assets including the unconfirmed bucket. |
| `web/components/aircraft-results.tsx` | Add the period selector, filtered asset choices, selected-asset state, empty state, and detail area beneath the choices. |
| `web/components/workspace-monitor.tsx` | Continue passing completed aircraft views; keep skipped/failed outcomes and workflow-wide counts intact. |
| `web/app/globals.css` | Style the period selector and asset choices in the existing navy/teal/amber theme with responsive layouts and visible focus. |
| `web/tests/aircraft-period-filter.test.ts` (proposed) | Test period normalization, year separation, filtering, ordering, unknown periods, and asset selection. |
| `web/tests/workflow-ui.test.tsx` | Verify selecting a period filters assets and selecting an asset displays its details. |

## 7. Accessibility and responsive behavior

- Use a labelled native `<select>` or an equivalently keyboard-operable control for period selection.
- Asset choices must be buttons with accessible names and a visible selected state (`aria-pressed` or equivalent).
- Keep keyboard focus visible and announce the filtered asset count and empty state politely without making the entire result panel a live region.
- On narrow screens, stack the period filter, asset choices, and selected asset details naturally. Do not force horizontal page scrolling.
- Respect `prefers-reduced-motion`; any filter/detail transition must be brief, nonessential, and disabled for reduced motion.

## 8. Acceptance criteria

- A completed result containing assets from multiple periods offers the correct unique month/year options and defaults to **All periods**.
- Selecting a period shows only completed aircraft assets whose confirmed period exactly matches it; the same month in another year is excluded.
- Assets without a trustworthy document period are not silently assigned to a period and remain reachable through **Period not confirmed** or **All periods**.
- Selecting an asset shows that asset's aircraft and extraction information below the asset choices; selecting a different asset updates the details without stale fields.
- Duplicate aircraft identities from separate documents remain separate selectable assets.
- Skipped/failed outcomes and their reasons remain visible and are not counted as extracted aircraft assets.
- Workflow-wide totals remain clearly identified as batch-wide and do not change when the asset filter changes.
- Empty period, no confirmed periods, no aircraft data, and period-not-confirmed states render safely and clearly.
- Filter interaction does not issue API calls, start/retry processing, or mutate the saved result.
- Tests cover period/year matching, missing/conflicting periods, keyboard interaction, and selected-asset details; lint, typecheck, tests, and production build pass.

## 9. Out of scope

- Reprocessing files, selecting a new target period for an existing run, or querying historical database records.
- Combining or deduplicating multiple documents into one aircraft record.
- Editing extracted values, changing database validation, or adding new extraction fields.
- Filtering skipped/failed document outcomes out of the batch record.

## 10. Definition of done

A user can select a reporting month and year, see the aircraft assets extracted for that period, select an asset, and review its extraction details below the asset list. The filter is accurate, accessible, responsive, view-only, and does not hide skipped or failed document outcomes.
