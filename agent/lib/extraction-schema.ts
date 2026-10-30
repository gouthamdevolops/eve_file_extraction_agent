import { z } from "zod";

export const fieldSchema = z.object({
  name: z.string(),
  value: z.string(),
  confidence: z.number().min(0).max(100),
});

const summaryFieldsSchema = z.tuple([
  fieldSchema.extend({ name: z.literal("total_month_cycles") }),
  fieldSchema.extend({ name: z.literal("total_month_hours") }),
  fieldSchema.extend({ name: z.literal("total_new_cycles") }),
  fieldSchema.extend({ name: z.literal("total_new_time") }),
  fieldSchema.extend({ name: z.literal("aircraft_type") }),
]);

export const componentSchema = z.object({
  SerialNumber: z.string().nullable(),
  TSN: z.number().nullable(),
  CSN: z.number().nullable(),
  MonthlyUtil_Hrs: z.number().nullable(),
  MonthlyUtil_Cyc: z.number().nullable(),
  attachment_status: z.string().nullable(),
  derate: z.string().nullable(),
  location: z.string().nullable(),
  extraction_confidence: z.number().min(0).max(1),
  raw_source_text: z.string().nullable(),
  available: z.boolean(),
  TSN_raw: z.string().nullable(),
  CSN_raw: z.string().nullable(),
  MonthlyUtil_Hrs_raw: z.string().nullable(),
  MonthlyUtil_Cyc_raw: z.string().nullable(),
  source_file: z.string().nullable(),
  current_aircraft: z.string().nullable(),
});

export const extractionSchema = z.object({
  fields: summaryFieldsSchema,
  components: z.object({
    Airframe: componentSchema,
    Engine1: componentSchema,
    Engine2: componentSchema,
    APU: componentSchema,
    LandingGearLeft: componentSchema,
    LandingGearRight: componentSchema,
    LandingGearNose: componentSchema,
  }),
  savedAt: z.string().datetime(),
});
