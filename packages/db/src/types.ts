/**
 * @noticevault/db — canonical DB row types
 *
 * NUMERIC(78,0) columns arrive as strings from pg (type parser set in pool.ts).
 * Callers convert to BigInt with BigInt(row.pinned_block) etc.
 * Never store plain JS Number for bigint/amount fields.
 */

export interface WorkspaceRow {
  id:             string;
  name:           string;
  owner_address:  string;
  created_at:     Date;
  updated_at:     Date;
}

export interface WorkspaceMembershipRow {
  workspace_id:   string;
  member_address: string;
  role:           "owner" | "member" | "editor" | "viewer";
  joined_at:      Date;
}

export interface WalletChallengeRow {
  id:           string;
  address:      string;
  domain:       string;
  /** Full Origin header value stored at challenge creation, e.g. "http://localhost:5173" */
  origin:       string;
  /** Full verify URI stored at challenge creation, e.g. "http://localhost:5173/auth/verify" */
  uri:          string;
  chain_id:     string; // pg INT8 → string
  nonce:        string;
  /** Stored explicitly at creation so verify rebuilds the EXACT same message bytes */
  issued_at:    Date;
  expires_at:   Date;
  consumed_at:  Date | null;
}

export interface SessionRow {
  id:             string;
  workspace_id:   string | null;
  member_address: string;
  chain_id:       string; // pg INT8 → string
  created_at:     Date;
  expires_at:     Date;
  revoked_at:     Date | null;
}

export type DraftStatus = "draft" | "awaiting_consent" | "accepted" | "superseded" | "expired";

export interface TermsDraftRow {
  id:             string;
  workspace_id:   string;
  author_address: string;
  version:        number;
  terms_json:     unknown; // JSONB
  status:         DraftStatus;
  doc_hash:       string;
  created_at:     Date;
  updated_at:     Date;
}

export type ConsentMethod = "ecdsa" | "erc1271";

export interface AcceptedConsentRow {
  id:               string;
  draft_id:         string;
  workspace_id:     string;
  signer_address:   string;
  terms_digest:     string;
  signature_hex:    string;
  consent_method:   ConsentMethod;
  pinned_block:     string; // NUMERIC → string, convert to BigInt
  chain_id:         string;
  signed_at:        Date;
}

export type IntentStatus = "pending" | "prepared" | "simulation_only" | "failed";
export type EvidenceSource = "VERIFIED" | "SIMULATION" | "LOCAL_FIXTURE";

export interface IntentRow {
  id:                      string;
  idempotency_key:         string;
  payload_hash:            string;
  workspace_id:            string;
  actor_address:           string;
  operation:               string;
  status:                  IntentStatus;
  evidence_source:         EvidenceSource | null;
  evidence_block:          string | null; // NUMERIC → string
  evidence_config_identity: string | null;
  result_json:             unknown | null;
  created_at:              Date;
  updated_at:              Date;
}
