import fs from "node:fs";
import sql from "mssql";

function loadEnvFile(path = ".env") {
  const contents = fs.readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const values = {};

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[match[1]] = value;
  }

  return values;
}

let pool;
try {
  const env = loadEnvFile();
  for (const name of ["DB_HOST", "DB_USERNAME", "DB_PASSWORD", "DB_DATABASE"]) {
    if (!env[name]?.trim()) throw new Error(`Missing ${name} in .env`);
  }

  pool = await new sql.ConnectionPool({
    server: env.DB_HOST,
    port: Number(env.DB_PORT || 1433),
    user: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_DATABASE,
    connectionTimeout: 10_000,
    requestTimeout: 15_000,
    options: {
      encrypt: true,
      trustServerCertificate: false,
      enableArithAbort: true,
    },
  }).connect();

  await pool.request().query("SELECT 1 AS ok");
  console.log("Database connection successful (SELECT 1). ");
} catch (error) {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "CONNECTION_ERROR";
  console.error(`Database connection failed (${code}). Credentials were not printed.`);
  process.exitCode = 1;
} finally {
  if (pool) await pool.close().catch(() => {});
}
