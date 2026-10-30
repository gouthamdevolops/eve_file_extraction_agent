import sql from "mssql";
import type { config as MssqlConfig, ConnectionPool } from "mssql";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Missing required database setting: ${name}`);
  return value;
}

function mssqlConfig(): MssqlConfig {
  return {
    server: requiredEnv("DB_HOST"),
    port: 1433,
    user: requiredEnv("DB_USERNAME"),
    password: requiredEnv("DB_PASSWORD"),
    database: requiredEnv("DB_DATABASE"),
    connectionTimeout: 10_000,
    requestTimeout: 15_000,
    pool: { max: 2, min: 0, idleTimeoutMillis: 30_000 },
    options: {
      encrypt: true,
      trustServerCertificate: false,
      enableArithAbort: true,
    },
  };
}

export async function withMssqlConnection<T>(operation: (pool: ConnectionPool) => Promise<T>): Promise<T> {
  const config = mssqlConfig();
  const pool = new sql.ConnectionPool(config);
  try {
    await pool.connect();
    return await operation(pool);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "CONNECTION_ERROR";
    throw new Error(`MSSQL operation failed (${code}).`);
  } finally {
    await pool.close();
  }
}

export async function inspectMssqlSchema(): Promise<{
  connected: true;
  databaseType: "mssql";
  check: "SELECT 1";
  tables: Array<{ schemaName: string; tableName: string; tableType: string }>;
}> {
  return withMssqlConnection(async (pool) => {
    await pool.request().query("SELECT 1 AS [connected]");
    const result = await pool.request().query(
      `SELECT TABLE_SCHEMA AS schemaName,
              TABLE_NAME AS tableName,
              TABLE_TYPE AS tableType
       FROM INFORMATION_SCHEMA.TABLES
       ORDER BY TABLE_SCHEMA, TABLE_NAME`,
    );

    return {
      connected: true,
      databaseType: "mssql",
      check: "SELECT 1",
      tables: result.recordset,
    };
  });
}
