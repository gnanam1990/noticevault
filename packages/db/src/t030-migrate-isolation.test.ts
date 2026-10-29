/**
 * T030 — DB migration isolation tests
 *
 * Tests the migration runner's isolation contract WITHOUT a real DB:
 * - quoteSchema: validates and rejects bad identifiers
 * - Migration SQL stripping: BEGIN/COMMIT/ROLLBACK stripped from embedded SQL
 * - CLI config guard: fails closed without explicit opt-in
 * - Schema tracker placement: in-schema, never public
 *
 * These are pure unit tests; no pg connection required.
 */

import { describe, it, expect } from "vitest";
import { quoteSchema } from "./schema-id.js";

describe("T030 — quoteSchema identifier validation", () => {
  it("accepts valid lowercase schema names", () => {
    expect(quoteSchema("noticevault")).toBe('"noticevault"');
    expect(quoteSchema("noticevault_test")).toBe('"noticevault_test"');
    expect(quoteSchema("a")).toBe('"a"');
    expect(quoteSchema("ab1")).toBe('"ab1"');
  });

  it("rejects schema names starting with a digit", () => {
    expect(() => quoteSchema("1bad")).toThrow(/Invalid schema identifier/);
  });

  it("rejects schema names with uppercase letters", () => {
    expect(() => quoteSchema("NoticeVault")).toThrow(/Invalid schema identifier/);
  });

  it("rejects schema names with hyphens", () => {
    expect(() => quoteSchema("notice-vault")).toThrow(/Invalid schema identifier/);
  });

  it("rejects schema names with spaces", () => {
    expect(() => quoteSchema("notice vault")).toThrow(/Invalid schema identifier/);
  });

  it("rejects empty string", () => {
    expect(() => quoteSchema("")).toThrow(/Invalid schema identifier/);
  });

  it("rejects names longer than 63 chars", () => {
    const long = "a" + "b".repeat(63); // 64 chars
    expect(() => quoteSchema(long)).toThrow(/Invalid schema identifier/);
  });

  it("accepts exactly 63 chars", () => {
    const exact = "a" + "b".repeat(62);
    expect(() => quoteSchema(exact)).not.toThrow();
  });

  it("rejects SQL injection attempts", () => {
    expect(() => quoteSchema("good; DROP TABLE users; --")).toThrow(/Invalid schema identifier/);
    expect(() => quoteSchema("noticevault' OR '1'='1")).toThrow(/Invalid schema identifier/);
    expect(() => quoteSchema("public")).not.toThrow(); // valid identifier (test its output is quoted)
    expect(quoteSchema("public")).toBe('"public"');
  });
});

describe("T030 — migration SQL stripping logic", () => {
  // Mirror the stripping logic from migrate.ts to test it independently
  function stripTransactionStatements(sql: string): string {
    return sql.replace(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;?\s*$/gim, "-- [stripped by runner] $1");
  }

  it("strips standalone BEGIN", () => {
    const result = stripTransactionStatements("BEGIN;\nCREATE TABLE x (id int);");
    expect(result).not.toContain("BEGIN;");
    expect(result).toContain("-- [stripped by runner] BEGIN");
    expect(result).toContain("CREATE TABLE x");
  });

  it("strips standalone COMMIT", () => {
    const result = stripTransactionStatements("CREATE TABLE x (id int);\nCOMMIT;");
    expect(result).not.toContain("COMMIT;");
    expect(result).toContain("-- [stripped by runner] COMMIT");
  });

  it("strips standalone ROLLBACK", () => {
    const result = stripTransactionStatements("ROLLBACK;");
    expect(result).toContain("-- [stripped by runner] ROLLBACK");
  });

  it("does not strip BEGIN inside a string or identifier", () => {
    // Not standalone — embedded inside a line
    const sql = "CREATE TABLE begin_table (id int);";
    const result = stripTransactionStatements(sql);
    expect(result).toBe(sql); // unchanged
  });

  it("strips BEGIN/COMMIT/ROLLBACK in any case", () => {
    const sql = "begin;\nCREATE TABLE t (id int);\ncommit;";
    const result = stripTransactionStatements(sql);
    expect(result).not.toMatch(/\bbegin;/i);
    expect(result).not.toMatch(/\bcommit;/i);
    expect(result).toContain("CREATE TABLE t");
  });
});

