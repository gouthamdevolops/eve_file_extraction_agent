import { defineTool } from "eve/tools";
import { z } from "zod";
import { validateAssetIdentities } from "../lib/asset-validation.js";

const identifierSchema = z.object({
  type: z.enum(["msn", "registration", "engine_serial_number", "apu_serial_number", "other_component_identifier"]),
  value: z.string().min(1),
  evidence: z.string().min(1),
});

export default defineTool({
  description: "Validate document-supported aircraft and component identifiers against dbo.aircraft for the exact selected reporting period. Uses read-only database access; does not infer missing identities or periods.",
  availableInSubagents: false,
  inputSchema: z.object({
    reportingPeriod: z.string().nullable(),
    documents: z.array(z.object({
      sourcePath: z.string(),
      sourceName: z.string(),
      status: z.string(),
      identifiers: z.array(identifierSchema),
    })),
  }),
  label: { start: () => "Validate tracked aircraft and components" },
  async execute({ reportingPeriod, documents }, ctx) {
    return validateAssetIdentities(reportingPeriod, documents, ctx.abortSignal);
  },
});
