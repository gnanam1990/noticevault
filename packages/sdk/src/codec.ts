/**
 * @noticevault/sdk — terms codec
 *
 * serialize: AgreementTerms (bigint) → SerializedTerms (decimal strings)
 * parse:     SerializedTerms → AgreementTerms (bigint), with strict validation
 *
 * Rules:
 * - No floats anywhere — decimal string must contain only digits (+ optional leading 0x for hex)
 * - No negative values
 * - uint256 fields: [0, 2^256-1]
 * - int64 fields (time): [0, INT64_MAX]
 * - schemaVersion: exactly 1
 * - client/provider/token: non-zero 0x40hex addresses; client ≠ provider
 * - termsDocumentHash: 0x64hex (bytes32)
 */

import { assertInt64, assertUint256, INT64_MAX, SCHEMA_VERSION, computeR, safeAddUint256 } from "@noticevault/domain";
import type { AgreementTerms } from "@noticevault/domain";
import type { SerializedTerms, TermsInput } from "./types.js";
import { SdkValidationError } from "./types.js";

// ── Regex ──────────────────────────────────────────────────────────────────────

const RE_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const RE_BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const RE_DECIMAL = /^(0|[1-9][0-9]*)$/; // non-negative integer, no leading zeros

const UINT256_MAX = (1n << 256n) - 1n;

// ── Guards ─────────────────────────────────────────────────────────────────────

function isNonZeroAddress(s: string): boolean {
  return RE_ADDRESS.test(s) && BigInt(s) !== 0n;
}

function parseBigintDecimal(raw: string, field: string): bigint {
  const s = raw.trim();
  if (!RE_DECIMAL.test(s))
    throw new SdkValidationError(
      `${field}: expected non-negative integer string, got "${s}"`,
    );
  return BigInt(s);
}

function assertUint256Sdk(v: bigint, field: string): void {
  if (v < 0n || v > UINT256_MAX)
    throw new SdkValidationError(`${field}: value ${v} out of uint256 range`);
}

function assertInt64Sdk(v: bigint, field: string): void {
  if (v < 0n || v > INT64_MAX)
    throw new SdkValidationError(`${field}: value ${v} out of int64 range [0, ${INT64_MAX}]`);
}

// ── Serialize ──────────────────────────────────────────────────────────────────

/**
 * Losslessly encode AgreementTerms to SerializedTerms (all numbers as decimal strings).
 */
export function serializeTerms(t: TermsInput): SerializedTerms {
  return {
    schemaVersion:       String(t.schemaVersion),
    client:              t.client,
    provider:            t.provider,
    token:               t.token,
    amountPerPeriod:     t.amountPerPeriod.toString(),
    periodSeconds:       t.periodSeconds.toString(),
    noticeSeconds:       t.noticeSeconds.toString(),
    startAt:             t.startAt.toString(),
    clientNonce:         t.clientNonce.toString(),
    acceptanceDeadline:  t.acceptanceDeadline.toString(),
    termsDocumentHash:   t.termsDocumentHash,
  };
}

// ── Parse ──────────────────────────────────────────────────────────────────────

/**
 * Parse and validate SerializedTerms → AgreementTerms.
 * Throws SdkValidationError on any invalid field.
 * Never turns missing/unknown facts into zero.
 */
