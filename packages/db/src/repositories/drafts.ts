/**
 * @noticevault/db — terms draft + accepted consent repository
 *
 * Drafts are versioned. Once an accepted_consent exists for a draft,
 * the draft status becomes "accepted" and terms_json is immutable.
 * Version conflicts detected by optimistic lock (version check on update).
 */

import type { Pool, PoolClient } from "pg";
import type { TermsDraftRow, DraftStatus, AcceptedConsentRow, ConsentMethod } from "../types.js";

type Db = Pool | PoolClient;

// ── Drafts ────────────────────────────────────────────────────────────────────

export async function createDraft(
  db: Db,
  schema: string,
  id: string,
  workspaceId: string,
  authorAddress: string,
  termsJson: unknown,
  docHash: string,
): Promise<TermsDraftRow> {
  const r = await db.query<TermsDraftRow>(
    `INSERT INTO ${schema}.terms_drafts
       (id, workspace_id, author_address, terms_json, status, doc_hash)
     VALUES ($1, $2, $3, $4, 'draft', $5)
     RETURNING id, workspace_id, author_address, version, terms_json,
               status, doc_hash, created_at, updated_at`,
    [id, workspaceId, authorAddress.toLowerCase(), JSON.stringify(termsJson), docHash],
  );
  if (!r.rows[0]) throw new Error("createDraft: no row returned");
  return r.rows[0];
}

export async function getDraftById(
  db: Db,
  schema: string,
  id: string,
  workspaceId: string,
): Promise<TermsDraftRow | null> {
  const r = await db.query<TermsDraftRow>(
    `SELECT id, workspace_id, author_address, version, terms_json,
            status, doc_hash, created_at, updated_at
     FROM ${schema}.terms_drafts
     WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId],
  );
  return r.rows[0] ?? null;
}

/**
 * Update draft terms (optimistic lock on version).
 * Only allowed when status = 'draft'.
 * Bumps version atomically. Returns null if version conflict or wrong status.
 */
export async function updateDraft(
  db: Db,
  schema: string,
  id: string,
  workspaceId: string,
  authorAddress: string,
  expectedVersion: number,
  termsJson: unknown,
  docHash: string,
): Promise<TermsDraftRow | null> {
  const r = await db.query<TermsDraftRow>(
    `UPDATE ${schema}.terms_drafts
     SET terms_json = $5,
         doc_hash   = $6,
         version    = version + 1,
         updated_at = now()
     WHERE id = $1
       AND workspace_id = $2
       AND lower(author_address) = lower($3)
       AND version = $4
       AND status = 'draft'
     RETURNING id, workspace_id, author_address, version, terms_json,
               status, doc_hash, created_at, updated_at`,
    [id, workspaceId, authorAddress, expectedVersion, JSON.stringify(termsJson), docHash],
  );
  return r.rows[0] ?? null;
}

export async function setDraftStatus(
  db: Db,
  schema: string,
  id: string,
  workspaceId: string,
  newStatus: DraftStatus,
): Promise<boolean> {
  const r = await db.query(
    `UPDATE ${schema}.terms_drafts
     SET status = $3, updated_at = now()
     WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId, newStatus],
  );
  return (r.rowCount ?? 0) === 1;
}

// ── Accepted consents ─────────────────────────────────────────────────────────

export async function createAcceptedConsent(
  db: Db,
  schema: string,
  id: string,
  draftId: string,
  workspaceId: string,
  signerAddress: string,
  termsDigest: string,
  signatureHex: string,
  consentMethod: ConsentMethod,
  pinnedBlock: bigint,
  chainId: bigint,
): Promise<AcceptedConsentRow> {
  const r = await db.query<AcceptedConsentRow>(
    `INSERT INTO ${schema}.accepted_consents
       (id, draft_id, workspace_id, signer_address, terms_digest, signature_hex,
        consent_method, pinned_block, chain_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, draft_id, workspace_id, signer_address, terms_digest, signature_hex,
               consent_method, pinned_block::text, chain_id, signed_at`,
    [
      id, draftId, workspaceId, signerAddress.toLowerCase(),
      termsDigest, signatureHex, consentMethod,
      pinnedBlock.toString(), chainId.toString(),
    ],
  );
  if (!r.rows[0]) throw new Error("createAcceptedConsent: no row returned");
  return r.rows[0];
}

export async function getConsentForDraftAndSigner(
  db: Db,
  schema: string,
  draftId: string,
  signerAddress: string,
): Promise<AcceptedConsentRow | null> {
  const r = await db.query<AcceptedConsentRow>(
    `SELECT id, draft_id, workspace_id, signer_address, terms_digest, signature_hex,
            consent_method, pinned_block::text, chain_id, signed_at
     FROM ${schema}.accepted_consents
     WHERE draft_id = $1 AND lower(signer_address) = lower($2)`,
    [draftId, signerAddress],
  );
  return r.rows[0] ?? null;
}
