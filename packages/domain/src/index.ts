/**
 * @noticevault/domain — public API
 *
 * Pure deterministic bigint financial reference model.
 * No browser APIs, React, wagmi, RPC, or signing.
 */

export const DOMAIN_VERSION = "0.1.0-m01";

// Types
export type {
  AgreementTerms,
  AccountingState,
  AgreementCaps,
  FactoryCaps,
  TokenContext,
  AgreementPhase,
  AgreementSnapshot,
  NoticeReason,
  NoticeVaultEvent,
  TransitionResult,
} from "./types.js";

export {
  SCHEMA_VERSION,
  UINT256_MAX,
  INT64_MAX,
  ZERO,
  // Errors
  NoticeVaultError,
  InvalidTermsError,
  UnauthorizedActorError,
  NoticeAlreadyStartedError,
  FundingWindowClosedError,
  CheckpointMismatchError,
  AgreementCapExceededError,
  FactoryCapExceededError,
  MalformedStateError,
  ArithmeticError,
} from "./types.js";

// Math helpers
export {
  floorDiv,
  ceilDiv,
  mulDivFloor,
  mulDivCeil,
  clamp,
  bigMax,
  bigMin,
  safeSub,
  safeAddUint256,
  assertNonNegative,
  assertPositiveDivisor,
  assertUint256,
  assertInt64,
} from "./math.js";

// Validation
export { validateTerms, validateTermsForTest } from "./validate.js";

// Core model
export {
  computeR,
  computeD,
  assertConsistentState,
  resolveNotice,
  computeV,
  computeW,
  calculateReferenceSnapshot,
  startNotice,
  materializeNotice,
  claimProvider,
  claimClientRefund,
  fundNextPeriod,
  createInitialState,
} from "./model.js";

export type { ResolvedNotice } from "./model.js";
