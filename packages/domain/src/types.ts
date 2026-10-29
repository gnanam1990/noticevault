/**
 * @noticevault/domain — types, constants, and error classes
 *
 * Canonical AgreementTerms field order matches future Solidity ABI.
 * All money/time/nonce values are bigint. No Number/float for financial values.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

export const SCHEMA_VERSION = 1 as const;
export const UINT256_MAX = (1n << 256n) - 1n;
export const INT64_MAX = 9_223_372_036_854_775_807n; // 2^63 - 1
export const ZERO = 0n;

// ── AgreementTerms ─────────────────────────────────────────────────────────────

/**
 * Canonical AgreementTerms — field order matches Solidity ABI (preserve for M02).
 * schemaVersion uint32; client address; provider address; token address;
 * amountPerPeriod A uint256; periodSeconds P uint64; noticeSeconds N uint64;
 * startAt t0 uint64; clientNonce uint256; acceptanceDeadline uint64;
 * termsDocumentHash bytes32.
 */
export interface AgreementTerms {
  readonly schemaVersion: number; // uint32 — always SCHEMA_VERSION=1
  readonly client: string; // address (0x hex)
  readonly provider: string; // address (0x hex)
  readonly token: string; // address (0x hex) — must be in allowlist
  readonly amountPerPeriod: bigint; // A uint256 — > 0
  readonly periodSeconds: bigint; // P uint64
  readonly noticeSeconds: bigint; // N uint64
  readonly startAt: bigint; // t0 uint64
  readonly clientNonce: bigint; // uint256
  readonly acceptanceDeadline: bigint; // uint64 — equality = expired
  readonly termsDocumentHash: string; // bytes32 (0x hex, 64 chars)
}

// ── AccountingState ───────────────────────────────────────────────────────────

export type NoticeReason = "CLIENT_CANCELLED" | "MISSED_CHECKPOINT";

/**
 * Mutable accounting state for one agreement.
 * noticeStartStored: null = not yet stored. NEVER confuse zero-timestamp with absent.
 */
export interface AccountingState {
  readonly terms: AgreementTerms;
  readonly regularFunded: bigint; // F — initial A, each renewal +A; always multiple of A
  readonly regularPaid: bigint; // RP — cumulative provider regular claims
  readonly noticePaid: bigint; // NP — cumulative provider notice claims
  readonly clientRefunded: bigint; // CR — cumulative client refunds
  readonly noticeStartStored: bigint | null; // explicit null = absent
  readonly noticeReasonStored: NoticeReason | null; // null iff noticeStartStored null
}

// ── Caps ──────────────────────────────────────────────────────────────────────

export interface AgreementCaps {
  readonly maxLiabilityPerAgreement: bigint;
}

export interface FactoryCaps {
  readonly maxTotalLiability: bigint;
  readonly currentFactoryLiability: bigint;
}

// ── Token context ─────────────────────────────────────────────────────────────

export interface TokenContext {
  readonly allowlistedTokens: Set<string>; // lowercase 0x addresses
  readonly decimals: number; // must be 6 for USDC
}

// ── Phases ────────────────────────────────────────────────────────────────────

/**
 * Deployed agreement lifecycle phases (DRAFT etc. are outside this enum).
 */
export type AgreementPhase =
  | "SCHEDULED"
  | "ACTIVE"
  | "NOTICE_SCHEDULED"
  | "NOTICE"
  | "ENDED_CLAIMABLE"
  | "CLOSED";

// ── Snapshot ──────────────────────────────────────────────────────────────────

export interface AgreementSnapshot {
  readonly source: "SIMULATION";
  readonly schemaVersion: 1;
  readonly observationTimestamp: bigint;
  readonly phase: AgreementPhase;
  readonly R: bigint;
  readonly D: bigint;
  readonly hasStoredNotice: boolean;
  readonly S: bigint | null;
  readonly E: bigint | null;
  readonly reason: NoticeReason | null;
  readonly V: bigint;
  readonly W: bigint;
  readonly RP: bigint;
  readonly NP: bigint;
  readonly providerClaimable: bigint;
  readonly clientRefundable: bigint;
  readonly L: bigint;
  readonly noticeRemaining: bigint;
  readonly actualBalance?: bigint; // optional, only when explicitly supplied
}

// ── Events ────────────────────────────────────────────────────────────────────

export type NoticeVaultEvent =
  | { readonly kind: "NoticeStarted"; readonly S: bigint; readonly reason: NoticeReason }
  | { readonly kind: "ProviderClaimed"; readonly regularDelta: bigint; readonly noticeDelta: bigint }
  | { readonly kind: "ClientRefunded"; readonly amount: bigint }
  | { readonly kind: "PeriodFunded"; readonly newF: bigint; readonly newD: bigint };

// ── Transition result ─────────────────────────────────────────────────────────

export interface TransitionResult {
  readonly state: AccountingState;
  readonly events: readonly NoticeVaultEvent[];
  readonly transferAmount: bigint;
  readonly transferTo: string | null;
}

// ── Error classes ─────────────────────────────────────────────────────────────

export class NoticeVaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoticeVaultError";
  }
}

export class InvalidTermsError extends NoticeVaultError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTermsError";
  }
}

export class UnauthorizedActorError extends NoticeVaultError {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedActorError";
  }
}

export class NoticeAlreadyStartedError extends NoticeVaultError {
  constructor(message: string) {
    super(message);
    this.name = "NoticeAlreadyStartedError";
  }
}

export class FundingWindowClosedError extends NoticeVaultError {
  constructor(message: string) {
    super(message);
    this.name = "FundingWindowClosedError";
  }
}

export class CheckpointMismatchError extends NoticeVaultError {
  constructor(message: string) {
    super(message);
    this.name = "CheckpointMismatchError";
  }
}

export class AgreementCapExceededError extends NoticeVaultError {
  constructor(message: string) {
    super(message);
    this.name = "AgreementCapExceededError";
  }
}

export class FactoryCapExceededError extends NoticeVaultError {
  constructor(message: string) {
    super(message);
    this.name = "FactoryCapExceededError";
  }
}

export class MalformedStateError extends NoticeVaultError {
  constructor(message: string) {
    super(message);
    this.name = "MalformedStateError";
  }
}

export class ArithmeticError extends NoticeVaultError {
  constructor(message: string) {
    super(message);
    this.name = "ArithmeticError";
  }
}
