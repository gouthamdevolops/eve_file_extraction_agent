import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { prepareFolderStep } from "../lib/document-preparation-workflow.js";

export default defineWorkflowTool({
  description:
    "Prepare every regular file directly inside a local folder for classification by converting supported files to Markdown. Returns the preparation manifest without returning document text.",
  inputSchema: z.object({
    folderPath: z.string().min(1).describe("Path to a folder accessible to the machine running this agent."),
  }),
  async execute({ folderPath }, ctx) {
    "use workflow";
    return prepareFolderStep(folderPath, ctx.session.id);
  },
});
