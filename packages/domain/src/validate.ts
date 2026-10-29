/**
 * @noticevault/domain — term validation
 *
 * Production bounds from CORE-CONTRACT-M01.md.
 * validateTermsForTest bypasses time and production bounds for model-only test fixtures.
 */

import {
  AgreementTerms,
  InvalidTermsError,
  SCHEMA_VERSION,
  TokenContext,
} from "./types.js";
import { computeR, computeD } from "./model.js";
import { safeAddUint256, assertInt64 } from "./math.js";

// ── Production bounds ─────────────────────────────────────────────────────────

const P_MIN = 3_600n; // 1 hour
const P_MAX = 2_678_400n; // 31 days
const N_MIN = 3_600n; // 1 hour
const N_MAX = 7_776_000n; // 90 days
const T0_LOOKAHEAD_MIN = 300n; // 5 minutes
const T0_LOOKAHEAD_MAX = 604_800n; // 7 days
const VALID_BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const VALID_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function isValidAddress(s: string): boolean {
  return VALID_ADDRESS.test(s);
}

function isNonZeroAddress(s: string): boolean {
  return isValidAddress(s) && BigInt(s) !== 0n;
}

function isValidBytes32(s: string): boolean {
  return VALID_BYTES32.test(s);
}

/**
 * Full production validation.
 * @param terms — terms to validate
 * @param creationNow — bigint Unix seconds at creation time
 * @param tokenCtx — allowlisted tokens
 */
export function validateTerms(
  terms: AgreementTerms,
  creationNow: bigint,
  tokenCtx: TokenContext,
): void {
  if (terms.schemaVersion !== SCHEMA_VERSION)
    throw new InvalidTermsError(`schemaVersion must be ${SCHEMA_VERSION}, got ${terms.schemaVersion}`);

  if (!isNonZeroAddress(terms.client))
    throw new InvalidTermsError(`invalid or zero client address: ${terms.client}`);
  if (!isNonZeroAddress(terms.provider))
    throw new InvalidTermsError(`invalid or zero provider address: ${terms.provider}`);
  if (!isNonZeroAddress(terms.token))
    throw new InvalidTermsError(`invalid or zero token address: ${terms.token}`);

  if (terms.client.toLowerCase() === terms.provider.toLowerCase())
    throw new InvalidTermsError("client and provider must differ");

  const tokenKey = terms.token.toLowerCase();
  if (!tokenCtx.allowlistedTokens.has(tokenKey))
    throw new InvalidTermsError(`token ${terms.token} not in allowlist`);
  if (tokenCtx.decimals !== 6)
    throw new InvalidTermsError(`token decimals must be 6, got ${tokenCtx.decimals}`);

  if (!isValidBytes32(terms.termsDocumentHash))
    throw new InvalidTermsError(`invalid termsDocumentHash: ${terms.termsDocumentHash}`);

  if (terms.amountPerPeriod <= 0n)
    throw new InvalidTermsError(`amountPerPeriod must be > 0, got ${terms.amountPerPeriod}`);

  if (terms.periodSeconds < P_MIN || terms.periodSeconds > P_MAX)
    throw new InvalidTermsError(
      `periodSeconds ${terms.periodSeconds} outside [${P_MIN},${P_MAX}]`,
    );

  if (terms.noticeSeconds < N_MIN || terms.noticeSeconds > N_MAX)
    throw new InvalidTermsError(
      `noticeSeconds ${terms.noticeSeconds} outside [${N_MIN},${N_MAX}]`,
    );

  const t0min = creationNow + T0_LOOKAHEAD_MIN;
  const t0max = creationNow + T0_LOOKAHEAD_MAX;
  if (terms.startAt < t0min || terms.startAt > t0max)
    throw new InvalidTermsError(
      `startAt ${terms.startAt} outside [now+${T0_LOOKAHEAD_MIN}, now+${T0_LOOKAHEAD_MAX}]`,
    );

  // acceptanceDeadline equality = expired; must be > creationNow
  if (terms.acceptanceDeadline <= creationNow)
    throw new InvalidTermsError(
      `acceptanceDeadline ${terms.acceptanceDeadline} <= creationNow ${creationNow}`,
    );

  // t0, acceptanceDeadline, D, D+N must fit int64
  assertInt64(terms.startAt, "startAt");
  assertInt64(terms.acceptanceDeadline, "acceptanceDeadline");

  // Initial F = A; compute initial D and D+N
  const initialF = terms.amountPerPeriod;
  const D = computeD(terms, initialF);
  assertInt64(D, "initial D");
  assertInt64(D + terms.noticeSeconds, "initial D+N");

  // F+R fits uint256
  const R = computeR(terms);
  safeAddUint256(initialF, R, "initial F+R");
}

/**
 * Lightweight validation for model-only test fixtures.
 * Skips time-window checks and token allowlist.
 * Only checks structural invariants: nonzero addresses, A>0, P>0, N>0, valid hash.
 * NEVER weaken production validateTerms.
 */
export function validateTermsForTest(terms: AgreementTerms): void {
  if (!isNonZeroAddress(terms.client))
    throw new InvalidTermsError(`invalid or zero client: ${terms.client}`);
  if (!isNonZeroAddress(terms.provider))
    throw new InvalidTermsError(`invalid or zero provider: ${terms.provider}`);
  if (!isNonZeroAddress(terms.token))
    throw new InvalidTermsError(`invalid or zero token: ${terms.token}`);
  if (terms.client.toLowerCase() === terms.provider.toLowerCase())
    throw new InvalidTermsError("client and provider must differ");
  if (!isValidBytes32(terms.termsDocumentHash))
    throw new InvalidTermsError(`invalid hash: ${terms.termsDocumentHash}`);
  if (terms.amountPerPeriod <= 0n)
    throw new InvalidTermsError("amountPerPeriod must be > 0");
  if (terms.periodSeconds <= 0n)
    throw new InvalidTermsError("periodSeconds must be > 0");
  if (terms.noticeSeconds <= 0n)
    throw new InvalidTermsError("noticeSeconds must be > 0");
}
