import { isUuid } from "../request-identifiers.js";
/**
 * @noticevault/api — intent routes
 *
 * POST /workspaces/:wsId/intents       — create or retrieve an idempotent intent
 * GET  /workspaces/:wsId/intents/:id   — get intent by id
 *
 * IDEMPOTENCY CONTRACT:
 *  - Idempotency-Key header required (1–128 chars). Header name: Idempotency-Key.
 *  - Idempotency is ACTOR-SCOPED: (key, actor, workspace, operation) are the
 *    unique tuple. Different actors with the same key get independent rows.
 *  - payload_hash = sha256(stable JSON of {operation, workspaceId, evidenceSource,
 *    evidenceBlock, evidenceConfigIdentity, payload} with actor NOT in hash —
 *    actor is derived from session and cannot be caller-supplied).
 *  - Same key + same actor + same operation + same payload → 200 with existing intent.
 *  - Same key + any changed field → 409 CONFLICT.
 *  - DB unique constraint: (idempotency_key, actor_address, workspace_id, operation).
 *
 * EVIDENCE CONTRACT:
 *  - M04 accepts only SIMULATION and LOCAL_FIXTURE evidence_source.
 *  - VERIFIED is reserved for M05 indexer integration. The DB/API layer NEVER
 *    asserts VERIFIED evidence; that is exclusively the SDK's on-chain verifier.
 *  - SIMULATION intents are never promoted to CONFIRMED chain proof in M04.
 *
 * ACTOR DERIVATION:
 *  - actor_address is ALWAYS derived from session.memberAddress.
 *  - Request body actor fields are IGNORED; never trusted.
 *
 * AUTHORIZATION:
 *  - Session membership in workspace required for all routes.
 *
 * PROVENANCE:
 *  - The API persists caller-labeled pending rows only. Guarded actionable prep
 *    requires SDK-verified on-chain evidence (M05+). Missing live config returns
 *    explicit BLOCKED_SDK result, not silent success.
 */

import type { FastifyInstance } from "fastify";
import { randomBytes, createHash } from "node:crypto";
import type pg from "pg";
import type { ApiConfig } from "../config.js";
import { requireSession } from "./auth.js";
import {
  createOrGetIntent,
  getIntentById,
  getWorkspaceById,
  getMembership,
  IdempotencyConflictError,
} from "@noticevault/db";
import type { EvidenceSource } from "@noticevault/db";
import { badRequest, notFound, forbidden, conflict } from "../errors.js";

// M04: only SIMULATION and LOCAL_FIXTURE evidence sources are permitted for caller input.
// VERIFIED is reserved for M05 on-chain indexer output only.
const ALLOWED_EVIDENCE_SOURCES: ReadonlySet<EvidenceSource> = new Set([
  "SIMULATION",
  "LOCAL_FIXTURE",
]);

interface CreateIntentBody {
  operation:               string;
  evidenceSource?:         string;
  evidenceBlock?:          string; // bigint string
  evidenceConfigIdentity?: string;
  payload?:                unknown;
}

