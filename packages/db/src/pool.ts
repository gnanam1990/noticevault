/**
 * @noticevault/db — connection pool factory
 *
 * Creates a pg Pool from DbConfig. Never uses connection strings (DATABASE_URL).
 *
 * SEARCH_PATH CONTRACT:
 * - search_path is set on EVERY new client via the pg-pool `onConnect` option.
 * - `onConnect(client)` returns a Promise. pg-pool v3 awaits this promise via
 *   _promiseTry() BEFORE delivering the client to any caller. If the promise
 *   rejects, the client is end()ed, removed from the pool, and the rejection is
 *   propagated directly to the pending pool.connect() caller. This is a
 *   properly fail-closed, awaited boundary — no client can execute queries until
 *   search_path has been confirmed set.
 *
 * The connect event is emitted before caller delivery, but its listeners are
 * not awaited. Async setup must use the awaited onConnect option instead.
 *
 * TYPE PARSERS:
 * - NUMERIC(78,0) → string (caller converts to BigInt)
 * - INT8 → string (caller converts to BigInt)
 */

import pg from "pg";
import type { DbConfig } from "./config.js";
import { quoteSchema } from "./schema-id.js";

export type { Pool, PoolClient } from "pg";

// Ensure bigint/numeric columns are returned as strings, not JS numbers.
// pg type OID 1700 = NUMERIC. We parse them as strings then use BigInt.
// This must be called once before any pool is created.
let _typeParsersSet = false;
export function ensureTypeParsers(): void {
  if (_typeParsersSet) return;
  // NUMERIC(78,0) → string (caller converts to BigInt as needed)
  pg.types.setTypeParser(1700, (val: string) => val);
  // INT8 (bigint) → string
  pg.types.setTypeParser(20, (val: string) => val);
  _typeParsersSet = true;
}

/**
 * Create a new pg.Pool from a DbConfig.
 *
 * Uses the `onConnect` pool option to set search_path on every new client.
 * `onConnect` is awaited by pg-pool before the client is returned to any caller:
 * - If it resolves: the client has search_path set and is safe to query.
 * - If it rejects: pg-pool calls client.end(), removes it from the pool, and
 *   rejects the pool.connect() Promise for the caller waiting on that client.
 *
 * This guarantees no caller ever receives a client whose setup failed or is
 * still in-flight.
 *
 * Caller must call pool.end() on shutdown.
 */
export function createPool(cfg: DbConfig): pg.Pool {
  ensureTypeParsers();
  const quotedSchema = quoteSchema(cfg.schema);

  const pool = new pg.Pool({
    host:                    cfg.host,
    port:                    cfg.port,
    user:                    cfg.user,
    password:                cfg.password,
    database:                cfg.database,
    max:                     cfg.maxConnections ?? 10,
    ...(cfg.ssl ? {ssl: cfg.ssl} : {}),
    idleTimeoutMillis:       30_000,
    connectionTimeoutMillis: 5_000,

    // onConnect: called after TCP connect, BEFORE client delivered to caller.
    // pg-pool v3.14+ awaits the returned Promise via _promiseTry().
    // A rejection here causes pg-pool to end() the client, remove it from
    // _clients, and propagate the error to the acquisition caller.
    //
    // @types/pg declares onConnect as (client: ClientBase) => void.
    // async (client: pg.ClientBase) => Promise<void> is assignable to that
    // signature because Promise<void> is assignable to void — no cast needed.
    // pg-pool v3 runtime awaits the return value via _promiseTry(); ClientBase
    // has .query() so the call below compiles without casting the parameter.
    onConnect: async (client: pg.ClientBase) => {
      await client.query(`SET search_path TO ${quotedSchema}, public`);
    },
  });

  // Default pool error listener — prevents unhandled 'error' event from crashing
  // the process if no application-level listener is registered. This covers
  // idle-client errors (e.g. server closes a connection while client sits idle).
  // Application code should add its own error listener for observability.
  pool.on("error", (_err: Error) => {
    // Idle-client errors are already handled by pg-pool's makeIdleListener which
    // calls pool._remove(client) and emits 'error'. We absorb here to prevent
    // an unhandled EventEmitter crash. Callers that need telemetry should add
    // their own pool.on("error", ...) listener after createPool().
  });

  return pool;
}
