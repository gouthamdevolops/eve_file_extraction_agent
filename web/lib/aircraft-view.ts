import { displayName, sanitizeText } from "@/lib/sanitize";

export const COMPONENT_SLOTS = ["Airframe", "Engine1", "Engine2", "APU", "LandingGearNose", "LandingGearLeft", "LandingGearRight"] as const;
export type ComponentSlot = (typeof COMPONENT_SLOTS)[number];

export const COMPONENT_LABELS: Record<ComponentSlot, string> = {
  Airframe: "Airframe",
  Engine1: "Engine 1 (left)",
  Engine2: "Engine 2 (right)",
  APU: "APU",
  LandingGearNose: "Nose landing gear",
  LandingGearLeft: "Left main landing gear",
  LandingGearRight: "Right main landing gear",
};

/** Silhouette families. Each maps to one plan-view skeleton in AircraftSilhouette. */
export type AircraftFamily = "narrowbody" | "widebody" | "widebody-quad" | "regional-rear" | "turboprop" | "unknown";

export const FAMILY_LABELS: Record<AircraftFamily, string> = {
  narrowbody: "Narrow-body twin jet",
  widebody: "Wide-body twin jet",
  "widebody-quad": "Wide-body four-engine jet",
  "regional-rear": "Regional jet, rear-mounted engines",
  turboprop: "Twin turboprop",
  unknown: "Generic twin jet (type not recognised)",
};

/** Ordered most-specific first: e.g. A340 must win over the A3xx narrow-body pattern, ERJ-145 over E-Jets. */
const FAMILY_PATTERNS: Array<[AircraftFamily, RegExp]> = [
  ["widebody-quad", /A34\d|A38\d|747|IL96/],
  ["turboprop", /ATR|DASH8|DHC8|Q[234]00|SAAB(340|2000)|DO328(?!JET)|EMB120|JETSTREAM|KINGAIR|DHC6|TWINOTTER|MA60/],
  ["widebody", /A300|A310|A33\d|A35\d|7[678]7|B7[678]\d|B77W|DC10|MD11/],
  ["regional-rear", /CRJ|CL600|CANADAIR|(ERJ|EMB|EMBRAER)1[34][05]|FOKKER(70|100)|MD[89]\d|DC9|717|ARJ21/],
  ["narrowbody", /A31[89]|A32[01]|A220|BD500|CS[13]00|737|B73\d|B3[89]M|7M[789]|757|B75\d|(E|ERJ|EMB|EMBRAER)1[79]\d|E2|C919|SSJ|SUPERJET|MC21/],
];

/** Four-engine types number 1–4 left to right; the schema's two engine slots are positions 1 and 2. */
export function componentLabel(slot: ComponentSlot, family: AircraftFamily): string {
  if (family === "widebody-quad" && slot === "Engine1") return "Engine 1 (left outboard)";
  if (family === "widebody-quad" && slot === "Engine2") return "Engine 2 (left inboard)";
  return COMPONENT_LABELS[slot];
}

export function aircraftFamily(aircraftType: string | null): AircraftFamily {
  if (!aircraftType) return "unknown";
  const compact = aircraftType.toUpperCase().replace(/[\s_\-./]/g, "");
  return FAMILY_PATTERNS.find(([, pattern]) => pattern.test(compact))?.[0] ?? "unknown";
}

export type ComponentHealth = "extracted" | "low-confidence" | "excluded" | "not-found";

export interface ComponentView {
  slot: ComponentSlot;
  label: string;
  health: ComponentHealth;
  serialNumber: string | null;
  validation: "validated" | "excluded" | "unknown";
  reason: string | null;
  /** True when the document supplied values, whether or not the serial matched the database. */
  hasValues: boolean;
  tsn: number | null;
  csn: number | null;
  monthlyHours: number | null;
  monthlyCycles: number | null;
  tsnRaw: string | null;
  csnRaw: string | null;
  monthlyHoursRaw: string | null;
  monthlyCyclesRaw: string | null;
  attachmentStatus: string | null;
  derate: string | null;
  location: string | null;
  currentAircraft: string | null;
  /** 0–1, as returned by the extractor. */
  confidence: number | null;
}

export interface SummaryFieldView {
  name: string;
  label: string;
  value: string | null;
  /** 0–100, as returned by the extractor. */
  confidence: number;
}

export interface IdentityView {
  type: "msn" | "registration";
  value: string;
  tracked: boolean;
}

export interface AircraftView {
  key: string;
  sourceName: string;
  documentType: string | null;
  reportingPeriod: string | null;
  aircraftType: string | null;
  family: AircraftFamily;
  registration: IdentityView | null;
  msn: IdentityView | null;
  summary: SummaryFieldView[];
  components: Record<ComponentSlot, ComponentView>;
}

export const LOW_CONFIDENCE = 0.6;

const SUMMARY_LABELS: Record<string, string> = {
  total_month_hours: "Hours this month",
  total_month_cycles: "Cycles this month",
  total_new_time: "Total time since new",
  total_new_cycles: "Total cycles since new",
  aircraft_type: "Aircraft type",
};

type Json = Record<string, unknown>;

function record(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
}

