import sql from "mssql";
import { withMssqlConnection } from "./mssql.js";

export type AssetIdentifier = {
  type: "msn" | "registration" | "engine_serial_number" | "apu_serial_number" | "landing_gear_nose_serial_number" | "landing_gear_left_serial_number" | "landing_gear_right_serial_number" | "other_component_identifier";
  value: string;
  evidence: string;
};

export type ClassifiedAssetDocument = {
  sourcePath: string;
  sourceName: string;
  status: string;
  reportingPeriod?: string | null;
  identifiers: AssetIdentifier[];
};

type AircraftRow = {
  id: string;
  month: string;
  registrationNumber: string | null;
  projectData: unknown;
};

type ProjectData = {
  serialNumber?: string;
  registrationNumber?: string;
  components?: Array<{
    type?: string;
    serialNumber?: string;
    status?: string;
  }>;
};

function asProjectData(value: unknown): ProjectData {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  return value && typeof value === "object" ? value as ProjectData : {};
}

function exact(a: unknown, b: string): boolean {
  return typeof a === "string" && a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

function getMsn(_row: AircraftRow, project: ProjectData): string | null {
  return typeof project.serialNumber === "string" && project.serialNumber.trim()
    ? project.serialNumber.trim()
    : null;
}

function trackedProjectComponents(project: ProjectData) {
  // Presence in this exact-period aircraft project record establishes tracking; `status`
  // is an operational/lifecycle label (for example, "On Lease"), not the tracking flag.
  let enginePosition = 0;
  return (project.components ?? []).flatMap((component) => {
    if (!component.type || !component.serialNumber?.trim()) return [];
    let componentType = component.type;
    if (component.type.toLocaleLowerCase() === "engine") {
      enginePosition += 1;
      componentType = `Engine ${enginePosition}`;
    }
    return [{ componentType, serialNumber: component.serialNumber, tracked: true }];
  });
}

function kindMatches(identifierType: AssetIdentifier["type"], componentType: string): boolean {
  const type = componentType.toLocaleLowerCase();
  if (identifierType === "engine_serial_number") return type.startsWith("engine");
  if (identifierType === "apu_serial_number") return type === "apu";
  if (identifierType.startsWith("landing_gear_")) return type.includes("gear") || type.includes("landing");
  return identifierType === "other_component_identifier" && type !== "airframe";
}

export async function validateAssetIdentities(
  reportingPeriod: string | null,
  documents: ClassifiedAssetDocument[],
  signal?: AbortSignal,
) {
  "use step";
  const periods = [...new Set(documents
    .map((document) => document.reportingPeriod !== undefined
      ? document.reportingPeriod?.trim() || null
      : reportingPeriod?.trim() || null)
    .filter((value): value is string => Boolean(value)))];
  if (periods.length === 0) {
    return {
      status: "blocked" as const,
      reportingPeriod: null,
      reason: "No document has a confirmed exact reporting period.",
      documents: documents.map((document) => ({
        sourcePath: document.sourcePath,
        sourceName: document.sourceName,
        reportingPeriod: null,
        assets: document.identifiers.map((identifier) => ({ ...identifier, status: "blocked" as const, reason: "Reporting period is missing or conflicting.", matches: [] })),
      })),
    };
  }

  try {
    return await withMssqlConnection(async (pool) => {
    if (signal?.aborted) throw new Error("Database validation aborted.");
    const rowsByPeriod = new Map<string, AircraftRow[]>();
    for (const period of periods) {
      const request = pool.request();
      request.input("reportingPeriod", sql.NVarChar(100), period);
      const result = await request.query<AircraftRow>(`
        SELECT id, [month], registrationNumber, projectData
        FROM dbo.aircraft
        WHERE [month] = @reportingPeriod
        ORDER BY id
      `);
      rowsByPeriod.set(period, result.recordset);
    }

    const validatedDocuments = documents.map((document) => {
      const documentPeriod = document.reportingPeriod !== undefined
        ? document.reportingPeriod?.trim() || null
        : reportingPeriod?.trim() || null;
      const rows = documentPeriod ? rowsByPeriod.get(documentPeriod) ?? [] : [];
      return {
      sourcePath: document.sourcePath,
      sourceName: document.sourceName,
      reportingPeriod: documentPeriod,
      assets: document.identifiers.map((identifier) => {
        if (!documentPeriod) return { ...identifier, status: "blocked", reason: "Reporting period is missing or conflicting.", matches: [] };
        const matches: Array<Record<string, unknown>> = [];
        for (const row of rows) {
          const project = asProjectData(row.projectData);
          if (identifier.type === "registration" &&
              (exact(row.registrationNumber, identifier.value) || exact(project.registrationNumber, identifier.value))) {
            matches.push({
              assetType: "aircraft",
              databaseId: row.id,
              registrationNumber: row.registrationNumber ?? project.registrationNumber ?? null,
              trackedComponents: trackedProjectComponents(project),
            });
          } else if (identifier.type === "msn" && exact(getMsn(row, project), identifier.value)) {
            matches.push({
              assetType: "aircraft",
              databaseId: row.id,
              serialNumber: getMsn(row, project),
              trackedComponents: trackedProjectComponents(project),
            });
          } else if (["engine_serial_number", "apu_serial_number", "landing_gear_nose_serial_number", "landing_gear_left_serial_number", "landing_gear_right_serial_number", "other_component_identifier"].includes(identifier.type)) {
            for (const component of trackedProjectComponents(project)) {
              if (kindMatches(identifier.type, component.componentType) && exact(component.serialNumber, identifier.value)) {
                matches.push({
                  assetType: "component",
                  databaseId: row.id,
                  componentType: component.componentType,
                  serialNumber: component.serialNumber,
                  tracked: true,
                });
              }
            }
          }
        }
        const confirmed = matches.length === 1 && (matches[0].assetType === "aircraft" || matches[0].tracked === true);
        const status = matches.length > 1 ? "ambiguous" : matches.length === 0 ? "unmatched" : confirmed ? "tracked" : "untracked";
        return {
          ...identifier,
          status,
          reason: status === "tracked" ? "Unique exact match found for the selected reporting period." :
            status === "ambiguous" ? "Multiple exact database matches were found." :
            status === "unmatched" ? "No exact match was found for the selected reporting period." :
            "The component record is not confirmed as tracked for the reporting period.",
          matches,
        };
      }),
    };
    });

    return {
      status: "completed" as const,
      reportingPeriod: periods.length === 1 ? periods[0] : null,
      matchedAircraftRowsByPeriod: Object.fromEntries([...rowsByPeriod].map(([period, rows]) => [period, rows.length])),
      documents: validatedDocuments,
    };
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Database validation failed.";
    return {
      status: "failed" as const,
      reportingPeriod,
      reason,
      documents: documents.map((document) => ({
        sourcePath: document.sourcePath,
        sourceName: document.sourceName,
        reportingPeriod: document.reportingPeriod ?? reportingPeriod,
        assets: document.identifiers.map((identifier) => ({
          ...identifier,
          status: "database_error" as const,
          reason,
          matches: [],
        })),
      })),
    };
  }
}
