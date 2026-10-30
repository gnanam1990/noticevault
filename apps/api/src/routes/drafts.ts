import { isUuid } from "../request-identifiers.js";
import { mutateOnce } from '../mutations.js';
/**
 * @noticevault/api — terms draft routes
 *
 * POST /workspaces/:wsId/drafts          — create draft (workspace member)
 * GET  /workspaces/:wsId/drafts/:id      — get draft (workspace member)
 * PUT  /workspaces/:wsId/drafts/:id      — update draft (author only; status=draft; version bump)
 * POST /workspaces/:wsId/drafts/:id/accept-consent — record accepted provider consent
 *
 * DRAFT VALIDATION CONTRACT:
 * - All 11 canonical TermsInput fields are required and validated via the SDK codec.
 * - amountPerPeriod, periodSeconds, noticeSeconds, startAt, clientNonce,
 *   acceptanceDeadline are stored as lossless integer strings (NUMERIC-safe).
 * - No JS Number for bigint fields; unsafe/overflowed values are rejected.
 * - schemaVersion must be exactly 1.
 * - client, provider, token must be 0x-prefixed 40-hex-char Ethereum addresses.
 * - termsDocumentHash must be 0x + 64 hex chars.
 *
 * DOC HASH CONTRACT:
 * - docHash is computed as keccak256 of the stable canonical JSON encoding.
 * - Canonical JSON: all bigint fields as decimal strings, keys sorted, no whitespace.
 * - If the caller supplies docHash, it must match the server-computed value (409 if not).
 * - Hash algorithm is keccak256 (NOT SHA-256); stored as 0x + 64 hex chars.
 *
 * CONSENT CONTRACT:
 * - Session signer must be the draft's provider (immutable once set at creation).
 * - Digest is computed server-side from canonical draft; caller-supplied digest must match.
 * - Fixture EIP-712 uses SDK typed data and pure recovery; auth verifier is never used.
 * - Consent and accepted status transition are atomic (one DB transaction).
 * - Identical consent retry returns 200 (stable); altered retry returns 409.
 * - Missing live SDK config returns explicit BLOCKED_SDK result, never silently succeeds.
 *
 * IMMUTABILITY:
 * - Once accepted, draft terms_json and doc_hash are immutable.
 * - Any update to terms invalidates previous consents (status returns to draft).
 *
 * ACTORS: always derived from session; never from request body.
 */

import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import type pg from "pg";
import type { ApiConfig } from "../config.js";
import { requireSession } from "./auth.js";
import {
  createDraft,
  getDraftById,
  updateDraft,
  setDraftStatus,
  createAcceptedConsent,
  getConsentForDraftAndSigner,
  getMembership,
  getWorkspaceById,
} from "@noticevault/db";
import { badRequest, notFound, forbidden, conflict } from "../errors.js";
import { snapshotConsentDeployment } from "../consent-manifest.js";
import { keccak256, toBytes, recoverTypedDataAddress, isAddressEqual } from "viem";
import { computeTermsDigest, buildTypedData } from "@noticevault/sdk";
import type { TermsInput } from "@noticevault/sdk";

// ── SDK codec integration ──────────────────────────────────────────────────────

/**
 * Canonical 11-field TermsInput wire format (all numeric fields as decimal strings).
 * Bigint fields stored as strings in JSON to avoid precision loss.
 */
interface TermsJsonInput {
  schemaVersion:      number;
  client:             string;
  provider:           string;
  token:              string;
  amountPerPeriod:    string; // decimal bigint string
  periodSeconds:      string; // decimal bigint string
  noticeSeconds:      string; // decimal bigint string
  startAt:            string; // decimal bigint string
  clientNonce:        string; // decimal bigint string
  acceptanceDeadline: string; // decimal bigint string
  termsDocumentHash:  string; // 0x + 64 hex
}

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const BIGINT_STRING_RE = /^\d+$/; // non-negative decimal integer string

/**
 * Parse and validate a termsJson object from API input.
 * Returns the validated TermsJsonInput with all bigint fields as strings.
 * Throws ApiError (400) on any validation failure.
 *
 * We use the SDK TermsInput validation rules (M01 domain model).
 * The import is dynamic to avoid circular deps; SDK is a sibling package.
 */