function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.map(record).filter((item): item is Json => item !== null) : [];
}

/** Extractor uses "Not found" / "" for missing text; treat those as absent. */
function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /^(not found|n\/?a|null|none|unknown)$/i.test(trimmed)) return null;
  return sanitizeText(trimmed);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function componentView(slot: ComponentSlot, data: Json | null, validation: Json | null, summary: Json | null): ComponentView {
  const validated = validation?.status === "validated";
  // The pipeline returns every source-supported value; the database match only annotates it.
  const available = data?.available === true;
  const confidence = num(data?.extraction_confidence);
  const serialNumber = text(validation?.serialNumber) ?? text(data?.SerialNumber);
  const health: ComponentHealth = !validated
    ? (serialNumber || available ? "excluded" : "not-found")
    : !available
      ? "not-found"
      : confidence !== null && confidence < LOW_CONFIDENCE ? "low-confidence" : "extracted";
  return {
    slot,
    label: COMPONENT_LABELS[slot],
    health,
    hasValues: available,
    serialNumber,
    validation: validated ? "validated" : validation?.status === "excluded" ? "excluded" : "unknown",
    reason: text(validation?.reason) ?? text(summary?.reason),
    tsn: available ? num(data?.TSN) : null,
    csn: available ? num(data?.CSN) : null,
    monthlyHours: available ? num(data?.MonthlyUtil_Hrs) : null,
    monthlyCycles: available ? num(data?.MonthlyUtil_Cyc) : null,
    tsnRaw: available ? text(data?.TSN_raw) : null,
    csnRaw: available ? text(data?.CSN_raw) : null,
    monthlyHoursRaw: available ? text(data?.MonthlyUtil_Hrs_raw) : null,
    monthlyCyclesRaw: available ? text(data?.MonthlyUtil_Cyc_raw) : null,
    attachmentStatus: available ? text(data?.attachment_status) : null,
    derate: available ? text(data?.derate) : null,
    location: available ? text(data?.location) : null,
    currentAircraft: available ? text(data?.current_aircraft) : null,
    confidence: available ? confidence : null,
  };
}

/**
 * Builds one aircraft view per completed extraction. Only whitelisted fields are copied, so
 * paths and raw source excerpts from the pipeline result never reach the rendered view.
 */
export function buildAircraftViews(result: unknown): AircraftView[] {
  const root = record(result);
  if (!root) return [];
  const classification = record(root.classification);
  const classified = list(classification?.documents);
  const validated = list(record(classification?.identityValidation)?.documents);
  const batchPeriod = text(record(classification?.reportingPeriod)?.value);

  return list(root.extractionResults).flatMap((outcome, index) => {
    const data = record(outcome.data);
    if (outcome.status !== "completed" || !data) return [];
    const sourceKey = typeof outcome.sourcePath === "string" ? outcome.sourcePath : outcome.sourceName;
    const sameDocument = (item: Json) => (typeof item.sourcePath === "string" ? item.sourcePath : item.sourceName) === sourceKey;
    const classifiedDoc = classified.find(sameDocument) ?? null;
    const validatedDoc = validated.find(sameDocument) ?? null;

    const identity = (type: "msn" | "registration"): IdentityView | null => {
      const assets = list(validatedDoc?.assets).filter((asset) => asset.type === type);
      const source = assets.length ? assets : list(classifiedDoc?.identifiers).filter((asset) => asset.type === type);
      const best = source.find((asset) => asset.status === "tracked") ?? source[0];
      const value = text(best?.value);
      return value ? { type, value, tracked: best?.status === "tracked" } : null;
    };

    const fields = list(data.fields);
    const summary = fields.map((field) => {
      const name = typeof field.name === "string" ? field.name : "";
      return { name, label: SUMMARY_LABELS[name] ?? name, value: text(field.value), confidence: num(field.confidence) ?? 0 };
    });
    const aircraftType = summary.find((field) => field.name === "aircraft_type")?.value ?? null;

    const components = record(data.components);
    const validations = list(outcome.componentValidation);
    const summaries = list(outcome.componentSummary);
    const componentViews = Object.fromEntries(COMPONENT_SLOTS.map((slot) => [slot, componentView(
      slot,
      record(components?.[slot]),
      validations.find((item) => item.component === slot) ?? null,
      summaries.find((item) => item.component === slot) ?? null,
    )])) as Record<ComponentSlot, ComponentView>;

    const sourceName = typeof outcome.sourceName === "string" ? displayName(outcome.sourceName) : `Document ${index + 1}`;
    return [{
      key: `${index}-${sourceName}`,
      sourceName,
      documentType: text(classifiedDoc?.documentType),
      reportingPeriod: text(validatedDoc?.reportingPeriod) ?? text(classifiedDoc?.reportingPeriod) ?? batchPeriod,
      aircraftType,
      family: aircraftFamily(aircraftType),
      registration: identity("registration"),
      msn: identity("msn"),
      summary: summary.filter((field) => field.name !== "aircraft_type"),
      components: componentViews,
    }];
  });
}

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function formatNumber(value: number | null): string {
  return value === null ? "—" : numberFormat.format(value);
}
