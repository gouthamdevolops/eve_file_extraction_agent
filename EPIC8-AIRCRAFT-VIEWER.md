# Epic 8: Aircraft results viewer

> Extends Epic 7's result view. When a workflow finishes, each **completed** extraction is shown as an interactive plan-view aircraft skeleton matching its type, with every tracked component hoverable for its extracted data.

## 1. What the extraction gives us

Source: `extractionResults[]` in `pipeline-results.json` (see `agent/tools/process_folder.ts` and `agent/lib/extraction-schema.ts`).

| Data | Where | Used for |
|---|---|---|
| `aircraft_type` (+ confidence) | `data.fields` | Choosing the skeleton family; identity strip |
| `total_month_hours`, `total_month_cycles`, `total_new_time`, `total_new_cycles` (+ confidence 0–100) | `data.fields` | Summary tiles with confidence meters |
| Registration, MSN, tracked flag | `classification.identityValidation.documents[].assets` (fallback: `classification.documents[].identifiers`) | Heading and identity strip |
| Reporting period | validation document → classified document → batch period | Identity strip |
| 7 component slots: Airframe, Engine1, Engine2, APU, LandingGearNose/Left/Right | `data.components` | Hotspots on the skeleton |
| Per component: serial, TSN, CSN, monthly hours/cycles (+ `_raw` source formatting), derate, attachment status, location, installed-on aircraft, `extraction_confidence` 0–1, `available` | `data.components[slot]` | Tooltip and detail card |
| Per component: `validated` / `excluded` + reason | `componentValidation` | Component health and explanation |

## 2. Requirements

### R1 — Skeleton by aircraft type
- Classify `aircraft_type` into a family; render a top-down (nose up, left = port) plan view:

| Family | Examples | Distinguishing geometry |
|---|---|---|
| Narrow-body twin | A319/320/321, A220, 737/MAX, 757, E-Jets, C919 | Swept wing, under-wing engines, 2-wheel main gear |
| Wide-body twin | A300/310, A330, A350, 767, 777, 787 | Longer/wider fuselage, larger nacelles, 4-wheel bogie main gear |
| Wide-body four-engine | A340, A380, 747 | Four nacelles; positions 3–4 drawn greyed (outside the 2-engine schema) |
| Regional, rear engines | CRJ, ERJ-135/145, MD-80/90, 717, Fokker 70/100 | Clean wing, fuselage-mounted rear engines, T-tail |
| Twin turboprop | ATR 42/72, Dash 8 / Q400, Saab 340 | Straight high wing, propellers, T-tail |
| Unknown / not found | — | Generic twin jet, labelled "type not recognised" |

- Engines are numbered left→right as seen from above (operator convention). For four-engine types, `Engine1`/`Engine2` map to positions 1 (left outboard) and 2 (left inboard).

### R2 — Hover and select
- Hovering **or keyboard-focusing** any engine, APU, landing gear or the airframe shows a tooltip: name, serial, health, TSN, CSN, hours/cycles this month, derate (engines), confidence — or the exclusion reason when there is no data.
- Click / Enter / Space pins the component in the detail card, which adds attachment status, location, installed-on aircraft, source formatting ("as written") where it differs from the normalised number, and the validation reason.
- Every component is also reachable from an accessible table below the skeleton.

### R3 — Truthful component health
| Health | Rule | Colour |
|---|---|---|
| Extracted | Serial validated against the DB **and** `available` **and** confidence ≥ 60% | Green |
| Low confidence | As above with confidence < 60%; detail card warns to verify against source | Amber |
| Not validated | Serial or values found in the document but no tracked DB match | Red, dashed |
| Not found | No serial and no values in the document | Grey, dashed |

The pipeline returns every source-supported value and uses the database match only to annotate it. Values for unvalidated components are therefore shown, with the red status and a warning to verify them before use.

### R4 — Aircraft summary
- Heading = registration (fallback MSN). Identity strip: registration ✓tracked, MSN ✓tracked, type + family, reporting period, components with data (n / 7).
- Four summary tiles with confidence meters. "Not found" is shown as such, never as zero.

### R5 — Multiple documents
- One view per completed extraction; a document selector switches between them. Skipped/failed documents continue to appear in the existing outcome list with reasons, and never in the aircraft viewer.

### R6 — Privacy and safety (inherits Epic 7 §5.5)
- The view model copies only whitelisted fields; `sourcePath`, `raw_source_text`, `source_file` and excerpts never reach the UI. All strings pass through `sanitizeText` and are React-escaped.

### R7 — Responsive and accessible
- Two columns (skeleton | detail) on desktop, stacked below 760 px. Hotspots are `role="button"` with descriptive labels, `aria-pressed`, and `aria-describedby` on the open tooltip; detail card is `aria-live="polite"`.

## 3. Implementation map

| File | Role |
|---|---|
| `web/lib/aircraft-view.ts` | Pipeline result → `AircraftView[]`; `aircraftFamily()`; health rules |
| `web/components/aircraft-silhouette.tsx` | Parametric SVG geometry per family, hotspots, tooltip |
| `web/components/aircraft-results.tsx` | Identity strip, summary tiles, detail card, legend, component table |
| `web/lib/sanitize.ts` | Shared sanitisation (moved out of `workspace-monitor.tsx`) |
| `web/tests/aircraft-view.test.tsx` | Family classification, view-model rules, hover/click/keyboard behaviour |

## 4. Open questions for the lead
1. Is 60% the right low-confidence threshold, or should it be configurable?
2. Four-engine fleets: should the extraction schema grow `Engine3`/`Engine4`?
3. Should the skeleton also offer a side view (e.g. to show gear retracted/extended or derate per engine)?
4. Should validated-but-unavailable components (serial matched, no values in document) get a distinct state rather than "Not found"?
