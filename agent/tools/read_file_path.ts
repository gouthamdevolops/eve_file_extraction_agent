import path from "node:path";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { prepareFile } from "../lib/document-preparation.js";

export default defineTool({
  description:
    "Read a supported local document, convert it to Markdown with LiteParse (including OCR where needed), save it under the current session output folder, and return the extracted Markdown.",
  inputSchema: z.object({
    filePath: z.string().min(1).describe("Full path to a supported file accessible to the machine running this agent."),
    sessionId: z
      .string()
      .optional()
      .describe("Optional explicit output session folder name. Defaults to the current session."),
  }),
  async execute({ filePath, sessionId: requestedSessionId }, ctx) {
    const sessionId = requestedSessionId ?? ctx.session.id;
    const sessionDir = path.join(process.cwd(), "output", sessionId);
    const result = await prepareFile(filePath, sessionDir);

    if (result.status === "failed") {
      return { fileName: result.sourceName, error: result.error };
    }

    return {
      fileName: result.sourceName,
      markdownFilePath: path.resolve(process.cwd(), result.textPath),
      content: result.markdown,
    };
  },
});
