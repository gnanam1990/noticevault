/**
 * @noticevault/db — intent repository
 *
 * Intents are idempotent operation records. Idempotency is scoped to
 * (idempotency_key, actor_address, workspace_id, operation) — different actors
 * cannot share a result even with the same key. Same key + same actor + same
 * operation + same payload_hash returns the existing intent. Same key + different
 * payload_hash is a conflict (409 in the API layer).
 *
 * evidence_block is NUMERIC(78,0); stored and returned as string.
 * Never interprets chain state as VERIFIED — that is the SDK's responsibility.
 */

import type { Pool, PoolClient } from "pg";
import type { IntentRow, IntentStatus, EvidenceSource } from "../types.js";

type Db = Pool | PoolClient;

export interface CreateIntentParams {
  readonly id:                     string;
  readonly idempotencyKey:         string;
  readonly payloadHash:            string;
  readonly workspaceId:            string;
  readonly actorAddress:           string;
  readonly operation:              string;
  readonly evidenceSource?:        EvidenceSource;
  readonly evidenceBlock?:         bigint;
  readonly evidenceConfigIdentity?: string;
}

/**
 * Create an intent, or return the existing one with the same key+actor+workspace+operation.
 * Idempotency is actor-scoped: different actors sharing the same key get independent rows.
 * Throws IdempotencyConflictError if the existing intent has a different payload_hash.
 *
 * IMPORTANT: on a unique-constraint violation (23505), we fetch the existing row with
 * a fresh query. Do NOT re-use the failed transaction connection for the SELECT;
 * the caller must pass a Pool (not an already-aborted PoolClient) for the fast path.
 */
export async function createOrGetIntent(
  db: Db,
  schema: string,
  params: CreateIntentParams,
): Promise<{ intent: IntentRow; created: boolean }> {
  // Try insert first (fast path)
  try {
    const r = await db.query<IntentRow>(
      `INSERT INTO ${schema}.intents
         (id, idempotency_key, payload_hash, workspace_id, actor_address, operation,
          status, evidence_source, evidence_block, evidence_config_identity)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9)
       RETURNING id, idempotency_key, payload_hash, workspace_id, actor_address, operation,
                 status, evidence_source, evidence_block::text, evidence_config_identity,
                 result_json, created_at, updated_at`,
      [
        params.id,
        params.idempotencyKey,
        params.payloadHash,
        params.workspaceId,
        params.actorAddress.toLowerCase(),
        params.operation,
        params.evidenceSource ?? null,
        params.evidenceBlock !== undefined ? params.evidenceBlock.toString() : null,
        params.evidenceConfigIdentity ?? null,
      ],
    );
    if (!r.rows[0]) throw new Error("createOrGetIntent: no row returned");
    return { intent: r.rows[0], created: true };
  } catch (err: unknown) {
    // Unique constraint violation on (idempotency_key, actor_address, workspace_id, operation)
    const pgErr = err as { code?: string };
    if (pgErr.code !== "23505") throw err;

    // Fetch existing by actor-scoped key — use the same db so the pool can give a fresh connection
    const existing = await getIntentByActorKey(
      db, schema,
      params.idempotencyKey,
      params.actorAddress,
      params.workspaceId,
      params.operation,
    );
    if (!existing) throw new Error("createOrGetIntent: conflict but no existing row found");

    // Payload hash mismatch → caller should return 409
    if (existing.payload_hash !== params.payloadHash) {
      throw new IdempotencyConflictError(
        `Idempotency key "${params.idempotencyKey}" already used with a different payload`,
        existing,
      );
    }
    return { intent: existing, created: false };
  }
}

export class IdempotencyConflictError extends Error {
  readonly existingIntent: IntentRow;
  constructor(message: string, existing: IntentRow) {
    super(message);
    this.name = "IdempotencyConflictError";
    this.existingIntent = existing;
  }
}

/**
 * Fetch intent by actor-scoped key. Matches the unique constraint.
 */
export async function getIntentByActorKey(
  db: Db,
  schema: string,
  idempotencyKey: string,
  actorAddress: string,
  workspaceId: string,
  operation: string,
): Promise<IntentRow | null> {
  const r = await db.query<IntentRow>(
    `SELECT id, idempotency_key, payload_hash, workspace_id, actor_address, operation,
            status, evidence_source, evidence_block::text, evidence_config_identity,
            result_json, created_at, updated_at
     FROM ${schema}.intents
     WHERE idempotency_key = $1
       AND lower(actor_address) = lower($2)
       AND workspace_id = $3
       AND operation = $4`,
    [idempotencyKey, actorAddress, workspaceId, operation],
  );
  return r.rows[0] ?? null;
}

/** @deprecated Use getIntentByActorKey for idempotency lookups. */
export async function getIntentByKey(
  db: Db,
  schema: string,
  idempotencyKey: string,
  workspaceId: string,
): Promise<IntentRow | null> {
  const r = await db.query<IntentRow>(
    `SELECT id, idempotency_key, payload_hash, workspace_id, actor_address, operation,
            status, evidence_source, evidence_block::text, evidence_config_identity,
            result_json, created_at, updated_at
     FROM ${schema}.intents
     WHERE idempotency_key = $1 AND workspace_id = $2`,
    [idempotencyKey, workspaceId],
  );
  return r.rows[0] ?? null;
}

export async function getIntentById(
  db: Db,
  schema: string,
  id: string,
  workspaceId: string,
): Promise<IntentRow | null> {
  const r = await db.query<IntentRow>(
    `SELECT id, idempotency_key, payload_hash, workspace_id, actor_address, operation,
            status, evidence_source, evidence_block::text, evidence_config_identity,
            result_json, created_at, updated_at
     FROM ${schema}.intents
     WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId],
  );
  return r.rows[0] ?? null;
}

export async function updateIntentStatus(
  db: Db,
  schema: string,
  id: string,
  status: IntentStatus,
  resultJson?: unknown,
): Promise<boolean> {
  const r = await db.query(
    `UPDATE ${schema}.intents
     SET status = $2, result_json = $3, updated_at = now()
     WHERE id = $1`,
    [id, status, resultJson !== undefined ? JSON.stringify(resultJson) : null],
  );
  return (r.rowCount ?? 0) === 1;
}
