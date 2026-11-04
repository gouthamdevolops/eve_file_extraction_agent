// Synthetic pipeline result shaped like agent/tools/process_folder.ts output. Not customer data.

function component(overrides: Record<string, unknown> = {}) {
  return {
    SerialNumber: null, TSN: null, CSN: null, MonthlyUtil_Hrs: null, MonthlyUtil_Cyc: null,
    attachment_status: null, derate: null, location: null, extraction_confidence: 0,
    raw_source_text: "", available: false, TSN_raw: null, CSN_raw: null,
    MonthlyUtil_Hrs_raw: null, MonthlyUtil_Cyc_raw: null, source_file: null, current_aircraft: null,
    ...overrides,
  };
}

const sourcePath = "/data/workspaces/ff23ed53/uploads/Reports/G-EVEA_AUG2026.pdf";

export const pipelineResult = {
  sessionId: "synthetic",
  classification: {
    reportingPeriod: { value: "August 2026", evidence: [] },
    identityValidation: {
      status: "completed",
      documents: [{
        sourcePath,
        sourceName: "Reports/G-EVEA_AUG2026.pdf",
        reportingPeriod: "August 2026",
        assets: [
          { type: "registration", value: "G-EVEA", status: "tracked", reason: "Matched", matches: [] },
          { type: "msn", value: "5123", status: "tracked", reason: "Matched", matches: [] },
        ],
      }],
    },
    documents: [{ sourcePath, sourceName: "Reports/G-EVEA_AUG2026.pdf", status: "classified", documentType: "flight_info", reportingPeriod: "August 2026", identifiers: [] }],
  },
  extractionResults: [
    {
      sourcePath,
      sourceName: "Reports/G-EVEA_AUG2026.pdf",
      status: "completed",
      reason: null,
      data: {
        fields: [
          { name: "total_month_cycles", value: "212", confidence: 92 },
          { name: "total_month_hours", value: "318.5", confidence: 90 },
          { name: "total_new_cycles", value: "18,402", confidence: 88 },
          { name: "total_new_time", value: "41,236:15", confidence: 85 },
          { name: "aircraft_type", value: "A320-214", confidence: 97 },
        ],
        components: {
          Airframe: component({ SerialNumber: "5123", TSN: 41236.25, CSN: 18402, MonthlyUtil_Hrs: 318.5, MonthlyUtil_Cyc: 212, available: true, extraction_confidence: 0.9, TSN_raw: "41,236:15", raw_source_text: "SECRET EXCERPT" }),
          Engine1: component({ SerialNumber: "ESN-779311", TSN: 30112.4, CSN: 14110, MonthlyUtil_Hrs: 318.5, MonthlyUtil_Cyc: 212, derate: "10%", attachment_status: "Installed", location: "Position 1", current_aircraft: "G-EVEA", available: true, extraction_confidence: 0.88 }),
          Engine2: component({ SerialNumber: "ESN-779544", TSN: 28750, CSN: 13020, MonthlyUtil_Hrs: 318.5, MonthlyUtil_Cyc: 212, available: true, extraction_confidence: 0.42 }),
          APU: component(),
          LandingGearLeft: component({ SerialNumber: "MLG-L-2201", TSN: 12000, CSN: 9100, available: true, extraction_confidence: 0.8 }),
          LandingGearRight: component(),
          LandingGearNose: component(),
        },
        savedAt: "2026-09-02T10:00:00.000Z",
      },
      componentValidation: [
        { component: "Airframe", status: "validated", serialNumber: "5123", reason: "Exact component serial matched a tracked database record for the reporting period." },
        { component: "Engine1", status: "validated", serialNumber: "ESN-779311", reason: "Exact component serial matched a tracked database record for the reporting period." },
        { component: "Engine2", status: "validated", serialNumber: "ESN-779544", reason: "Exact component serial matched a tracked database record for the reporting period." },
        { component: "APU", status: "excluded", serialNumber: "APU-0099", reason: "Serial APU-0099 has no unique tracked component match for August 2026." },
        { component: "LandingGearLeft", status: "validated", serialNumber: "MLG-L-2201", reason: "Exact component serial matched a tracked database record for the reporting period." },
        { component: "LandingGearRight", status: "excluded", serialNumber: null, reason: "No component serial number was present in the document, so the component identity could not be checked against the database for this period." },
        { component: "LandingGearNose", status: "excluded", serialNumber: null, reason: "No component serial number was present in the document, so the component identity could not be checked against the database for this period." },
      ],
      componentSummary: [],
    },
    { sourcePath: "/data/x/other.pdf", sourceName: "other.pdf", status: "skipped", reason: "Skipped before database validation: document period July 2026 differs from selected batch period August 2026.", data: null, componentValidation: [], componentSummary: [] },
  ],
};
