import { z } from "zod";

export const PreparedDocumentSchema = z.discriminatedUnion("status", [
  z.object({
    sourcePath: z.string(),
    sourceName: z.string(),
    status: z.literal("prepared"),
    textPath: z.string().min(1),
    error: z.null(),
  }),
  z.object({
    sourcePath: z.string(),
    sourceName: z.string(),
    status: z.literal("failed"),
    textPath: z.null(),
    error: z.string().min(1),
  }),
]);

export const DocumentsManifestSchema = z.object({
  sessionId: z.string().min(1),
  documents: z.array(PreparedDocumentSchema),
});

export type PreparedDocument = z.infer<typeof PreparedDocumentSchema>;
export type DocumentsManifest = z.infer<typeof DocumentsManifestSchema>;
