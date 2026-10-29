/**
 * @noticevault/db — public API
 *
 * M04: PostgreSQL-backed persistence for workspaces, auth, drafts, consents, intents.
 * Migrations: runMigrations() from ./migrate.ts.
 * All bigint DB fields (NUMERIC/INT8) returned as strings; convert with BigInt() at the call site.
 */

export const DB_VERSION = "0.1.0-m04";

// Config
export { loadDbConfig, localFixtureDbConfig } from "./config.js";
export type { DbConfig } from "./config.js";

// Pool
export { createPool, ensureTypeParsers } from "./pool.js";

// Migrations
export { runMigrations, quoteSchema } from "./migrate.js";
export type { MigrationResult } from "./migrate.js";

// Types
export type {
  WorkspaceRow,
  WorkspaceMembershipRow,
  WalletChallengeRow,
  SessionRow,
  TermsDraftRow,
  DraftStatus,
  AcceptedConsentRow,
  ConsentMethod,
  IntentRow,
  IntentStatus,
  EvidenceSource,
} from "./types.js";

// Repositories
export {
  createWorkspace,
  getWorkspaceById,
  addMembership,
  getMembership,
  listMemberships,
} from "./repositories/workspaces.js";

export {
  createChallenge,
  findPendingChallenge,
  consumeChallenge,
  createSession,
  findValidSession,
  revokeSession,
} from "./repositories/auth.js";

export {
  createDraft,
  getDraftById,
  updateDraft,
  setDraftStatus,
  createAcceptedConsent,
  getConsentForDraftAndSigner,
} from "./repositories/drafts.js";

export {
  createOrGetIntent,
  getIntentByActorKey,
  getIntentByKey,
  getIntentById,
  updateIntentStatus,
  IdempotencyConflictError,
} from "./repositories/intents.js";
export type { CreateIntentParams } from "./repositories/intents.js";
