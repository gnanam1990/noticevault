/**
 * @noticevault/db — auth repository (challenges + sessions)
 *
 * wallet_challenges: single-use sign-in challenges.
 *   - issued_at is stored explicitly (not DEFAULT now()) so the verify handler
 *     can reconstruct the EXACT same canonical message the wallet signed.
 *   - origin and uri are stored so reconstruct is independent of request headers.
 * sessions: HttpOnly cookie sessions, DB-backed, revocable.
 *
 * ATOMICITY CONTRACT:
 *   consumeChallenge + createSession must be called inside the SAME transaction
 *   (PoolClient passed to both). The auth route owns the transaction boundary.
 *
 * All timestamps are stored as TIMESTAMPTZ. Expiry comparisons done in SQL.
 */

import type { Pool, PoolClient } from "pg";
import type { WalletChallengeRow, SessionRow } from "../types.js";

type Db = Pool | PoolClient;

// ── Challenges ────────────────────────────────────────────────────────────────

export async function createChallenge(
  db: Db,
  schema: string,
  id: string,
  address: string,
  domain: string,
  origin: string,
  uri: string,
  chainId: bigint,
  nonce: string,
  issuedAt: Date,
  expiresAt: Date,
): Promise<WalletChallengeRow> {
  const r = await db.query<WalletChallengeRow>(
    `INSERT INTO ${schema}.wallet_challenges
       (id, address, domain, origin, uri, chain_id, nonce, issued_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, address, domain, origin, uri, chain_id, nonce, issued_at, expires_at, consumed_at`,
    [id, address.toLowerCase(), domain, origin, uri, chainId.toString(), nonce, issuedAt, expiresAt],
  );
  if (!r.rows[0]) throw new Error("createChallenge: no row returned");
  return r.rows[0];
}

/**
 * Find an unconsumed, unexpired challenge by address+domain+chainId+nonce.
 * Returns the full row including origin, uri, issued_at so the caller can
 * reconstruct the exact canonical message without re-deriving from request headers.
 */
export async function findPendingChallenge(
  db: Db,
  schema: string,
  address: string,
  domain: string,
  chainId: bigint,
  nonce: string,
): Promise<WalletChallengeRow | null> {
  const r = await db.query<WalletChallengeRow>(
    `SELECT id, address, domain, origin, uri, chain_id, nonce, issued_at, expires_at, consumed_at
     FROM ${schema}.wallet_challenges
     WHERE lower(address) = lower($1)
       AND domain = $2
       AND chain_id = $3
       AND nonce = $4
       AND consumed_at IS NULL
       AND expires_at > now()`,
    [address, domain, chainId.toString(), nonce],
  );
  return r.rows[0] ?? null;
}

/**
 * Atomically mark a challenge as consumed. Must be called inside a transaction
 * together with createSession so replay is impossible even under concurrent requests.
 * Returns false if already consumed or not found.
 */
export async function consumeChallenge(
  db: Db,
  schema: string,
  id: string,
): Promise<boolean> {
  const r = await db.query(
    `UPDATE ${schema}.wallet_challenges
     SET consumed_at = now()
     WHERE id = $1
       AND consumed_at IS NULL
       AND expires_at > now()`,
    [id],
  );
  return (r.rowCount ?? 0) === 1;
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function createSession(
  db: Db,
  schema: string,
  id: string,
  memberAddress: string,
  chainId: bigint,
  expiresAt: Date,
  workspaceId?: string,
): Promise<SessionRow> {
  const r = await db.query<SessionRow>(
    `INSERT INTO ${schema}.sessions
       (id, workspace_id, member_address, chain_id, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, workspace_id, member_address, chain_id, created_at, expires_at, revoked_at`,
    [id, workspaceId ?? null, memberAddress.toLowerCase(), chainId.toString(), expiresAt],
  );
  if (!r.rows[0]) throw new Error("createSession: no row returned");
  return r.rows[0];
}

/**
 * Find a valid (not expired, not revoked) session by id.
 */
export async function findValidSession(
  db: Db,
  schema: string,
  id: string,
): Promise<SessionRow | null> {
  const r = await db.query<SessionRow>(
    `SELECT id, workspace_id, member_address, chain_id, created_at, expires_at, revoked_at
     FROM ${schema}.sessions
     WHERE id = $1
       AND revoked_at IS NULL
       AND expires_at > now()`,
    [id],
  );
  return r.rows[0] ?? null;
}

/**
 * Revoke a session. Returns false if already revoked or not found.
 */
export async function revokeSession(
  db: Db,
  schema: string,
  id: string,
): Promise<boolean> {
  const r = await db.query(
    `UPDATE ${schema}.sessions
     SET revoked_at = now()
     WHERE id = $1 AND revoked_at IS NULL`,
    [id],
  );
  return (r.rowCount ?? 0) === 1;
}
