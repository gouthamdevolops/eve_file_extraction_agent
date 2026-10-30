import { defineTool } from "eve/tools";
import { inspectMssqlSchema } from "../lib/mssql.js";

export default defineTool({
  description:
    "Check connectivity to the configured Microsoft SQL Server database using read-only SELECT queries and list INFORMATION_SCHEMA.TABLES metadata. Never returns credentials or table records.",
  inputSchema: {},
  async execute() {
    return inspectMssqlSchema();
  },
});
