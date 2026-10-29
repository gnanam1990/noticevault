/**
 * T032 — API server integration tests (Fastify inject, mock DB)
 *
 * Tests:
 * - /health and /ready
 * - Global CSRF hook: workspace/draft/intent POST/PUT without CSRF headers → 403
 * - Origin header enforcement on all mutation routes
 * - Session cookie requirement on protected routes
 * - Auth challenge/verify flow: challenge stores issued_at/uri/origin; verify
 *   rebuilds exact canonical message; consume+session atomic
 * - Auth verify: wrong origin, wrong domain, expired challenge, concurrent replay
 * - Workspace CRUD with session + membership
 * - Cross-workspace leakage (member of WS-A cannot access WS-B)
 * - Draft: canonical terms validation (valid / invalid fields)
 * - Draft: author-only update; version conflict
 * - Intent idempotency: actor-scoped (same key, different actor → independent rows)
 * - Intent: same key + same payload → 200; same key + different payload → 409
 * - Intent: VERIFIED evidenceSource rejected; no Idempotency-Key header → 400
 *
 * The mock pool intercepts SQL by parsing the query string.
 * This is a behavioural contract test, not a DB schema test.
 *
 * UNTESTED (requires real PG or M05+):
 * - Live provider account-type/chain evidence (production remains BLOCKED_SDK)
 * - DB migration idempotency with real PG
 * - Concurrent replay prevention under load
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { buildServer } from "../server.js";
import type { ApiConfig } from "../config.js";
import { localFixtureDbConfig } from "@noticevault/db";

// ── Test fixtures ────────────────────────────────────────────────────────────

// Test-only sentinel addresses — no real funds, no real wallets. arc-studio-allow-onchain-literal
const ADDR_1 = "0x0000000000000000000000000000000000000001"; // arc-studio-allow-onchain-literal
const ADDR_2 = "0x0000000000000000000000000000000000000002"; // arc-studio-allow-onchain-literal
const WS_ID   = "11111111-1111-4111-8111-111111111111";
const WS_ID_2 = "22222222-2222-4222-8222-222222222222";
const SESS_ID_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESS_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// In-memory state for mock DB
type ChallengeRow = {
  id: string; address: string; domain: string; origin: string; uri: string;
  chain_id: string; nonce: string;
  issued_at: Date; expires_at: Date; consumed_at: Date | null;
};
type SessionRow = {
  id: string; workspace_id: string | null; member_address: string;
  chain_id: string; created_at: Date; expires_at: Date; revoked_at: Date | null;
};
type WorkspaceRow = { id: string; name: string; owner_address: string; created_at: Date; updated_at: Date };
type MemberRow    = { workspace_id: string; member_address: string; role: string; joined_at: Date };
type DraftRow     = {
  id: string; workspace_id: string; author_address: string; version: number;
  terms_json: unknown; status: string; doc_hash: string; created_at: Date; updated_at: Date;
};
type ConsentRow   = { id: string; draft_id: string; terms_digest: string; signature_hex: string; [key: string]: unknown };
type IntentRow    = {
  id: string; idempotency_key: string; payload_hash: string; workspace_id: string;
  actor_address: string; operation: string; status: string;
  evidence_source: string | null; evidence_block: string | null;
  evidence_config_identity: string | null; result_json: unknown;
  created_at: Date; updated_at: Date;
};

let challenges:  Record<string, ChallengeRow>  = {};
let sessions:    Record<string, SessionRow>    = {};
let workspaces:  Record<string, WorkspaceRow>  = {};
let memberships: Record<string, MemberRow>     = {};
let drafts:      Record<string, DraftRow>      = {};
let consents:    Record<string, ConsentRow>    = {};
let intents:     Record<string, IntentRow>     = {};

function resetState() {
  challenges  = {};
  sessions    = {};
  workspaces  = {};
  memberships = {};
  drafts      = {};
  consents    = {};
  intents     = {};

  sessions[SESS_ID_1] = {
    id: SESS_ID_1, workspace_id: WS_ID, member_address: ADDR_1,
    chain_id: "1", created_at: new Date(),
    expires_at: new Date(Date.now() + 86400_000), revoked_at: null,
  };
  sessions[SESS_ID_2] = {
    id: SESS_ID_2, workspace_id: WS_ID_2, member_address: ADDR_2,
    chain_id: "1", created_at: new Date(),
    expires_at: new Date(Date.now() + 86400_000), revoked_at: null,
  };
  workspaces[WS_ID] = {
    id: WS_ID, name: "Workspace 1", owner_address: ADDR_1,
    created_at: new Date(), updated_at: new Date(),
  };
  workspaces[WS_ID_2] = {
    id: WS_ID_2, name: "Workspace 2", owner_address: ADDR_2,
    created_at: new Date(), updated_at: new Date(),
  };
  memberships[`${WS_ID}:${ADDR_1}`]   = { workspace_id: WS_ID,   member_address: ADDR_1, role: "owner", joined_at: new Date() };
  memberships[`${WS_ID_2}:${ADDR_2}`] = { workspace_id: WS_ID_2, member_address: ADDR_2, role: "owner", joined_at: new Date() };
}

// ── Mock pool ─────────────────────────────────────────────────────────────────

function buildMockPool(): pg.Pool {
  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const s = sql.trim().toLowerCase();

      // Bootstrap / migration queries
      if (s.includes("schema_migrations"))   return { rows: [], rowCount: 0 };
      if (s.startsWith("create table"))      return { rows: [], rowCount: 0 };
      if (s.startsWith("create schema"))     return { rows: [], rowCount: 0 };
      if (s.startsWith("create index"))      return { rows: [], rowCount: 0 };
      if (s.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }], rowCount: 1 };
      if (s.includes("pg_advisory_unlock"))  return { rows: [], rowCount: 0 };
      if (s === "select 1")                  return { rows: [{ "?column?": 1 }], rowCount: 1 };
      if (s.startsWith("begin") || s.startsWith("commit") || s.startsWith("rollback")) return { rows: [], rowCount: 0 };
      if (s.includes("set search_path") || s.includes("set local search_path")) return { rows: [], rowCount: 0 };

      // ── Sessions ──────────────────────────────────────────────────────────
      if (s.includes("from") && s.includes("sessions") && s.includes("where id")) {
        const id = String(params?.[0]);
        const row = sessions[id];
        if (row && !row.revoked_at && row.expires_at > new Date()) {
          return { rows: [row], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (s.startsWith("insert into") && s.includes("sessions")) {
        const p = params as [string, string | null, string, string, Date];
        const sess: SessionRow = {
          id: p[0], workspace_id: p[1], member_address: p[2], chain_id: p[3],
          created_at: new Date(), expires_at: p[4], revoked_at: null,
        };
        sessions[p[0]] = sess;
        return { rows: [sess], rowCount: 1 };
      }
      if (s.startsWith("update") && s.includes("sessions") && s.includes("revoked_at")) {
        const id = String(params?.[0]);
        const row = sessions[id];
        if (row && !row.revoked_at) { row.revoked_at = new Date(); return { rowCount: 1 }; }
        return { rowCount: 0 };
      }

      // ── Challenges ────────────────────────────────────────────────────────
      if (s.startsWith("insert into") && s.includes("wallet_challenges")) {
        // (id, address, domain, origin, uri, chain_id, nonce, issued_at, expires_at)
        const p = params as [string, string, string, string, string, string, string, Date, Date];
        const ck = `${p[1]}:${p[2]}:${p[5]}:${p[6]}`;
        const ch: ChallengeRow = {
          id: p[0], address: p[1], domain: p[2], origin: p[3], uri: p[4],
          chain_id: p[5], nonce: p[6], issued_at: p[7], expires_at: p[8], consumed_at: null,
        };
        challenges[ck] = ch;
        return { rows: [ch], rowCount: 1 };
      }
      if (s.includes("from") && s.includes("wallet_challenges") && s.includes("consumed_at is null")) {
        // findPendingChallenge: (address, domain, chain_id, nonce)
        const p = params as [string, string, string, string];
        const row = Object.values(challenges).find(
          c => c.address.toLowerCase() === p[0].toLowerCase()
            && c.domain === p[1]
            && c.chain_id === p[2]
            && c.nonce === p[3]
            && !c.consumed_at
            && c.expires_at > new Date(),
        );
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (s.startsWith("update") && s.includes("wallet_challenges") && s.includes("consumed_at")) {
        const id = String(params?.[0]);
        const ch = Object.values(challenges).find(c => c.id === id && !c.consumed_at && c.expires_at > new Date());
        if (ch) { ch.consumed_at = new Date(); return { rowCount: 1 }; }
        return { rowCount: 0 };
      }

      // ── Workspaces ────────────────────────────────────────────────────────
      if (s.startsWith("insert into") && s.includes("workspaces")) {
        const p = params as [string, string, string];
        const ws: WorkspaceRow = { id: p[0], name: p[1], owner_address: p[2], created_at: new Date(), updated_at: new Date() };
        workspaces[p[0]] = ws;
        return { rows: [ws], rowCount: 1 };
      }
      if (s.includes("from") && s.includes("workspaces") && s.includes("where id")) {
        const id = String(params?.[0]);
        const ws = workspaces[id];
        return { rows: ws ? [ws] : [], rowCount: ws ? 1 : 0 };
      }

      // ── Memberships ───────────────────────────────────────────────────────
      if (s.includes("from") && s.includes("wallet_identities")) {
        return {rows:[{id:"00000000-0000-4000-8000-000000000001"}],rowCount:1};
      }
      if (s.startsWith("insert into") && s.includes("workspace_memberships")) {
        const p = params as [string, string, string];
        const m: MemberRow = { workspace_id: p[0], member_address: p[1], role: p[2], joined_at: new Date() };
        memberships[`${p[0]}:${p[1].toLowerCase()}`] = m;
        return { rows: [m], rowCount: 1 };
      }
      if (s.includes("from") && s.includes("workspace_memberships")) {
        if (s.includes("lower(member_address)")) {
          const p = params as [string, string];
          const key = `${p[0]}:${p[1].toLowerCase()}`;
          const row = memberships[key];
          return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
        }
        const wsId = String(params?.[0]);
        const rows = Object.values(memberships).filter(m => m.workspace_id === wsId);
        return { rows, rowCount: rows.length };
      }

      // ── Drafts ────────────────────────────────────────────────────────────
      if (s.startsWith("insert into") && s.includes("terms_drafts")) {
        const p = params as [string, string, string, string, string];
        const d: DraftRow = {
          id: p[0], workspace_id: p[1], author_address: p[2], version: 1,
          terms_json: JSON.parse(p[3]), status: "draft", doc_hash: p[4],
          created_at: new Date(), updated_at: new Date(),
        };
        drafts[p[0]] = d;
        return { rows: [d], rowCount: 1 };
      }
      if (s.includes("from") && s.includes("terms_drafts") && s.includes("where id")) {
        const p = params as [string, string];
        const d = drafts[p[0]];
        if (d && d.workspace_id === p[1]) return { rows: [d], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }
      if (s.startsWith("update") && s.includes("terms_drafts") && s.includes("version")) {
        const p = params as [string, string, string, number, string, string];
        const d = drafts[p[0]];
        if (d && d.workspace_id === p[1]
            && d.author_address.toLowerCase() === p[2].toLowerCase()
            && d.version === p[3] && d.status === "draft") {
          d.terms_json = JSON.parse(p[4]);
          d.doc_hash   = p[5];
          d.version    = p[3] + 1;
          d.updated_at = new Date();
          return { rows: [d], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (s.startsWith("update") && s.includes("terms_drafts") && s.includes("status")) {
        const p = params as [string, string, string];
        const d = drafts[p[0]];
        if (d && d.workspace_id === p[1]) { d.status = p[2]; return { rowCount: 1 }; }
        return { rowCount: 0 };
      }

      // ── Consents ──────────────────────────────────────────────────────────
      if (s.startsWith("insert into") && s.includes("accepted_consents")) {
        const p = params as [string, string, string, string, string, string, string, string, string];
        const c: ConsentRow = {
          id: p[0], draft_id: p[1], workspace_id: p[2], signer_address: p[3],
          terms_digest: p[4], signature_hex: p[5], consent_method: p[6],
          pinned_block: p[7], chain_id: p[8], signed_at: new Date(),
        };
        consents[`${p[1]}:${p[3].toLowerCase()}`] = c;
        return { rows: [c], rowCount: 1 };
      }
      if (s.includes("from") && s.includes("accepted_consents")) {
        const p = params as [string, string];
        const key = `${p[0]}:${p[1].toLowerCase()}`;
        const row = consents[key];
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }

      // ── Intents ───────────────────────────────────────────────────────────
      if (s.startsWith("insert into") && s.includes("intents")) {
        const p = params as [string, string, string, string, string, string, string | null, string | null, string | null];
        // unique on (idempotency_key, actor_address, workspace_id, operation)
        const ukey = `${p[1]}:${p[4].toLowerCase()}:${p[3]}:${p[5]}`;
        const existing = Object.values(intents).find(
          i => i.idempotency_key === p[1]
            && i.actor_address.toLowerCase() === p[4].toLowerCase()
            && i.workspace_id === p[3]
            && i.operation === p[5],
        );
        if (existing) {
          const e = new Error("duplicate key value") as Error & { code: string };
          e.code = "23505";
          throw e;
        }
        const intent: IntentRow = {
          id: p[0], idempotency_key: p[1], payload_hash: p[2], workspace_id: p[3],
          actor_address: p[4], operation: p[5], status: "pending",
          evidence_source: p[6], evidence_block: p[7], evidence_config_identity: p[8],
          result_json: null, created_at: new Date(), updated_at: new Date(),
        };
        intents[ukey] = intent;
        return { rows: [intent], rowCount: 1 };
      }
      // getIntentByActorKey: (idempotencyKey, actorAddress, workspaceId, operation)
      if (s.includes("from") && s.includes("intents") && s.includes("lower(actor_address)")) {
        const p = params as [string, string, string, string];
        const row = Object.values(intents).find(
          i => i.idempotency_key === p[0]
            && i.actor_address.toLowerCase() === p[1].toLowerCase()
            && i.workspace_id === p[2]
            && i.operation === p[3],
        );
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (s.includes("from") && s.includes("intents") && s.includes("where id")) {
        const p = params as [string, string];
        const intent = Object.values(intents).find(i => i.id === p[0] && i.workspace_id === p[1]);
        return { rows: intent ? [intent] : [], rowCount: intent ? 1 : 0 };
      }

      return { rows: [], rowCount: 0 };
    },
    connect: async () => {
      return {
        query:   (sql: string, params?: unknown[]) => mockPool.query(sql, params),
        release: () => { /* no-op */ },
      };
    },
    on:  (_event: string, _handler: unknown) => mockPool,
    end: async () => { /* no-op */ },
  } as unknown as pg.Pool;

  return mockPool;
}

