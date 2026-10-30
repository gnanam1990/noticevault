import { isUuid } from "../request-identifiers.js";
import {arcDeployment} from '@noticevault/sdk';
import type {} from '@fastify/cookie';
/**
 * @noticevault/api — wallet sign-in routes
 *
 * POST /auth/challenge   — issue a single-use sign-in challenge
 * POST /auth/verify      — verify signed challenge; set session cookie
 * POST /auth/logout      — revoke session; clear cookie
 * GET  /auth/me          — return current session info (requires session)
 *
 * SECURITY PROPERTIES:
 * - Challenge: bound to origin/domain/chain/address/nonce/uri/issuedAt.
 *   All fields stored in DB so verify reconstructs EXACT canonical message bytes
 *   without re-deriving from the incoming request.
 * - Verify: challenge found by address+domain+chainId+nonce. Message rebuilt
 *   from stored row (issued_at, uri, origin). Signature verified against rebuilt
 *   message; recovered address must match challenge.address.
 * - Atomicity: challenge consumption AND session creation happen in ONE DB
 *   transaction. If session INSERT fails, consumption is rolled back.
 * - Replay prevention: UPDATE...WHERE consumed_at IS NULL ensures concurrent
 *   verify calls with the same nonce both execute inside the transaction lock.
 * - Session: HttpOnly SameSite=Strict cookie. DB-backed and revocable.
 * - CSRF: Origin header validated on all state-mutating routes.
 *   X-Requested-With: XMLHttpRequest required on all API routes.
 * - Actors derived from verified signature, never from request body fields.
 * - Chain mismatch: session.chainId stored and accessible for future checks.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import type pg from "pg";
import type { ApiConfig } from "../config.js";
import type { SignatureVerifier } from "../auth/verify.js";
import { buildChallengeMessage } from "../auth/verify.js";
import {
  SESSION_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_HEADER_VALUE,
  buildSessionCookie,
  clearSessionCookie,
} from "../auth/session.js";
import {
  createChallenge,
  findPendingChallenge,
  consumeChallenge,
  createSession,
  findValidSession,
  revokeSession,
} from "@noticevault/db";
import { badRequest, unauthorized, forbidden } from "../errors.js";
import type { SessionData } from "../auth/session.js";

// ── CSRF / Origin guard ───────────────────────────────────────────────────────

export function requireCsrfHeaders(req: FastifyRequest, allowedOrigins: readonly string[]): void {
  const xrw = req.headers[CSRF_HEADER_NAME];
  if (xrw !== CSRF_HEADER_VALUE) {
    throw forbidden(`${CSRF_HEADER_NAME}: ${CSRF_HEADER_VALUE} header required`);
  }
  const origin = req.headers["origin"] ?? "";
  if (!allowedOrigins.includes(origin)) {
    throw forbidden(`Origin "${origin}" not in allowed list`);
  }
}

// ── Session lookup helper ─────────────────────────────────────────────────────

export async function requireSession(
  req:    FastifyRequest,
  pool:   pg.Pool,
  schema: string,
): Promise<SessionData> {
  const sessionId = (req.cookies ?? {})[SESSION_COOKIE_NAME];
  if (!isUuid(sessionId)) throw unauthorized("Invalid or missing session cookie");
  const row = await findValidSession(pool, schema, sessionId);
  if (!row) throw unauthorized("Session expired or revoked");
  return {
    sessionId:     row.id,
    memberAddress: row.member_address,
    chainId:       BigInt(row.chain_id),
    workspaceId:   row.workspace_id ?? null,
    expiresAt:     row.expires_at,
  };
}

// ── Route definitions ─────────────────────────────────────────────────────────

interface ChallengeBody { address: string; chainId: number; }
interface VerifyBody    { nonce: string; signature: string; address: string; chainId: number; }

export async function authRoutes(
  app:      FastifyInstance,
  pool:     pg.Pool,
  cfg:      ApiConfig,
  verifier: SignatureVerifier,
): Promise<void> {
  const { schema } = cfg.db;

  app.get('/auth/network', async (_req,reply)=>{
    if(cfg.configIdentity==='LOCAL_FIXTURE')return reply.code(503).send({error:{code:'LOCAL_FIXTURE_ONLY'}});
    const network=arcDeployment(cfg.configIdentity);
    return reply.header('Cache-Control','no-store').send({configIdentity:network.configIdentity,chainId:String(network.chainId)});
  });
  const requireConfiguredChain=(chainId:bigint)=>{
    if(cfg.configIdentity!=='LOCAL_FIXTURE'&&chainId!==arcDeployment(cfg.configIdentity).chainId)throw forbidden('Chain does not match configured Arc network');
  };
  // POST /auth/challenge
  app.post<{ Body: ChallengeBody }>("/auth/challenge", async (req, reply) => {
    requireCsrfHeaders(req, cfg.allowedOrigins);

    const { address, chainId: chainIdNum } = req.body ?? {};
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      throw badRequest("address must be a 0x-prefixed 40-hex-char Ethereum address");
    }
    if (!chainIdNum || !Number.isInteger(chainIdNum) || chainIdNum <= 0 || chainIdNum > 2_147_483_647) {
      throw badRequest("chainId must be a positive integer in int32 range");
    }

    const origin = req.headers["origin"] ?? "";
    // origin validated to be in allowedOrigins by requireCsrfHeaders already
    const domain = (() => {
      try { return new URL(origin).hostname; } catch { return ""; }
    })();
    if (!domain || !cfg.allowedDomains.includes(domain)) {
      throw forbidden(`Domain "${domain}" not in allowed list`);
    }

    const chainId   = BigInt(chainIdNum);
    requireConfiguredChain(chainId);
    const nonce     = randomBytes(16).toString("hex"); // 32-char hex
    const issuedAt  = new Date();
    const expiresAt = new Date(issuedAt.getTime() + cfg.challengeTtlSecs * 1_000);
    const id        = randomUUID();
    const uri       = `${origin}/auth/verify`;

    // Store all canonical message fields in DB
    await createChallenge(pool, schema, id, address, domain, origin, uri, chainId, nonce, issuedAt, expiresAt);

    const message = buildChallengeMessage({
      domain, address, chainId, nonce, issuedAt, expiresAt, uri,
    });

    void reply.status(200).send({
      challengeId:id,
      nonce,
      message,
      issuedAt:  issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
  });

  // POST /auth/verify
  app.post<{ Body: VerifyBody }>("/auth/verify", async (req, reply) => {
    requireCsrfHeaders(req, cfg.allowedOrigins);

    const { nonce, signature, address, chainId: chainIdNum } = req.body ?? {};
    if (!nonce || typeof nonce !== "string" || !/^[0-9a-f]{32}$/.test(nonce)) {
      throw badRequest("nonce must be a 32-char lowercase hex string");
    }
    if (!signature || typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) {
      throw badRequest("signature must be 0x-prefixed hex");
    }
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      throw badRequest("address must be a valid Ethereum address");
    }
    if (!chainIdNum || !Number.isInteger(chainIdNum) || chainIdNum <= 0) {
      throw badRequest("chainId must be a positive integer");
    }

    const incomingOrigin = req.headers["origin"] ?? "";
    const incomingDomain = (() => {
      try { return new URL(incomingOrigin).hostname; } catch { return ""; }
    })();
    if (!incomingDomain || !cfg.allowedDomains.includes(incomingDomain)) {
      throw forbidden(`Domain "${incomingDomain}" not in allowed list`);
    }

    const chainId = BigInt(chainIdNum);
    requireConfiguredChain(chainId);

    // 1. Find pending (unconsumed, unexpired) challenge by address+domain+chainId+nonce
    const challenge = await findPendingChallenge(pool, schema, address, incomingDomain, chainId, nonce);
    if (!challenge) {
      throw unauthorized("Challenge not found, expired, or already consumed");
    }

    // 2. Validate that stored origin/domain match incoming request
    //    (prevents a cross-origin replay where attacker uses a valid nonce from a different origin)
    if (challenge.origin !== incomingOrigin) {
      throw unauthorized("Origin mismatch: challenge was issued for a different origin");
    }
    if (challenge.domain !== incomingDomain) {
      throw unauthorized("Domain mismatch");
    }
    if (challenge.chain_id !== chainId.toString()) {
      throw unauthorized("Chain ID mismatch");
    }

    // 3. Reconstruct the EXACT canonical message from stored row fields
    //    NOT from the incoming request — the wallet signed exactly what we stored
    const message = buildChallengeMessage({
      domain:    challenge.domain,
      address:   challenge.address,
      chainId:   BigInt(challenge.chain_id),
      nonce:     challenge.nonce,
      issuedAt:  challenge.issued_at,   // from stored row
      expiresAt: challenge.expires_at,  // from stored row
      uri:       challenge.uri,          // from stored row
    });

    // 4. Verify signature — actor derived from crypto, never from body
    const vr = await verifier.verify(message, signature, address, chainId);
    if (!vr.ok) {
      throw unauthorized(`Signature verification failed: ${vr.reason}`);
    }

    // 5. Recovered address must match the challenge's stored address
    if (vr.recoveredAddress.toLowerCase() !== challenge.address.toLowerCase()) {
      throw unauthorized("Recovered address does not match challenge address");
    }

    // 6. Atomically: consume the challenge AND create the session in ONE transaction
    //    If session creation fails, consumption is rolled back.
    const sessionId  = randomUUID();
    const expiresAt  = new Date(Date.now() + cfg.sessionTtlSecs * 1_000);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Pinned verifier results must still refer to this exact immutable challenge.
      if (verifier.revalidate) {
        const locked = (await client.query('SELECT * FROM '+schema+'.wallet_challenges WHERE id=$1 FOR UPDATE',[challenge.id])).rows[0];
        if (!locked || locked.consumed_at || new Date(locked.expires_at).getTime()<=Date.now()) throw unauthorized('Challenge expired or consumed before evidence commit');
        const currentMessage = buildChallengeMessage({domain:locked.domain,address:locked.address,chainId:BigInt(locked.chain_id),nonce:locked.nonce,issuedAt:locked.issued_at,expiresAt:locked.expires_at,uri:locked.uri});
        if (locked.origin!==challenge.origin || currentMessage!==message) throw unauthorized('Challenge binding changed during verification');
      }

      const consumed = await consumeChallenge(client, schema, challenge.id);
      if (!consumed) {
        await client.query("ROLLBACK");
        throw unauthorized("Challenge already consumed (concurrent replay attempt)");
      }

      if (verifier.revalidate && !await verifier.revalidate(vr)) throw unauthorized('Pinned authentication evidence changed or unavailable');

      await createSession(client, schema, sessionId, vr.recoveredAddress, chainId, expiresAt);
      if (verifier.revalidate) {
        const fresh = await client.query('SELECT id FROM '+schema+'.wallet_challenges WHERE id=$1 AND expires_at>clock_timestamp()',[challenge.id]);
        if (!fresh.rows.length || challenge.expires_at.getTime()<=Date.now()) throw unauthorized('Challenge expired before session commit');
      }

      await client.query("COMMIT");
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* best-effort */ }
      throw err;
    } finally {
      client.release();
    }

    const isProduction = cfg.configIdentity !== "LOCAL_FIXTURE";
    const cookieStr = buildSessionCookie(sessionId, expiresAt, cfg.cookieDomain, isProduction);
    void reply.header("Set-Cookie", cookieStr);
    void reply.status(200).send({
      address:   vr.recoveredAddress,
      method:    vr.method,
      chainId:   chainId.toString(),
      expiresAt: expiresAt.toISOString(),
    });
  });

  // POST /auth/logout
  app.post("/auth/logout", async (req, reply) => {
    requireCsrfHeaders(req, cfg.allowedOrigins);
    const sessionId = (req.cookies ?? {})[SESSION_COOKIE_NAME];
    if (isUuid(sessionId)) {
      await revokeSession(pool, schema, sessionId);
    }
    const cookieStr = clearSessionCookie(cfg.cookieDomain);
    void reply.header("Set-Cookie", cookieStr);
    void reply.status(200).send({ ok: true });
  });

  // GET /auth/me
  app.get("/auth/me", async (req, reply) => {
    const session = await requireSession(req, pool, schema);
    requireConfiguredChain(session.chainId);
    const identity = await pool.query('SELECT id FROM '+schema+'.wallet_identities WHERE chain_id=$1 AND wallet_address=lower($2)', [session.chainId.toString(), session.memberAddress]);
    if (!identity.rows[0]) throw unauthorized("Session identity unavailable");
    void reply.status(200).send({
      userId: identity.rows[0].id, address:     session.memberAddress,
      chainId:     session.chainId.toString(),
      workspaceId: session.workspaceId,
      expiresAt:   session.expiresAt.toISOString(),
    });
  });
}

// ── Tiny UUID helper (no uuid package dependency) ────────────────────────────

function randomUUID(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant bits
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
