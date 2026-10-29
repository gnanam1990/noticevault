/**
 * @noticevault/db — database configuration
 *
 * Reads connection parameters from environment variables.
 * Throws on missing required keys rather than using defaults.
 * Never logs connection strings or passwords.
 */

export interface DbConfig {
  readonly host:     string;
  readonly port:     number;
  readonly user:     string;
  readonly password: string;
  readonly database: string;
  /** Schema used for all application tables. */
  readonly schema:   string;
  readonly ssl?: { readonly rejectUnauthorized: true };
  readonly maxConnections?: number;
}

/**
 * Build a DbConfig from process.env.
 * Required: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE.
 * Optional: PGSCHEMA (defaults to "noticevault").
 * Throws on missing required variable.
 */
export function loadDbConfig(): DbConfig {
  function req(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`Missing required env var: ${name}`);
    return v;
  }

  const portStr = process.env["PGPORT"] ?? "5432";
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`PGPORT must be a valid port number, got "${portStr}"`);
  }

  const sslMode = process.env["PGSSLMODE"];
  if (sslMode && sslMode !== "disable" && sslMode !== "verify-full") {
    throw new Error("PGSSLMODE must be disable or verify-full; unverified TLS is not supported");
  }
  const rawMax = process.env["PGPOOL_MAX"];
  const maxConnections = rawMax === undefined ? undefined : Number(rawMax);
  if (rawMax !== undefined && (!/^[1-9][0-9]*$/.test(rawMax) || !Number.isSafeInteger(maxConnections) || maxConnections! > 10)) {
    throw new Error("PGPOOL_MAX must be an integer from 1 to 10");
  }
  return {
    ...(sslMode === "verify-full" ? {ssl: {rejectUnauthorized: true as const}} : {}),
    ...(maxConnections !== undefined ? {maxConnections} : {}),
    host:     req("PGHOST"),
    port,
    user:     req("PGUSER"),
    password: req("PGPASSWORD"),
    database: req("PGDATABASE"),
    schema:   process.env["PGSCHEMA"] ?? "noticevault",
  };
}

/**
 * Deterministic LOCAL_FIXTURE config — for tests only.
 * Uses the docker-compose defaults. Never used in non-test code.
 */
export function localFixtureDbConfig(schemaOverride?: string): DbConfig {
  return {
    host:     process.env["PGHOST"]     ?? "127.0.0.1",
    port:     parseInt(process.env["PGPORT"] ?? "5432", 10),
    user:     process.env["PGUSER"]     ?? "noticevault",
    password: process.env["PGPASSWORD"] ?? "noticevault_dev",
    database: process.env["PGDATABASE"] ?? "noticevault_dev",
    schema:   schemaOverride ?? process.env["PGSCHEMA"] ?? "noticevault_test",
  };
}
