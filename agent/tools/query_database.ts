import { defineTool } from "eve/tools";
import { z } from "zod";
import { queryDatabase } from "../lib/database.js";

export default defineTool({
  description: "Run a single simple SELECT against the configured Azure SQL database using DB_* environment variables. Omit query to test connectivity with SELECT 1 AS ok. No writes, comments, batches, or CTEs. Results are limited; use TOP and WHERE to minimize data returned. Database credentials must have read-only permissions.",
  availableInSubagents: false,
  inputSchema: z.object({
    query: z.string().trim().min(1).max(10_000).default("SELECT 1 AS ok"),
    maxRows: z.number().int().min(1).max(1000).default(100),
  }),
  label: { start: () => "Query Azure SQL database" },
  async execute({ query, maxRows }, ctx) {
    return queryDatabase(query, maxRows, ctx.abortSignal);
  },
});