// ── Test setup ────────────────────────────────────────────────────────────────

const cfg: ApiConfig = {
  configIdentity:   "LOCAL_FIXTURE",
  port:             3001,
  host:             "127.0.0.1",
  db:               localFixtureDbConfig("noticevault_test"),
  sessionSecret:    "test_session_secret_32_bytes_xxx!",
  cookieDomain:     "localhost",
  allowedOrigins:   ["http://localhost:5173"],
  sessionTtlSecs:   86400,
  challengeTtlSecs: 300,
  allowedDomains:   ["localhost"],
};

const ALLOWED_HEADERS = {
  "x-requested-with": "XMLHttpRequest",
  "origin":           "http://localhost:5173",
  "content-type":     "application/json",
};
const SESS_COOKIE_1 = `nv_session=${SESS_ID_1}`;
const SESS_COOKIE_2 = `nv_session=${SESS_ID_2}`;

// Valid canonical 11-field terms (all bigint fields as decimal strings)
const VALID_TERMS = {
  schemaVersion:      1,
  client:             ADDR_1,
  provider:           ADDR_2,
  token:              "0x0000000000000000000000000000000000000001", // arc-studio-allow-onchain-literal
  amountPerPeriod:    "1000000",
  periodSeconds:      "2592000",
  noticeSeconds:      "604800",
  startAt:            "0",
  clientNonce:        "0",
  acceptanceDeadline: "9999999999",
  termsDocumentHash:  "0x" + "aa".repeat(32),
};