export async function parseAndValidateTermsJson(raw: unknown): Promise<TermsJsonInput> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw badRequest("termsJson must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;

  // schemaVersion
  if (obj["schemaVersion"] !== 1) {
    throw badRequest("termsJson.schemaVersion must be 1");
  }

  // Address fields
  for (const field of ["client", "provider", "token"] as const) {
    if (typeof obj[field] !== "string" || !ADDR_RE.test(obj[field] as string)) {
      throw badRequest(`termsJson.${field} must be a 0x-prefixed 40-hex-char address`);
    }
  }

  // Bigint string fields — must be non-negative decimal integer strings
  for (const field of [
    "amountPerPeriod", "periodSeconds", "noticeSeconds",
    "startAt", "clientNonce", "acceptanceDeadline",
  ] as const) {
    const v = obj[field];
    if (typeof v !== "string" || !BIGINT_STRING_RE.test(v)) {
      throw badRequest(`termsJson.${field} must be a non-negative decimal integer string`);
    }
    // Check it fits in uint256 (< 2^256)
    let bv: bigint;
    try { bv = BigInt(v); } catch {
      throw badRequest(`termsJson.${field} is not a valid integer`);
    }
    if (bv < 0n) {
      throw badRequest(`termsJson.${field} must be non-negative`);
    }
    if (bv >= (2n ** 256n)) {
      throw badRequest(`termsJson.${field} exceeds uint256 range`);
    }
  }

  // termsDocumentHash
  if (typeof obj["termsDocumentHash"] !== "string" || !HASH_RE.test(obj["termsDocumentHash"] as string)) {
    throw badRequest("termsJson.termsDocumentHash must be 0x + 64 hex chars");
  }

  // Delegate to SDK validateTermsInput for the full domain range/overflow checks
  try {
    const { validateTermsInput } = await import("@noticevault/sdk");
    validateTermsInput({
      schemaVersion:      obj["schemaVersion"] as number,
      client:             obj["client"] as string,
      provider:           obj["provider"] as string,
      token:              obj["token"] as string,
      amountPerPeriod:    BigInt(obj["amountPerPeriod"] as string),
      periodSeconds:      BigInt(obj["periodSeconds"] as string),
      noticeSeconds:      BigInt(obj["noticeSeconds"] as string),
      startAt:            BigInt(obj["startAt"] as string),
      clientNonce:        BigInt(obj["clientNonce"] as string),
      acceptanceDeadline: BigInt(obj["acceptanceDeadline"] as string),
      termsDocumentHash:  obj["termsDocumentHash"] as string,
    });
  } catch (err) {
    if (err && typeof err === "object" && "name" in err && String((err as { name: unknown }).name).includes("ValidationError")) {
      throw badRequest(`termsJson validation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Non-validation errors (import failure, etc.) — rethrow
    throw err;
  }

  return {
    schemaVersion:      1,
    client:             (obj["client"] as string).toLowerCase(),
    provider:           (obj["provider"] as string).toLowerCase(),
    token:              (obj["token"] as string).toLowerCase(),
    amountPerPeriod:    obj["amountPerPeriod"] as string,
    periodSeconds:      obj["periodSeconds"] as string,
    noticeSeconds:      obj["noticeSeconds"] as string,
    startAt:            obj["startAt"] as string,
    clientNonce:        obj["clientNonce"] as string,
    acceptanceDeadline: obj["acceptanceDeadline"] as string,
    termsDocumentHash:  (obj["termsDocumentHash"] as string).toLowerCase(),
  };
}

/**
 * Compute the canonical doc hash for a TermsJsonInput.
 * Algorithm: keccak256 of the UTF-8 bytes of the stable JSON encoding.
 * Stable JSON: all keys sorted alphabetically, no whitespace, bigint fields as strings.
 * Returns "0x" + 64 hex chars.
 */
function computeDocHash(terms: TermsJsonInput): string {
  const sorted = JSON.stringify(
    terms,
    Object.keys(terms).sort() as (keyof TermsJsonInput)[],
  );
  const bytes  = toBytes(sorted);
  return keccak256(bytes);
}

// ── Route interfaces ──────────────────────────────────────────────────────────

interface CreateDraftBody {
  termsJson: unknown;
  docHash?:  string;
}

interface UpdateDraftBody {
  termsJson:       unknown;
  expectedVersion: number;
  docHash?:        string;
}

interface AcceptConsentBody {
  termsDigest:   string; // caller-supplied; must match server-computed
  signatureHex:  string;
  pinnedBlock:   string; // bigint string
  chainId:       number;
  // consentMethod is NOT trusted from the client; derived from verifier result
}

export async function draftRoutes(
  app:      FastifyInstance,
  pool:     pg.Pool,
  cfg:      ApiConfig,
): Promise<void> {
  const { schema } = cfg.db;
  const deployment = snapshotConsentDeployment(cfg.configIdentity, cfg.consentDeployment);

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

  app.get<{ Params: { wsId: string }; Querystring: { after?: string } }>("/workspaces/:wsId/drafts", async (req, reply) => {
    const session = await requireSession(req, pool, schema);
    const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!validId.test(req.params.wsId) || (req.query.after !== undefined && !validId.test(req.query.after))) throw badRequest("Invalid draft list ID/cursor");
    await authorizeWorkspaceMember(req.params.wsId, session.memberAddress, session.chainId);
    const result = await pool.query(
      `SELECT d.id,d.workspace_id,d.version,d.status FROM ${schema}.terms_drafts d WHERE d.workspace_id=$1 AND ($2::uuid IS NULL OR d.id>$2::uuid) AND EXISTS (SELECT 1 FROM ${schema}.workspace_memberships m WHERE m.workspace_id=d.workspace_id AND lower(m.member_address)=lower($3) AND m.chain_id=$4) ORDER BY d.id LIMIT 21`,
      [req.params.wsId, req.query.after ?? null, session.memberAddress, session.chainId.toString()],
    );
    const items = result.rows.slice(0, 20);
    return reply.send({ items, nextCursor: result.rows.length > 20 ? items[19].id : null });
  });

  // POST /workspaces/:wsId/drafts
  app.post<{ Params: { wsId: string }; Body: CreateDraftBody }>(
    "/workspaces/:wsId/drafts",
    async (req, reply) => {
      const session = await requireSession(req, pool, schema);
      await authorizeWorkspaceMember(req.params.wsId, session.memberAddress, session.chainId,true);

      const { termsJson } = req.body ?? {};
      if (termsJson === undefined || termsJson === null) {
        throw badRequest("termsJson required");
      }

      // Full 11-field canonical validation
      const validated = await parseAndValidateTermsJson(termsJson);
      const serverDocHash = computeDocHash(validated);

      // If caller supplied docHash, it must match the server-computed value
      const suppliedDocHash = (req.body as CreateDraftBody).docHash;
      if (suppliedDocHash !== undefined) {
        if (!/^0x[0-9a-fA-F]{64}$/.test(suppliedDocHash)) {
          throw badRequest("docHash must be 0x + 64 hex chars (keccak256)");
        }
        if (suppliedDocHash.toLowerCase() !== serverDocHash.toLowerCase()) {
          throw conflict("Supplied docHash does not match server-computed keccak256 of canonical terms", {
            supplied:  suppliedDocHash,
            computed:  serverDocHash,
          });
        }
      }

      const id    = randomUUID();
      if (req.headers['idempotency-key'] !== undefined) {
 const result = await mutateOnce(pool, schema, session.memberAddress, session.chainId, req.headers['idempotency-key'], 'POST /workspaces/' + req.params.wsId + '/drafts', validated, async (client) => ({
  status: 201, body: await createDraft(client, schema, id, req.params.wsId, session.memberAddress, validated, serverDocHash),
 }));
 return reply.status(result.status).send(result.body);
}
const draft = await createDraft(
        pool, schema, id, req.params.wsId, session.memberAddress, validated, serverDocHash,
      );
      void reply.status(201).send(draft);
    },
  );

  // GET /workspaces/:wsId/drafts/:id
  app.get<{ Params: { wsId: string; id: string } }>(
    "/workspaces/:wsId/drafts/:id",
    async (req, reply) => {
      const session = await requireSession(req, pool, schema);
      if (!isUuid(req.params.id)) throw badRequest("Invalid draft ID");
      await authorizeWorkspaceMember(req.params.wsId, session.memberAddress, session.chainId);
      const draft = await getDraftById(pool, schema, req.params.id, req.params.wsId);
      if (!draft) throw notFound("draft", req.params.id);
      void reply.status(200).send(draft);
    },
  );

  // PUT /workspaces/:wsId/drafts/:id
  app.put<{ Params: { wsId: string; id: string }; Body: UpdateDraftBody }>(
    "/workspaces/:wsId/drafts/:id",
    async (req, reply) => {
      const session = await requireSession(req, pool, schema);
      if (!isUuid(req.params.id)) throw badRequest("Invalid draft ID");
      await authorizeWorkspaceMember(req.params.wsId, session.memberAddress, session.chainId,true);
      if((await pool.query('SELECT id FROM '+schema+'.draft_revisions WHERE id=$1 AND workspace_id=$2',[req.params.id,req.params.wsId])).rows.length)throw conflict('This revision is immutable. Create a new revision instead.');

      const { termsJson, expectedVersion } = req.body ?? {};
      if (termsJson === undefined || termsJson === null) throw badRequest("termsJson required");
      if (typeof expectedVersion !== "number" || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
        throw badRequest("expectedVersion must be a positive integer");
      }

      // Full 11-field canonical validation
      const validated = await parseAndValidateTermsJson(termsJson);
      const serverDocHash = computeDocHash(validated);

      const suppliedDocHash = (req.body as UpdateDraftBody).docHash;
      if (suppliedDocHash !== undefined) {
        if (!/^0x[0-9a-fA-F]{64}$/.test(suppliedDocHash)) {
          throw badRequest("docHash must be 0x + 64 hex chars");
        }
        if (suppliedDocHash.toLowerCase() !== serverDocHash.toLowerCase()) {
          throw conflict("Supplied docHash does not match server-computed keccak256", {
            supplied: suppliedDocHash,
            computed: serverDocHash,
          });
        }
      }

      if (req.headers['idempotency-key'] !== undefined) {
 const result = await mutateOnce(pool, schema, session.memberAddress, session.chainId, req.headers['idempotency-key'], 'PUT /workspaces/' + req.params.wsId + '/drafts/' + req.params.id, { expectedVersion, terms: validated }, async (client) => {
  const updated = await updateDraft(client, schema, req.params.id, req.params.wsId, session.memberAddress, expectedVersion, validated, serverDocHash);
  if (!updated) throw conflict('Draft update failed: version conflict, wrong status, or insufficient permission', { expectedVersion });
  return { status: 200, body: updated };
 });
 return reply.status(result.status).send(result.body);
}
const updated = await updateDraft(
        pool, schema,
        req.params.id, req.params.wsId,
        session.memberAddress, expectedVersion,
        validated, serverDocHash,
      );

      if (!updated) {
        throw conflict(
          "Draft update failed: version conflict, wrong status, or insufficient permission",
          { expectedVersion },
        );
      }
      void reply.status(200).send(updated);
    },
  );

  // POST /workspaces/:wsId/drafts/:id/accept-consent
  app.post<{ Params: { wsId: string; id: string }; Body: AcceptConsentBody }>(
    "/workspaces/:wsId/drafts/:id/accept-consent",
    async (req, reply) => {
      const session = await requireSession(req, pool, schema);
      if (!isUuid(req.params.id)) throw badRequest("Invalid draft ID");
      await authorizeWorkspaceMember(req.params.wsId, session.memberAddress, session.chainId);

      const { termsDigest, signatureHex, pinnedBlock, chainId: chainIdNum } = req.body ?? {};

      if (!termsDigest || !/^0x[0-9a-fA-F]{64}$/.test(termsDigest)) {
        throw badRequest("termsDigest must be 0x + 64 hex chars");
      }
      if (!signatureHex || !/^0x[0-9a-fA-F]+$/.test(signatureHex) || signatureHex.length !== 132) {
        throw badRequest("signatureHex must be 0x-prefixed hex of exactly 65 bytes for fixture EOA consent");
      }
      if (!pinnedBlock || !/^\d+$/.test(pinnedBlock)) {
        throw badRequest("pinnedBlock must be a non-negative integer string");
      }
      if (!chainIdNum || !Number.isSafeInteger(chainIdNum) || chainIdNum <= 0) {
        throw badRequest("chainId must be a positive integer");
      }

      const draft = await getDraftById(pool, schema, req.params.id, req.params.wsId);
      if (!draft) throw notFound("draft", req.params.id);

      // Guard: session signer must be the draft's provider
      const draftTerms = draft.terms_json as TermsJsonInput;
      if (!draftTerms || typeof draftTerms !== "object") {
        throw badRequest("Draft has invalid terms_json");
      }
      const draftProvider = (draftTerms["provider"] as string | undefined)?.toLowerCase();
      if (!draftProvider || session.memberAddress.toLowerCase() !== draftProvider) {
        throw forbidden("Only the draft provider may submit consent");
      }

      if (draft.status === "superseded" || draft.status === "expired") {
        throw conflict(`Draft status is "${draft.status}"; consent not allowed`);
      }

      // No live consent can pass until M03 pinned account/factory/reorg guards
      // are independently verified. A configured manifest is not chain evidence.
      if (cfg.configIdentity !== "LOCAL_FIXTURE" || !deployment) {
        void reply.status(503).send({ error: { code: "BLOCKED_SDK", message: "Consent requires an explicit fixture manifest; live consent remains blocked pending verified SDK evidence." } });
        return;
      }
      if (BigInt(chainIdNum) !== deployment.chainId || session.chainId !== deployment.chainId) {
        throw forbidden("Consent request, session and deployment chain must match");
      }
      const terms = termsJsonToInput(await parseAndValidateTermsJson(draftTerms));
      const serverDigest = computeTermsDigest(terms, deployment);
      if (termsDigest.toLowerCase() !== serverDigest.toLowerCase()) {
        throw conflict("termsDigest does not match server-computed digest", { computed: serverDigest });
      }
      // Fixture-only cryptographic EIP-712 verification; never the auth adapter.
      // No account-type/on-chain proof is asserted by this local test path.
      let fixtureSignatureMatches = false;
      try {
        const recovered = await recoverTypedDataAddress({ ...buildTypedData(terms, deployment), signature: signatureHex as `0x${string}` });
        fixtureSignatureMatches = isAddressEqual(recovered, terms.provider as `0x${string}`);
      } catch { /* Invalid local fixture signature; no chain evidence is inferred. */ }
      if (!fixtureSignatureMatches) throw forbidden("Consent typed-data signature verification failed");
      const derivedMethod = "ecdsa" as const;

      // Idempotency: if consent already exists for this signer+draft, check it's identical
      const existing = await getConsentForDraftAndSigner(pool, schema, req.params.id, session.memberAddress);
      if (existing) {
        // Identical retry → stable 200
        if (
          existing.terms_digest.toLowerCase() === termsDigest.toLowerCase() &&
          existing.signature_hex.toLowerCase() === signatureHex.toLowerCase() &&
          String(existing.chain_id) === String(chainIdNum) &&
          String(existing.pinned_block) === BigInt(pinnedBlock).toString()
        ) {
          void reply.status(200).send(existing);
          return;
        }
        // Different payload → 409
        throw conflict("Consent already recorded with different digest or signature");
      }

      if (draft.status === "accepted") throw conflict("Draft is already accepted; consent is immutable");

      // Create consent + update draft status atomically
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Re-fetch draft inside transaction to lock version for concurrent edit guard
        const lockedDraft = await getDraftById(client, schema, req.params.id, req.params.wsId);
        if (!lockedDraft) {
          await client.query("ROLLBACK");
          throw notFound("draft", req.params.id);
        }
        if (lockedDraft.version !== draft.version) {
          await client.query("ROLLBACK");
          throw conflict("Draft was concurrently edited; consent cannot be applied to stale version");
        }
        if (lockedDraft.status !== "draft" && lockedDraft.status !== "awaiting_consent") {
          await client.query("ROLLBACK");
          throw conflict(`Draft status changed to "${lockedDraft.status}"; cannot accept consent`);
        }

        const consentId = randomUUID();
        const consent = await createAcceptedConsent(
          client, schema, consentId,
          req.params.id, req.params.wsId,
          session.memberAddress,
          termsDigest, signatureHex, derivedMethod,
          BigInt(pinnedBlock), BigInt(chainIdNum),
        );
        await setDraftStatus(client, schema, req.params.id, req.params.wsId, "accepted");
        await client.query("COMMIT");
        void reply.status(201).send(consent);
      } catch (err) {
        try { await client.query("ROLLBACK"); } catch { /* best-effort */ }
        throw err;
      } finally {
        client.release();
      }
    },
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/**
 * Build a TermsInput from a stored TermsJsonInput for EIP-712 hashing.
 * All bigint-string fields are converted to BigInt. Addresses are lowercased.
 */
function termsJsonToInput(t: TermsJsonInput): TermsInput {
  return {
    schemaVersion:      t.schemaVersion,
    client:             t.client,
    provider:           t.provider,
    token:              t.token,
    amountPerPeriod:    BigInt(t.amountPerPeriod),
    periodSeconds:      BigInt(t.periodSeconds),
    noticeSeconds:      BigInt(t.noticeSeconds),
    startAt:            BigInt(t.startAt),
    clientNonce:        BigInt(t.clientNonce),
    acceptanceDeadline: BigInt(t.acceptanceDeadline),
    termsDocumentHash:  t.termsDocumentHash,
  };
}
