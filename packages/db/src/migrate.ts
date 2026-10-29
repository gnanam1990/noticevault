/**
 * @noticevault/db — migration runner
 *
 * ISOLATION CONTRACT:
 * - ALL migration bookkeeping lives INSIDE the designated schema, never in public.
 * - The schema identifier is safely quoted via a regex allowlist; interpolation
 *   only happens after validation. All parameters are $N-bound.
 * - Every migration runs inside its own serializable transaction with SET LOCAL
 *   search_path. Failed transactions are rolled back before the client is released.
 * - A PostgreSQL advisory lock serialises concurrent migration runners.
 *   pg_try_advisory_lock(int4, int4): namespace=0x4E56 ("NV"), key=djb2(schema).
 *   djb2 produces uint32; pg int4 is signed. We sign-extend before passing so
 *   PG receives a well-typed signed int4 (not an out-of-range error for high bits).
 * - CLI: fails closed if no explicit config is available. Silently falling back
 *   to LOCAL_FIXTURE credentials without NOTICEVAULT_ALLOW_LOCAL_FIXTURE=1 is rejected.
 *
 * Usage:
 *   NOTICEVAULT_ALLOW_LOCAL_FIXTURE=1 bun run src/migrate.ts   # local dev
 *   PGHOST=... PGUSER=... PGPASSWORD=... PGDATABASE=... bun run src/migrate.ts
 */

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "./pool.js";
import { localFixtureDbConfig, loadDbConfig } from "./config.js";
import { quoteSchema } from "./schema-id.js";
import type pg from "pg";

// Resolve migration assets only when migrations are explicitly run.
// Importing repositories in a serverless runtime must not touch filesystem paths.

export interface MigrationResult {
  applied:  number[];
  skipped:  number[];
  errors:   Array<{ version: number; message: string }>;
}

// re-export so callers that already import migrate.ts still get quoteSchema
export { quoteSchema } from "./schema-id.js";

// ── Advisory lock helpers ─────────────────────────────────────────────────────

/**
 * Convert a schema name to a stable signed int4 advisory key via djb2 hash.
 * djb2 returns uint32; pg_try_advisory_lock(int4,int4) expects signed int4.
 * We sign-extend using a 32-bit arithmetic right shift trick so high-bit keys
 * do not cause "integer out of range" errors in PostgreSQL.
 */
function schemaAdvisoryKey(schema: string): number {
  let h = 5381;
  for (let i = 0; i < schema.length; i++) {
    // djb2: h = h * 33 ^ char; keep in uint32 range
    h = (((h << 5) + h) ^ schema.charCodeAt(i)) >>> 0;
  }
  // Convert uint32 to signed int32 (two's complement)
  return h | 0;
}

// Advisory lock namespace: ASCII "NV" = 0x4E56 = 20054 (fits in positive int4)
const NV_LOCK_NS = 20054;

// ── Core migration runner ─────────────────────────────────────────────────────

/**
 * Run all pending SQL migrations inside the designated schema.
 *
 * @param pool      pg Pool already connected to the target database.
 * @param schema    Application schema — validated and used for ALL tables
 *                  including the schema_migrations tracker. Never public.
 * @param migrationsDir  Path to migrations directory (default: bundled ./migrations).
 */