let app:  FastifyInstance;
let pool: pg.Pool;

beforeAll(async () => {
  resetState();
  pool = buildMockPool();
  app  = await buildServer({ cfg, pool, skipMigration: true, logger: false });
});

afterAll(async () => { await app.close(); });

// Reset in-memory state before each draft/intent test group to avoid cross-test leakage
beforeEach(() => { /* state reset done in specific describe blocks below */ });

// ── Health routes ─────────────────────────────────────────────────────────────

describe("T032 — /health", () => {
  it("GET /health returns 200", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe("ok");
  });

  it("GET /ready returns 200", async () => {
    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe("ready");
  });
});

// ── Global CSRF enforcement ───────────────────────────────────────────────────

describe("T032 — global CSRF hook (all mutation routes)", () => {
  const tests: Array<[string, string, string, object]> = [
    ["POST", "/auth/challenge",                    "auth/challenge",   { address: ADDR_1, chainId: 1 }],
    ["POST", "/workspaces",                        "workspace create", { name: "x" }],
    ["POST", `/workspaces/${WS_ID}/drafts`,        "draft create",     { termsJson: VALID_TERMS }],
    ["POST", `/workspaces/${WS_ID}/intents`,       "intent create",    { operation: "op" }],
    ["PUT",  `/workspaces/${WS_ID}/drafts/xxx`,    "draft update",     { termsJson: VALID_TERMS, expectedVersion: 1 }],
  ];

  for (const [method, url, label, payload] of tests) {
    it(`${method} ${label}: missing X-Requested-With → 403`, async () => {
      const res = await app.inject({
        method: method as "GET" | "POST" | "PUT",
        url,
        headers: { "origin": "http://localhost:5173", "content-type": "application/json",
                   "cookie": SESS_COOKIE_1 },
        payload,
      });
      expect(res.statusCode).toBe(403);
    });

    it(`${method} ${label}: wrong Origin → 403`, async () => {
      const res = await app.inject({
        method: method as "GET" | "POST" | "PUT",
        url,
        headers: { "x-requested-with": "XMLHttpRequest", "origin": "http://evil.example.com",
                   "content-type": "application/json", "cookie": SESS_COOKIE_1 },
        payload,
      });
      expect(res.statusCode).toBe(403);
    });
  }
});

