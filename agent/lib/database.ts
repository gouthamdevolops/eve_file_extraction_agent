import sql from "mssql";

export function databaseConfig(env: NodeJS.ProcessEnv = process.env): sql.config {
  const required = ["DB_HOST", "DB_USERNAME", "DB_PASSWORD", "DB_DATABASE"] as const;
  for (const name of required) {
    if (!env[name]?.trim()) throw new Error(`Missing environment variable: ${name}`);
  }
  const port = Number(env.DB_PORT ?? "1433");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("DB_PORT must be an integer between 1 and 65535.");
  }
  return {
    server: env.DB_HOST!,
    user: env.DB_USERNAME!,
    password: env.DB_PASSWORD!,
    database: env.DB_DATABASE!,
    port,
    options: { encrypt: true, trustServerCertificate: false },
    connectionTimeout: 15_000,
    requestTimeout: 15_000,
    pool: { min: 0, max: 1 },
  };
}

export function validateSelect(query: string): string {
  const statement = query.trim().replace(/;$/, "").trim();
  // Deliberately conservative: one simple SELECT, no comments or batches.
  // This is a convenience guard, NOT a SQL security boundary. Use a read-only DB user.
  if (!/^SELECT\b/i.test(statement)
    || /;|--|\/\*|\*\//.test(statement)
    || /\b(INSERT|UPDATE|DELETE|MERGE|INTO|EXEC|EXECUTE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|DENY|BACKUP|RESTORE|DBCC|WAITFOR|SET|USE|NEXT|OPENROWSET|OPENQUERY|OPENDATASOURCE)\b/i.test(statement)) {
    throw new Error("Only a single simple SELECT is supported (no comments, batches, writes, or SELECT INTO).");
  }
  return statement;
}

export async function queryDatabase(
  query = "SELECT 1 AS ok",
  maxRows = 100,
  signal?: AbortSignal,
) {
  const statement = validateSelect(query);
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 1000) {
    throw new Error("maxRows must be an integer between 1 and 1000.");
  }
  signal?.throwIfAborted();
  const pool = new sql.ConnectionPool(databaseConfig());
  let request: sql.Request | undefined;
  const cancel = () => request?.cancel();
  try {
    await pool.connect();
    signal?.throwIfAborted();
    request = pool.request();
    signal?.addEventListener("abort", cancel, { once: true });
    const result = await request.query(`SET ROWCOUNT ${maxRows + 1};\n${statement}`);
    const rows = result.recordset.slice(0, maxRows);
    // SQL dates, binary values and big integers must cross a JSON tool boundary.
    return {
      rows: JSON.parse(JSON.stringify(rows, (_key, value) => typeof value === "bigint" ? value.toString() : value)) as Record<string, unknown>[],
      rowCount: rows.length,
      truncated: result.recordset.length > maxRows,
    };
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted();
    // Driver messages can contain connection details. Expose only a safe code.
    const code = error instanceof Error && "code" in error ? String(error.code) : "UNKNOWN";
    const safeCode = /^[A-Z_]{1,40}$/.test(code) ? code : "UNKNOWN";
    throw new Error(`Database request failed (${safeCode}). Check DB_* settings, Azure SQL firewall/network access, and database permissions.`);
  } finally {
    signal?.removeEventListener("abort", cancel);
    await pool.close();
  }
}