export async function runMigrations(
  pool: pg.Pool,
  schema: string,
  migrationsDir?: string,
): Promise<MigrationResult> {
  const quotedSchema = quoteSchema(schema);
  const dir = migrationsDir ?? join(dirname(fileURLToPath(import.meta.url)), "migrations");
  const result: MigrationResult = { applied: [], skipped: [], errors: [] };

  const client = await pool.connect();
  try {
    // Acquire advisory lock — blocks concurrent runners for this schema
    const lockKey = schemaAdvisoryKey(schema);
    const locked = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1::int4, $2::int4) AS acquired",
      [NV_LOCK_NS, lockKey],
    );
    if (!locked.rows[0]?.acquired) {
      throw new Error(
        `Could not acquire migration advisory lock for schema "${schema}". ` +
        `Another migration runner may be active.`,
      );
    }

    try {
      // Ensure schema exists
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`);

      // Ensure schema_migrations tracker exists inside the designated schema only
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${quotedSchema}.schema_migrations (
          version     INTEGER     NOT NULL PRIMARY KEY,
          applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          description TEXT        NOT NULL DEFAULT ''
        )
      `);

      // Read already-applied versions
      const appliedRows = await client.query<{ version: number }>(
        `SELECT version FROM ${quotedSchema}.schema_migrations ORDER BY version ASC`,
      );
      const applied = new Set(appliedRows.rows.map((r) => r.version));

      // List migration files
      let files: string[];
      try {
        files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
      } catch {
        // No migrations directory — nothing to apply
        return result;
      }

      for (const file of files) {
        const match = file.match(/^(\d+)_/);
        if (!match || !match[1]) continue;
        const version = parseInt(match[1], 10);

        if (applied.has(version)) {
          result.skipped.push(version);
          continue;
        }

        let sql = await readFile(join(dir, file), "utf-8");

        // Strip any embedded BEGIN/COMMIT/ROLLBACK so our outer transaction controls it
        sql = sql.replace(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;?\s*$/gim, "-- [stripped by runner] $1");

        try {
          await client.query("BEGIN");

          // SET LOCAL search_path for this transaction: migration SQL uses unqualified names
          await client.query(`SET LOCAL search_path TO ${quotedSchema}`);

          await client.query(sql);

          // Record migration inside the schema-scoped tracker only
          await client.query(
            `INSERT INTO ${quotedSchema}.schema_migrations (version, description)
             VALUES ($1, $2)
             ON CONFLICT (version) DO NOTHING`,
            [version, file],
          );

          await client.query("COMMIT");
          result.applied.push(version);
        } catch (err) {
          // Roll back before releasing the client; ignore rollback errors
          try { await client.query("ROLLBACK"); } catch { /* best-effort */ }
          result.errors.push({
            version,
            message: err instanceof Error ? err.message : String(err),
          });
          // Fail-closed: stop on first error
          break;
        }
      }
    } finally {
      // Release advisory lock regardless of outcome
      await client.query(
        "SELECT pg_advisory_unlock($1::int4, $2::int4)",
        [NV_LOCK_NS, lockKey],
      );
    }
  } finally {
    client.release();
  }

  return result;
}

// ── CLI entry point ───────────────────────────────────────────────────────────
// Fails closed: requires either explicit PGHOST env var OR explicit
// NOTICEVAULT_ALLOW_LOCAL_FIXTURE=1 opt-in. Never silently falls back.

if (process.argv[1] && (
  process.argv[1].endsWith("migrate.ts") ||
  process.argv[1].endsWith("migrate.js")
)) {
  const hasExplicitConfig = Boolean(process.env["PGHOST"]);
  const allowFixture       = process.env["NOTICEVAULT_ALLOW_LOCAL_FIXTURE"] === "1";

  if (!hasExplicitConfig && !allowFixture) {
    console.error(
      "ERROR: No database configuration found.\n" +
      "Set PGHOST (+ PGPORT, PGUSER, PGPASSWORD, PGDATABASE) for production/CI,\n" +
      "or set NOTICEVAULT_ALLOW_LOCAL_FIXTURE=1 to use local docker-compose defaults.\n" +
      "Refusing to run migrations without explicit configuration.",
    );
    process.exit(1);
  }

  const cfg  = hasExplicitConfig ? loadDbConfig() : localFixtureDbConfig();
  const pool = createPool(cfg);

  try {
    const r = await runMigrations(pool, cfg.schema);
    if (r.applied.length > 0) {
      console.log("Applied migrations:", r.applied.join(", "));
    }
    if (r.skipped.length > 0) {
      console.log("Skipped (already applied):", r.skipped.join(", "));
    }
    if (r.errors.length > 0) {
      console.error("Migration errors:", JSON.stringify(r.errors, null, 2));
      process.exit(1);
    }
    console.log("Migrations complete.");
  } finally {
    await pool.end();
  }
}