describe("T030 — advisory lock key (uint32 → signed int32)", () => {
  // Mirror the schemaAdvisoryKey logic from migrate.ts
  function schemaAdvisoryKey(schema: string): number {
    let h = 5381;
    for (let i = 0; i < schema.length; i++) {
      h = (((h << 5) + h) ^ schema.charCodeAt(i)) >>> 0;
    }
    return h | 0; // sign-extend to signed int32
  }

  it("always returns a value in int32 range (never out-of-range for pg int4)", () => {
    for (const s of ["noticevault", "noticevault_test", "a", "z_test_99"]) {
      const k = schemaAdvisoryKey(s);
      expect(k).toBeGreaterThanOrEqual(-2_147_483_648);
      expect(k).toBeLessThanOrEqual(2_147_483_647);
    }
  });

  it("is deterministic for the same schema", () => {
    expect(schemaAdvisoryKey("noticevault")).toBe(schemaAdvisoryKey("noticevault"));
  });

  it("different schemas produce different keys", () => {
    expect(schemaAdvisoryKey("noticevault")).not.toBe(schemaAdvisoryKey("noticevault_test"));
  });
});

describe("T030 — migration runner design contracts (static assertions)", () => {
  it("schema_migrations must never reference 'public' schema in migration SQL", async () => {
    const { readFile } = await import("node:fs/promises");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = dirname(fileURLToPath(import.meta.url));
    const sql = await readFile(join(dir, "migrations", "001_initial_schema.sql"), "utf-8");
    // Strip SQL comments before checking (avoid matching comment text)
    const noComments = sql
      .replace(/--[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(noComments).not.toMatch(/\bpublic\s*\./i);
  });

  it("migrate.ts source never writes to public schema migration tables", async () => {
    const { readFile } = await import("node:fs/promises");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = dirname(fileURLToPath(import.meta.url));
    const src = await readFile(join(dir, "migrate.ts"), "utf-8");
    // No SQL string should reference public.schema_migrations
    // Strip comments first to avoid matching comment text
    const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(noComments).not.toMatch(/public\.schema_migrations/);
    expect(noComments).not.toContain('CREATE TABLE IF NOT EXISTS public.');
    expect(noComments).not.toMatch(/INSERT INTO public\./);
  });

  it("pool.ts sets search_path via onConnect option (awaited, fail-closed), not fire-and-forget connect event", async () => {
    const { readFile } = await import("node:fs/promises");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = dirname(fileURLToPath(import.meta.url));
    const src = await readFile(join(dir, "pool.ts"), "utf-8");
    // Must use the onConnect constructor option (awaited by pg-pool before client delivery)
    expect(src).toContain("onConnect:");
    // Must NOT use the fire-and-forget pool.on("connect", ...) for search_path setup.
    // NOTE: pool.ts comments may describe why we don't use it; exclude comment lines.
    // The check is: no non-comment line contains pool.on(<quote>connect<quote>)
    const nonCommentLines = src.split("\n").filter(l => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l));
    const nonCommentSrc = nonCommentLines.join("\n");
    expect(nonCommentSrc).not.toMatch(/pool\.on\s*\(\s*["']connect["']/);
    // Must NOT use a single-shot pool.query for search_path (only SET LOCAL in migration)
    expect(src).not.toMatch(/pool\.query\s*\(\s*[`'"]\s*SET search_path/);
    // Must NOT use 'as unknown as' cast to suppress the onConnect type (fix: use ClientBase)
    expect(src).not.toMatch(/onConnect.*as unknown as/);
    // onConnect callback parameter must use pg.ClientBase (not PoolClient which is narrower)
    expect(src).toContain("pg.ClientBase");
  });

  it("pool.ts registers a default error listener to prevent unhandled EventEmitter crash", async () => {
    const { readFile } = await import("node:fs/promises");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = dirname(fileURLToPath(import.meta.url));
    const src = await readFile(join(dir, "pool.ts"), "utf-8");
    // Must have a default error listener so pool 'error' events do not crash the process
    expect(src).toContain('pool.on("error"');
  });

  it("server.ts CORS plugin never reflects arbitrary origins (origin: true prohibited)", async () => {
    const { readFile } = await import("node:fs/promises");
    const { dirname, join, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = dirname(fileURLToPath(import.meta.url));
    const serverPath = resolve(dir, "../../../apps/api/src/server.ts");
    const src = await readFile(serverPath, "utf-8");
    // Must not use 'origin: true' (reflects any origin with credentials)
    expect(src).not.toMatch(/origin\s*:\s*true/);
    // Must use a callback-based origin (allowlist enforcement)
    expect(src).toMatch(/origin\s*:\s*\(/);
  });

  it("migrate.ts CLI fails closed without explicit config", async () => {
    const { readFile } = await import("node:fs/promises");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = dirname(fileURLToPath(import.meta.url));
    const src = await readFile(join(dir, "migrate.ts"), "utf-8");
    // Must require explicit NOTICEVAULT_ALLOW_LOCAL_FIXTURE=1 opt-in
    expect(src).toContain("NOTICEVAULT_ALLOW_LOCAL_FIXTURE");
    // Must not silently fall back (the old pattern was `localFixtureDbConfig()` without check)
    expect(src).not.toMatch(/const cfg\s*=\s*process\.env\["PGHOST"\]\s*\?\s*loadDbConfig\(\)\s*:\s*localFixtureDbConfig\(\)/);
  });
});