export async function intentRoutes(
  app:  FastifyInstance,
  pool: pg.Pool,
  cfg:  ApiConfig,
): Promise<void> {
  const { schema } = cfg.db;

  async function authorizeWorkspaceMember(
    wsId:          string,
    memberAddress: string, chainId: bigint, edit=false,
  ): Promise<void> {
    if (!isUuid(wsId)) throw badRequest("Invalid workspace ID");
    const ws = await getWorkspaceById(pool, schema, wsId);
    if (!ws) throw notFound("workspace", wsId);
    const membership = await getMembership(pool, schema, wsId, memberAddress, chainId);
    if (!membership) throw forbidden("You are not a member of this workspace");
    if(edit&&membership.role==="viewer")throw forbidden("Workspace editor required");
  }

  // POST /workspaces/:wsId/intents
  app.post<{ Params: { wsId: string }; Body: CreateIntentBody }>(
    "/workspaces/:wsId/intents",
    async (req, reply) => {
      const session = await requireSession(req, pool, schema);
      await authorizeWorkspaceMember(req.params.wsId, session.memberAddress, session.chainId,true);

      // Idempotency-Key header (required; normalized to lowercase)
      const idempotencyKey = req.headers["idempotency-key"];
      if (!idempotencyKey || typeof idempotencyKey !== "string"
          || idempotencyKey.trim().length === 0 || idempotencyKey.length > 128) {
        throw badRequest("Idempotency-Key header required (1–128 chars)");
      }

      const { operation, evidenceSource, evidenceBlock, evidenceConfigIdentity, payload } = req.body ?? {};

      if (!operation || typeof operation !== "string" || operation.trim().length < 1 || operation.length > 64) {
        throw badRequest("operation must be 1–64 chars");
      }

      // Validate evidence source — never allow VERIFIED from caller
      if (evidenceSource !== undefined) {
        if (!ALLOWED_EVIDENCE_SOURCES.has(evidenceSource as EvidenceSource)) {
          throw badRequest(
            `evidenceSource "${evidenceSource}" is not allowed. ` +
            `Accepted values: ${[...ALLOWED_EVIDENCE_SOURCES].join(", ")}. ` +
            `VERIFIED evidence can only be produced by the on-chain SDK verifier, never by the caller.`,
          );
        }
      }

      let evidenceBlockBigint: bigint | undefined;
      if (evidenceBlock !== undefined) {
        if (!/^\d+$/.test(evidenceBlock)) throw badRequest("evidenceBlock must be a non-negative integer string");
        evidenceBlockBigint = BigInt(evidenceBlock);
      }

      // Compute payload hash from stable serialisation.
      // Actor (session.memberAddress) is NOT included in the hash — it is session-derived
      // and the idempotency scope is (key, actor, workspace, operation) in the DB constraint.
      const payloadHash = computePayloadHash({
        operation:             operation.trim(),
        workspaceId:           req.params.wsId,
        evidenceSource:        evidenceSource ?? null,
        evidenceBlock:         evidenceBlock ?? null,
        evidenceConfigIdentity: evidenceConfigIdentity ?? null,
        payload:               payload ?? null,
      });

      const id = randomUUID();
      try {
        const { intent, created } = await createOrGetIntent(pool, schema, {
          id,
          idempotencyKey: idempotencyKey.trim(),
          payloadHash,
          workspaceId:  req.params.wsId,
          actorAddress: session.memberAddress,
          operation:    operation.trim(),
          ...(evidenceSource !== undefined      ? { evidenceSource: evidenceSource as EvidenceSource } : {}),
          ...(evidenceBlockBigint !== undefined  ? { evidenceBlock: evidenceBlockBigint }               : {}),
          ...(evidenceConfigIdentity !== undefined ? { evidenceConfigIdentity }                         : {}),
        });

        void reply.status(created ? 201 : 200).send(intent);
      } catch (err) {
        if (err instanceof IdempotencyConflictError) {
          throw conflict(
            "Idempotency key reused with different payload for same actor/workspace/operation",
            { idempotencyKey, existingId: err.existingIntent.id },
          );
        }
        throw err;
      }
    },
  );

  // GET /workspaces/:wsId/intents/:id
  app.get<{ Params: { wsId: string; id: string } }>(
    "/workspaces/:wsId/intents/:id",
    async (req, reply) => {
      const session = await requireSession(req, pool, schema);
      if (!isUuid(req.params.id)) throw badRequest("Invalid intent ID");
      await authorizeWorkspaceMember(req.params.wsId, session.memberAddress, session.chainId);

      const intent = await getIntentById(pool, schema, req.params.id, req.params.wsId);
      if (!intent) throw notFound("intent", req.params.id);

      void reply.status(200).send(intent);
    },
  );
}

function randomUUID(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function computePayloadHash(obj: unknown): string {
  const sorted = JSON.stringify(sortedKeys(obj));
  return createHash("sha256").update(sorted, "utf8").digest("hex");
}

function sortedKeys(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(sortedKeys);
  const obj = v as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(obj).sort().map((k) => [k, sortedKeys(obj[k])]),
  );
}
