import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { createPool } from "./pool.js";

// Keep the real pg-pool lifecycle and production createPool configuration.
// The sole injected dependency is a client which cannot open a socket.
const RealPool = pg.Pool;
const cfg = { host: "unused.invalid", port: 5432, user: "test", password: "test", database: "test", schema: "unit_test" };
const setupSql = 'SET search_path TO "unit_test", public';
let setup: () => Promise<void>;
let clients: FakeClient[];
let pools: pg.Pool[];
class FakeClient extends EventEmitter {
  _queryable = true;
  _ending = false;
  ended = false;
  queries: string[] = [];
  constructor(_config?: unknown) { super(); clients.push(this); }
  connect(cb: (error?: Error) => void) { cb(); }
  query(sql: string, values?: unknown, callback?: (error: Error | null, result?: unknown) => void) {
    this.queries.push(sql);
    const promise = sql.startsWith("SET ") ? setup().then(() => ({ rows: [] })) : Promise.resolve({ rows: [{ ok: 1 }] });
    const cb = typeof values === "function" ? values as (error: Error | null, result?: unknown) => void : callback;
    if (cb) { void promise.then(result => cb(null, result), error => cb(error)); return; }
    return promise;
  }
  end(cb?: () => void) { this.ended = true; this._ending = true; this.emit("end"); cb?.(); }
  ref() {}
  unref() {}
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function pool() { const value = createPool(cfg); pools.push(value); return value; }
beforeEach(() => {
  clients = []; pools = []; setup = () => Promise.resolve();
  vi.spyOn(pg, "Pool").mockImplementation(function(options?: pg.PoolConfig) {
    return new RealPool({ ...options, Client: FakeClient } as unknown as pg.PoolConfig);
  });
});
afterEach(async () => { await Promise.all(pools.map(p => p.end())); vi.restoreAllMocks(); });

describe("T033 production createPool lifecycle without database access", () => {
  it("awaits production search_path setup before delivering connect", async () => {
    const gate = deferred(); setup = () => gate.promise;
    const p = pool(); let delivered = false;
    const pending = p.connect().then(c => { delivered = true; return c; });
    await tick();
    expect(delivered).toBe(false);
    expect(clients[0]!.queries).toEqual([setupSql]);
    gate.resolve(); const c = await pending;
    expect(delivered).toBe(true); c.release();
  });
  it("blocks pool.query until production setup resolves", async () => {
    const gate = deferred(); setup = () => gate.promise;
    const p = pool(); let delivered = false;
    const pending = p.query("SELECT 1").then(r => { delivered = true; return r; });
    await tick(); expect(delivered).toBe(false);
    expect(clients[0]!.queries).toEqual([setupSql]);
    gate.resolve(); expect((await pending).rows).toEqual([{ ok: 1 }]);
    expect(clients[0]!.queries).toEqual([setupSql, "SELECT 1"]);
  });
  it("rejects and discards a client when production setup fails", async () => {
    const failure = new Error("setup failed"); setup = () => Promise.reject(failure);
    const p = pool(); await expect(p.connect()).rejects.toBe(failure);
    expect(clients[0]!.ended).toBe(true); expect(p.totalCount).toBe(0);
    setup = () => Promise.resolve(); const c = await p.connect(); c.release();
    const reused = await p.connect();
    expect(reused).toBe(c); expect(clients).toHaveLength(2);
    expect(clients[1]!.queries).toEqual([setupSql]); reused.release();
  });
  it("rejects pool.query without running user SQL when setup fails", async () => {
    const failure = new Error("setup rejected"); setup = () => Promise.reject(failure);
    const p = pool(); await expect(p.query("SELECT 1")).rejects.toBe(failure);
    expect(clients[0]!.queries).toEqual([setupSql]); expect(clients[0]!.ended).toBe(true);
  });
  it("initializes each new client independently and reuses initialized idle clients", async () => {
    const p = pool(); const a = await p.connect(); const b = await p.connect();
    expect(a).not.toBe(b); expect(clients).toHaveLength(2);
    expect(clients.map(c => c.queries)).toEqual([[setupSql], [setupSql]]);
    a.release(); b.release(); const reused = await p.connect();
    expect([a, b]).toContain(reused); expect(clients).toHaveLength(2);
    expect(clients.map(c => c.queries)).toEqual([[setupSql], [setupSql]]); reused.release();
  });
  it("validates schema before constructing a pool", () => {
    expect(() => createPool({ ...cfg, schema: "INVALID_UPPER" })).toThrow(/Invalid schema identifier/);
    expect(pg.Pool).not.toHaveBeenCalled(); expect(clients).toHaveLength(0);
  });
  it("preserves integer and numeric string parsers", () => {
    pool();
    expect(pg.types.getTypeParser(20)("9007199254740993")).toBe("9007199254740993");
    expect(pg.types.getTypeParser(1700)("1.234567890123456789")).toBe("1.234567890123456789");
  });
});