export function parseTerms(s: SerializedTerms): AgreementTerms {
  // schemaVersion
  const sv = parseBigintDecimal(s.schemaVersion, "schemaVersion");
  if (sv !== BigInt(SCHEMA_VERSION))
    throw new SdkValidationError(`schemaVersion must be ${SCHEMA_VERSION}, got ${sv}`);

  // Addresses
  if (!isNonZeroAddress(s.client))
    throw new SdkValidationError(`client: invalid or zero address "${s.client}"`);
  if (!isNonZeroAddress(s.provider))
    throw new SdkValidationError(`provider: invalid or zero address "${s.provider}"`);
  if (!isNonZeroAddress(s.token))
    throw new SdkValidationError(`token: invalid or zero address "${s.token}"`);
  if (s.client.toLowerCase() === s.provider.toLowerCase())
    throw new SdkValidationError("client and provider must differ");

  // termsDocumentHash
  if (!RE_BYTES32.test(s.termsDocumentHash))
    throw new SdkValidationError(`termsDocumentHash: invalid bytes32 "${s.termsDocumentHash}"`);

  // uint256 fields
  const amountPerPeriod = parseBigintDecimal(s.amountPerPeriod, "amountPerPeriod");
  assertUint256Sdk(amountPerPeriod, "amountPerPeriod");
  if (amountPerPeriod === 0n)
    throw new SdkValidationError("amountPerPeriod must be > 0");

  const clientNonce = parseBigintDecimal(s.clientNonce, "clientNonce");
  assertUint256Sdk(clientNonce, "clientNonce");

  // uint64 / int64-range fields
  const periodSeconds = parseBigintDecimal(s.periodSeconds, "periodSeconds");
  assertInt64Sdk(periodSeconds, "periodSeconds");
  if (periodSeconds === 0n)
    throw new SdkValidationError("periodSeconds must be > 0");

  const noticeSeconds = parseBigintDecimal(s.noticeSeconds, "noticeSeconds");
  assertInt64Sdk(noticeSeconds, "noticeSeconds");
  if (noticeSeconds === 0n)
    throw new SdkValidationError("noticeSeconds must be > 0");

  const startAt = parseBigintDecimal(s.startAt, "startAt");
  assertInt64Sdk(startAt, "startAt");

  const acceptanceDeadline = parseBigintDecimal(s.acceptanceDeadline, "acceptanceDeadline");
  assertInt64Sdk(acceptanceDeadline, "acceptanceDeadline");

  return {
    schemaVersion:      Number(sv) as 1,
    client:             s.client,
    provider:           s.provider,
    token:              s.token,
    amountPerPeriod,
    periodSeconds,
    noticeSeconds,
    startAt,
    clientNonce,
    acceptanceDeadline,
    termsDocumentHash:  s.termsDocumentHash,
  };
}

// ── Production P/N ranges (mirrors contracts/src validation) ──────────────────
// P: [3600, 2_678_400] (1 hour – 31 days)
// N: [3600, 7_776_000] (1 hour – 90 days)
const P_MIN = 3_600n;
const P_MAX = 2_678_400n;
const N_MIN = 3_600n;
const N_MAX = 7_776_000n;

// ── Validate a TermsInput structurally (without time/token context) ────────────

/**
 * Structural validation of all 11 fields — checks runtime types, bigint fields,
 * supported ranges, non-zero addresses, distinct parties.
 * Does NOT check creation-time window or token allowlist (use domain validateTerms).
 *
 * Enforces:
 * - schemaVersion === 1
 * - client/provider/token: non-zero 0x40hex, client ≠ provider
 * - termsDocumentHash: 0x64hex (bytes32) — decimal strings are rejected
 * - amountPerPeriod: bigint, > 0, fits uint256
 * - periodSeconds: bigint, [P_MIN, P_MAX]
 * - noticeSeconds: bigint, [N_MIN, N_MAX]
 * - startAt, acceptanceDeadline: bigint, fits int64
 * - clientNonce: bigint, ≥ 0, fits uint256
 * - No floats, no unsafe Number inputs for bigint fields, no negative values
 */