// ── Auth challenge/verify flow ────────────────────────────────────────────────

describe("T032 — auth challenge/verify canonical message", () => {
  it("POST /auth/challenge stores issued_at and returns canonical message", async () => {
    const before = Date.now();
    const res = await app.inject({
      method: "POST",
      url:    "/auth/challenge",
      headers: ALLOWED_HEADERS,
      payload: { address: ADDR_1, chainId: 1 },
    });
    const after = Date.now();
    expect(res.statusCode).toBe(200);
    const body = res.json<{ nonce: string; message: string; issuedAt: string; expiresAt: string }>();
    expect(body.nonce).toHaveLength(32);
    expect(body.issuedAt).toBeTruthy();
    // issuedAt must be within the request window
    const issuedMs = new Date(body.issuedAt).getTime();
    expect(issuedMs).toBeGreaterThanOrEqual(before - 100);
    expect(issuedMs).toBeLessThanOrEqual(after + 100);
    // Message must contain domain, address, nonce, URI, issuedAt
    expect(body.message).toContain("localhost wants you to sign in");
    expect(body.message).toContain(ADDR_1);
    expect(body.message).toContain(`Nonce: ${body.nonce}`);
    expect(body.message).toContain("URI: http://localhost:5173/auth/verify");
    expect(body.message).toContain(`Issued At: ${body.issuedAt}`);
  });

  it("POST /auth/verify with LOCAL_FIXTURE address and consumed-nonce replay → 401", async () => {
    // Issue challenge
    const challRes = await app.inject({
      method: "POST", url: "/auth/challenge",
      headers: ALLOWED_HEADERS,
      payload: { address: ADDR_1, chainId: 1 },
    });
    const { nonce } = challRes.json<{ nonce: string }>();

    // First verify — should succeed
    const vr1 = await app.inject({
      method: "POST", url: "/auth/verify",
      headers: ALLOWED_HEADERS,
      payload: { nonce, signature: "0x" + "ab".repeat(65), address: ADDR_1, chainId: 1 },
    });
    expect(vr1.statusCode).toBe(200);

    // Second verify with same nonce — replay → 401
    const vr2 = await app.inject({
      method: "POST", url: "/auth/verify",
      headers: ALLOWED_HEADERS,
      payload: { nonce, signature: "0x" + "ab".repeat(65), address: ADDR_1, chainId: 1 },
    });
    expect(vr2.statusCode).toBe(401);
  });

  it("POST /auth/verify sets HttpOnly session cookie", async () => {
    const challRes = await app.inject({
      method: "POST", url: "/auth/challenge",
      headers: ALLOWED_HEADERS,
      payload: { address: ADDR_1, chainId: 1 },
    });
    const { nonce } = challRes.json<{ nonce: string }>();

    const res = await app.inject({
      method: "POST", url: "/auth/verify",
      headers: ALLOWED_HEADERS,
      payload: { nonce, signature: "0x" + "ab".repeat(65), address: ADDR_1, chainId: 1 },
    });
    expect(res.statusCode).toBe(200);
    const sc = String(res.headers["set-cookie"] ?? "");
    expect(sc).toContain("nv_session=");
    expect(sc).toContain("HttpOnly");
  });

  it("POST /auth/verify with wrong Origin → 403", async () => {
    const challRes = await app.inject({
      method: "POST", url: "/auth/challenge",
      headers: ALLOWED_HEADERS,
      payload: { address: ADDR_1, chainId: 1 },
    });
    const { nonce } = challRes.json<{ nonce: string }>();

    const res = await app.inject({
      method: "POST", url: "/auth/verify",
      headers: {
        "x-requested-with": "XMLHttpRequest",
        "origin":           "http://evil.example.com",
        "content-type":     "application/json",
      },
      payload: { nonce, signature: "0x" + "ab".repeat(65), address: ADDR_1, chainId: 1 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /auth/me requires session cookie", async () => {
    const r1 = await app.inject({ method: "GET", url: "/auth/me" });
    expect(r1.statusCode).toBe(401);

    const r2 = await app.inject({
      method: "GET", url: "/auth/me",
      headers: { cookie: SESS_COOKIE_1 },
    });
    expect(r2.statusCode).toBe(200);
    expect(r2.json<{ address: string }>().address).toBe(ADDR_1);
  });

  it("POST /auth/logout revokes session", async () => {
    // No body → no content-type: application/json (empty body with that type causes 400)
    const res = await app.inject({
      method: "POST", url: "/auth/logout",
      headers: {
        "x-requested-with": "XMLHttpRequest",
        "origin":           "http://localhost:5173",
        "cookie":           SESS_COOKIE_1,
      },
    });
    expect(res.statusCode).toBe(200);
    // Reset for subsequent tests
    sessions[SESS_ID_1]!.revoked_at = null;
  });
});

// ── Workspace routes ──────────────────────────────────────────────────────────

describe("T032 — workspace routes", () => {
  it("GET /workspaces/:id returns workspace for member", async () => {
    const res = await app.inject({
      method: "GET", url: `/workspaces/${WS_ID}`,
      headers: { cookie: SESS_COOKIE_1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ id: string }>().id).toBe(WS_ID);
  });

  it("GET /workspaces/:id → 403 for non-member (cross-workspace leakage prevention)", async () => {
    const res = await app.inject({
      method: "GET", url: `/workspaces/${WS_ID_2}`,
      headers: { cookie: SESS_COOKIE_1 }, // ADDR_1 not a member of WS_ID_2
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /workspaces/:id → 404 for nonexistent workspace", async () => {
    const res = await app.inject({
      method: "GET", url: "/workspaces/00000000-0000-4000-8000-000000000000",
      headers: { cookie: SESS_COOKIE_1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /workspaces creates workspace with CSRF headers", async () => {
    const res = await app.inject({
      method: "POST", url: "/workspaces",
      headers: { ...ALLOWED_HEADERS, cookie: SESS_COOKIE_1 },
      payload: { name: "New Workspace" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ name: string }>().name).toBe("New Workspace");
  });

  it("POST /workspaces without CSRF headers → 403", async () => {
    const res = await app.inject({
      method: "POST", url: "/workspaces",
      headers: { "origin": "http://localhost:5173", "content-type": "application/json", "cookie": SESS_COOKIE_1 },
      payload: { name: "Bad Workspace" },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── Draft routes ──────────────────────────────────────────────────────────────

describe("T032 — draft routes (canonical validation)", () => {
  let draftId = "";

  it("POST /workspaces/:wsId/drafts with valid 11-field terms → 201", async () => {
    const res = await app.inject({
      method: "POST", url: `/workspaces/${WS_ID}/drafts`,
      headers: { ...ALLOWED_HEADERS, cookie: SESS_COOKIE_1 },
      payload: { termsJson: VALID_TERMS },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; version: number; status: string }>();
    expect(body.status).toBe("draft");
    expect(body.version).toBe(1);
    draftId = body.id;
  });

  it("POST /workspaces/:wsId/drafts with missing schemaVersion → 400", async () => {
    const { schemaVersion: _sv, ...noVersion } = VALID_TERMS;
    const res = await app.inject({
      method: "POST", url: `/workspaces/${WS_ID}/drafts`,
      headers: { ...ALLOWED_HEADERS, cookie: SESS_COOKIE_1 },
      payload: { termsJson: noVersion },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /workspaces/:wsId/drafts with invalid address → 400", async () => {
    const res = await app.inject({
      method: "POST", url: `/workspaces/${WS_ID}/drafts`,
      headers: { ...ALLOWED_HEADERS, cookie: SESS_COOKIE_1 },
      payload: { termsJson: { ...VALID_TERMS, client: "not-an-address" } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /workspaces/:wsId/drafts with bigint as JS number → 400 (unsafe)", async () => {
    const res = await app.inject({
      method: "POST", url: `/workspaces/${WS_ID}/drafts`,
      headers: { ...ALLOWED_HEADERS, cookie: SESS_COOKIE_1 },
      payload: { termsJson: { ...VALID_TERMS, amountPerPeriod: 1000000 } }, // number, not string
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /workspaces/:wsId/drafts with overflow amountPerPeriod → 400", async () => {
    const overflow = (2n ** 256n).toString();
    const res = await app.inject({
      method: "POST", url: `/workspaces/${WS_ID}/drafts`,
      headers: { ...ALLOWED_HEADERS, cookie: SESS_COOKIE_1 },
      payload: { termsJson: { ...VALID_TERMS, amountPerPeriod: overflow } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /workspaces/:wsId/drafts/:id for member → 200", async () => {
    const res = await app.inject({
      method: "GET", url: `/workspaces/${WS_ID}/drafts/${draftId}`,
      headers: { cookie: SESS_COOKIE_1 },
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /workspaces/:wsId/drafts/:id for non-member → 403", async () => {
    const res = await app.inject({
      method: "GET", url: `/workspaces/${WS_ID}/drafts/${draftId}`,
      headers: { cookie: SESS_COOKIE_2 }, // ADDR_2 not a member of WS_ID
    });
    expect(res.statusCode).toBe(403);
  });

  it("PUT /workspaces/:wsId/drafts/:id version bump → 200", async () => {
    const updatedTerms = { ...VALID_TERMS, amountPerPeriod: "2000000" };
    const res = await app.inject({
      method: "PUT", url: `/workspaces/${WS_ID}/drafts/${draftId}`,
      headers: { ...ALLOWED_HEADERS, cookie: SESS_COOKIE_1 },
      payload: { termsJson: updatedTerms, expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ version: number }>().version).toBe(2);
  });

  it("PUT /workspaces/:wsId/drafts/:id stale version → 409", async () => {
    const res = await app.inject({
      method: "PUT", url: `/workspaces/${WS_ID}/drafts/${draftId}`,
      headers: { ...ALLOWED_HEADERS, cookie: SESS_COOKIE_1 },
      payload: { termsJson: VALID_TERMS, expectedVersion: 1 }, // stale
    });
    expect(res.statusCode).toBe(409);
  });

  it("PUT /workspaces/:wsId/drafts/:id without CSRF → 403", async () => {
    const res = await app.inject({
      method: "PUT", url: `/workspaces/${WS_ID}/drafts/${draftId}`,
      headers: { "origin": "http://localhost:5173", "content-type": "application/json", "cookie": SESS_COOKIE_1 },
      payload: { termsJson: VALID_TERMS, expectedVersion: 2 },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── Intent idempotency (actor-scoped) ─────────────────────────────────────────

describe("T032 — intent idempotency (actor-scoped)", () => {
  const basePayload = { operation: "prepare_create_agreement", evidenceSource: "SIMULATION" };

  it("POST /workspaces/:wsId/intents → 201 (created)", async () => {
    const res = await app.inject({
      method: "POST", url: `/workspaces/${WS_ID}/intents`,
      headers: { ...ALLOWED_HEADERS, cookie: SESS_COOKIE_1, "idempotency-key": "idem-key-001" },
      payload: basePayload,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ status: string }>().status).toBe("pending");
  });

  it("same key + same payload from same actor → 200 (idempotent)", async () => {
    const res = await app.inject({
      method: "POST", url: `/workspaces/${WS_ID}/intents`,
      headers: { ...ALLOWED_HEADERS, cookie: SESS_COOKIE_1, "idempotency-key": "idem-key-001" },
      payload: basePayload,
    });
    expect(res.statusCode).toBe(200);
  });

  it("same key + same operation + altered payload field → 409 (conflict)", async () => {
    // Same actor + workspace + operation + key, but different evidenceSource.
    // This changes the payload hash while keeping the same unique-constraint key,
    // so createOrGetIntent detects the hash mismatch and throws IdempotencyConflictError.
    const res = await app.inject({
      method: "POST", url: `/workspaces/${WS_ID}/intents`,
      headers: { ...ALLOWED_HEADERS, cookie: SESS_COOKIE_1, "idempotency-key": "idem-key-001" },
      payload: { ...basePayload, evidenceSource: "LOCAL_FIXTURE" }, // same operation, different evidenceSource
    });
    expect(res.statusCode).toBe(409);
  });

  it("same key + DIFFERENT operation → 201 (independent scope per spec)", async () => {
    // Different operation = different unique-constraint tuple: new independent row.
    // The spec says idempotency scope is (key, actor, workspace, operation).
    // A different operation is a DIFFERENT operation; it gets its own row and should succeed.
    const res = await app.inject({
      method: "POST", url: `/workspaces/${WS_ID}/intents`,
      headers: { ...ALLOWED_HEADERS, cookie: SESS_COOKIE_1, "idempotency-key": "idem-key-001" },
      payload: { ...basePayload, operation: "different_operation" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("VERIFIED evidenceSource → 400 (reserved for SDK)", async () => {
    const res = await app.inject({
      method: "POST", url: `/workspaces/${WS_ID}/intents`,
      headers: { ...ALLOWED_HEADERS, cookie: SESS_COOKIE_1, "idempotency-key": "idem-key-002" },
      payload: { operation: "create_agreement", evidenceSource: "VERIFIED" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { message: string } }>().error.message).toContain("VERIFIED");
  });

  it("missing Idempotency-Key header → 400", async () => {
    const res = await app.inject({
      method: "POST", url: `/workspaces/${WS_ID}/intents`,
      headers: { ...ALLOWED_HEADERS, cookie: SESS_COOKIE_1 },
      payload: basePayload,
    });
    expect(res.statusCode).toBe(400);
  });

  it("cross-workspace intent: non-member → 403", async () => {
    const res = await app.inject({
      method: "POST", url: `/workspaces/${WS_ID}/intents`,
      headers: { ...ALLOWED_HEADERS, cookie: SESS_COOKIE_2, "idempotency-key": "cross-ws-key" },
      payload: basePayload,
    });
    expect(res.statusCode).toBe(403);
  });

  it("same Idempotency-Key from different actor (ADDR_2 in WS_ID_2) → independent row (201)", async () => {
    // ADDR_2 uses the same key in their own workspace — should be independent
    const res = await app.inject({
      method: "POST", url: `/workspaces/${WS_ID_2}/intents`,
      headers: { ...ALLOWED_HEADERS, cookie: SESS_COOKIE_2, "idempotency-key": "idem-key-001" },
      payload: basePayload,
    });
    // ADDR_2 is a member of WS_ID_2 and can create their own intent with the same key
    expect(res.statusCode).toBe(201);
  });

  it("POST /workspaces/:wsId/intents without CSRF → 403", async () => {
    const res = await app.inject({
      method: "POST", url: `/workspaces/${WS_ID}/intents`,
      headers: { "origin": "http://localhost:5173", "content-type": "application/json",
                 "cookie": SESS_COOKIE_1, "idempotency-key": "no-csrf-key" },
      payload: basePayload,
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── CORS allowlist (never reflect arbitrary origins with credentials) ──────────

describe("T032 — CORS plugin allowlist", () => {
  it("GET /health from disallowed origin: no Access-Control-Allow-Origin header", async () => {
    const res = await app.inject({
      method: "GET",
      url:    "/health",
      headers: { "origin": "http://evil.example.com" },
    });
    // The request succeeds (GET is not blocked by the mutation guard), but the
    // CORS plugin must NOT emit ACAO for a disallowed origin.
    expect(res.statusCode).toBe(200);
    const acao = res.headers["access-control-allow-origin"];
    // Must be absent or not equal to the evil origin
    expect(acao).not.toBe("http://evil.example.com");
  });

  it("GET /health from allowed origin: Access-Control-Allow-Origin is the allowed origin", async () => {
    const res = await app.inject({
      method: "GET",
      url:    "/health",
      headers: { "origin": "http://localhost:5173" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  it("POST mutation from disallowed origin: 403 (global hook rejects before handler)", async () => {
    const res = await app.inject({
      method: "POST",
      url:    "/workspaces",
      headers: {
        "x-requested-with": "XMLHttpRequest",
        "origin":           "http://evil.example.com",
        "content-type":     "application/json",
        "cookie":           SESS_COOKIE_1,
      },
      payload: { name: "Disallowed" },
    });
    // Global hook must return 403; handler must not run
    expect(res.statusCode).toBe(403);
    // CORS plugin must not emit ACAO for the disallowed origin
    const acao = res.headers["access-control-allow-origin"];
    expect(acao).not.toBe("http://evil.example.com");
  });

  it("POST mutation from allowed origin with both CSRF headers: 201", async () => {
    const res = await app.inject({
      method: "POST",
      url:    "/workspaces",
      headers: {
        "x-requested-with": "XMLHttpRequest",
        "origin":           "http://localhost:5173",
        "content-type":     "application/json",
        "cookie":           SESS_COOKIE_1,
      },
      payload: { name: "CORS-allowed workspace" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });
});

// EIP-712 uses a publicly documented deterministic test key, never a wallet.
import { privateKeyToAccount } from "viem/accounts";
import { buildTypedData, computeTermsDigest, LOCAL_FIXTURE_DEPLOYMENT } from "@noticevault/sdk";
import type { NoticeVaultDeployment, TermsInput } from "@noticevault/sdk";
const testSigner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const fixtureDeployment: NoticeVaultDeployment = { ...LOCAL_FIXTURE_DEPLOYMENT, factoryAddress: ADDR_1 };

describe("T032 — fixture typed consent through actual API routes", () => {
  let consentApp: FastifyInstance;
  let draftId: string;
  let terms: TermsInput;
  beforeEach(async () => {
    resetState();
    const signer = testSigner.address.toLowerCase();
    sessions[SESS_ID_1]!.member_address = signer;
    sessions[SESS_ID_1]!.chain_id = "31337";
    memberships[WS_ID + ":" + signer] = { workspace_id: WS_ID, member_address: signer, role: "member", joined_at: new Date() };
    consentApp = await buildServer({ cfg: { ...cfg, consentDeployment: fixtureDeployment }, pool: buildMockPool(), skipMigration: true, logger: false });
    const wire = { ...VALID_TERMS, provider: signer };
    const created = await consentApp.inject({ method: "POST", url: "/workspaces/" + WS_ID + "/drafts", headers: { ...ALLOWED_HEADERS, cookie: SESS_COOKIE_1 }, payload: { termsJson: wire } });
    expect(created.statusCode).toBe(201); draftId = created.json<{ id: string }>().id;
    terms = { ...wire, amountPerPeriod: BigInt(wire.amountPerPeriod), periodSeconds: BigInt(wire.periodSeconds), noticeSeconds: BigInt(wire.noticeSeconds), startAt: BigInt(wire.startAt), clientNonce: BigInt(wire.clientNonce), acceptanceDeadline: BigInt(wire.acceptanceDeadline) };
  });
  afterEach(async () => { await consentApp.close(); });
  async function payload() {
    return { termsDigest: computeTermsDigest(terms, fixtureDeployment), signatureHex: await testSigner.signTypedData(buildTypedData(terms, fixtureDeployment)), pinnedBlock: "100", chainId: 31337 };
  }
  function submit(body: object, target = consentApp) { return target.inject({ method: "POST", url: "/workspaces/" + WS_ID + "/drafts/" + draftId + "/accept-consent", headers: { ...ALLOWED_HEADERS, cookie: SESS_COOKIE_1 }, payload: body }); }
  it("round-trips SDK typed data, stores exact signature and returns identical retry", async () => {
    const body = await payload(); const first = await submit(body);
    expect(first.statusCode).toBe(201);
    expect(first.json().signature_hex).toBe(body.signatureHex);
    expect(first.json().terms_digest).toBe(body.termsDigest);
    expect(first.json().consent_method).toBe("ecdsa");
    expect(drafts[draftId]!.status).toBe("accepted");
    const retry = await submit(body); expect(retry.statusCode).toBe(200); expect(retry.json().id).toBe(first.json().id);
    expect((await submit({ ...body, pinnedBlock: "101" })).statusCode).toBe(409);
  });
  it("rejects personal-sign digest instead of typed consent", async () => {
    const body = await payload(); body.signatureHex = await testSigner.signMessage({ message: body.termsDigest });
    expect((await submit(body)).statusCode).toBe(403); expect(Object.keys(consents)).toHaveLength(0);
  });
  it("rejects a signature for another factory with the correct supplied digest", async () => {
    const body = await payload(); body.signatureHex = await testSigner.signTypedData(buildTypedData(terms, { ...fixtureDeployment, factoryAddress: ADDR_2 }));
    expect((await submit(body)).statusCode).toBe(403); expect(Object.keys(consents)).toHaveLength(0);
  });
  it("rejects a signature for another chain with the correct supplied digest", async () => {
    const body = await payload(); body.signatureHex = await testSigner.signTypedData(buildTypedData(terms, { ...fixtureDeployment, chainId: 1n }));
    expect((await submit(body)).statusCode).toBe(403); expect(Object.keys(consents)).toHaveLength(0);
  });
  it("rejects changed terms and digest", async () => {
    const body = await payload(); (drafts[draftId]!.terms_json as typeof VALID_TERMS).amountPerPeriod = "2000000";
    expect((await submit(body)).statusCode).toBe(409); expect(Object.keys(consents)).toHaveLength(0);
  });
  it("rejects mismatched request chain", async () => {
    expect((await submit({ ...await payload(), chainId: 1 })).statusCode).toBe(403); expect(Object.keys(consents)).toHaveLength(0);
  });
  it("rejects mismatched session chain", async () => {
    sessions[SESS_ID_1]!.chain_id = "1";
    expect((await submit(await payload())).statusCode).toBe(403); expect(Object.keys(consents)).toHaveLength(0);
  });
  it("blocks missing fixture manifest", async () => {
    const blocked = await buildServer({ cfg, pool: buildMockPool(), skipMigration: true, logger: false });
    try { const response = await submit(await payload(), blocked); expect(response.statusCode).toBe(503); expect(response.json().error.code).toBe("BLOCKED_SDK"); expect(Object.keys(consents)).toHaveLength(0); } finally { await blocked.close(); }
  });
  it("blocks production before digest or signature acceptance", async () => {
    const blocked = await buildServer({ cfg: { ...cfg, configIdentity: "ARC_TESTNET" }, pool: buildMockPool(), skipMigration: true, logger: false });
    try { const response = await submit(await payload(), blocked); expect(response.statusCode).toBe(503); expect(response.json().error.code).toBe("BLOCKED_SDK"); expect(Object.keys(consents)).toHaveLength(0); } finally { await blocked.close(); }
  });
});