export function validateTermsInput(t: TermsInput): void {
  // schemaVersion
  if (t.schemaVersion !== SCHEMA_VERSION)
    throw new SdkValidationError(`schemaVersion must be ${SCHEMA_VERSION}, got ${t.schemaVersion}`);

  // Addresses
  if (!isNonZeroAddress(t.client))
    throw new SdkValidationError(`client: invalid or zero address "${t.client}"`);
  if (!isNonZeroAddress(t.provider))
    throw new SdkValidationError(`provider: invalid or zero address "${t.provider}"`);
  if (!isNonZeroAddress(t.token))
    throw new SdkValidationError(`token: invalid or zero address "${t.token}"`);
  if (t.client.toLowerCase() === t.provider.toLowerCase())
    throw new SdkValidationError("client and provider must differ");

  // termsDocumentHash: must be 0x-prefixed 64 hex chars (bytes32).
  // Hex-encoded hashes are the only valid form — decimal strings are rejected.
  if (!RE_BYTES32.test(t.termsDocumentHash))
    throw new SdkValidationError(
      `termsDocumentHash: must be a 0x-prefixed 32-byte hex string (64 hex chars), got "${t.termsDocumentHash}"`,
    );

  // Runtime bigint type guard for all bigint fields
  for (const [field, val] of [
    ["amountPerPeriod", t.amountPerPeriod],
    ["periodSeconds",   t.periodSeconds],
    ["noticeSeconds",   t.noticeSeconds],
    ["startAt",         t.startAt],
    ["clientNonce",     t.clientNonce],
    ["acceptanceDeadline", t.acceptanceDeadline],
  ] as [string, unknown][]) {
    if (typeof val !== "bigint")
      throw new SdkValidationError(`${field}: must be bigint, got ${typeof val}`);
    if ((val as bigint) < 0n)
      throw new SdkValidationError(`${field}: must be >= 0`);
  }

  // amountPerPeriod: uint256, > 0
  try { assertUint256(t.amountPerPeriod, "amountPerPeriod"); }
  catch { throw new SdkValidationError("amountPerPeriod: out of uint256 range"); }
  if (t.amountPerPeriod <= 0n)
    throw new SdkValidationError("amountPerPeriod must be > 0");

  // periodSeconds: [P_MIN, P_MAX]
  if (t.periodSeconds < P_MIN || t.periodSeconds > P_MAX)
    throw new SdkValidationError(
      `periodSeconds ${t.periodSeconds} outside supported range [${P_MIN}, ${P_MAX}]`,
    );

  // noticeSeconds: [N_MIN, N_MAX]
  if (t.noticeSeconds < N_MIN || t.noticeSeconds > N_MAX)
    throw new SdkValidationError(
      `noticeSeconds ${t.noticeSeconds} outside supported range [${N_MIN}, ${N_MAX}]`,
    );

  // int64-range checks for time fields
  try {
    assertInt64(t.startAt,            "startAt");
    assertInt64(t.acceptanceDeadline, "acceptanceDeadline");
  } catch (e) {
    throw new SdkValidationError(`time field out of int64 range: ${e instanceof Error ? e.message : String(e)}`);
  }

  // clientNonce: uint256, >= 0 (already checked above), fits uint256
  try { assertUint256(t.clientNonce, "clientNonce"); }
  catch { throw new SdkValidationError("clientNonce: out of uint256 range"); }

  // F + R overflow: exact check using domain computeR + safeAddUint256.
  // computeR = ceil(A * N / P). safeAddUint256 throws on overflow.
  // Both A and R must fit uint256; A + R (= initial funded + notice reserve) must also fit.
  let R: bigint;
  try {
    R = computeR(t);
  } catch {
    throw new SdkValidationError("amountPerPeriod/periodSeconds/noticeSeconds: R computation failed (overflow)");
  }
  try {
    safeAddUint256(t.amountPerPeriod, R, "A+R");
  } catch {
    throw new SdkValidationError(
      `amountPerPeriod too large: A (${t.amountPerPeriod}) + R (${R}) overflows uint256`,
    );
  }

  // D = t0 + (F/A)*P = startAt + periodSeconds (first-period D). Must fit int64.
  // D+N = startAt + periodSeconds + noticeSeconds. Must also fit int64.
  const D = t.startAt + t.periodSeconds;
  if (D > INT64_MAX)
    throw new SdkValidationError(
      `startAt + periodSeconds = ${D} exceeds int64 max (${INT64_MAX})`,
    );
  const DplusN = D + t.noticeSeconds;
  if (DplusN > INT64_MAX)
    throw new SdkValidationError(
      `startAt + periodSeconds + noticeSeconds = ${DplusN} exceeds int64 max (${INT64_MAX})`,
    );
}
