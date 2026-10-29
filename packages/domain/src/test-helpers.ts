/**
 * Shared test helpers for @noticevault/domain tests.
 * All fixtures use model-test-safe values (no production time window validation).
 * Production validateTerms is NOT called here; use validateTermsForTest if structural checks needed.
 *
 * [TEST DATA] — these addresses and amounts are synthetic model fixtures.
 */

import { AgreementTerms, AgreementCaps, FactoryCaps, UINT256_MAX } from "./types.js";

export const DAY = 86_400n;
export const HOUR = 3_600n;

// [TEST DATA] — synthetic model-test-only addresses
export const ADDR_CLIENT = "0x1111111111111111111111111111111111111111";
export const ADDR_PROVIDER = "0x2222222222222222222222222222222222222222";
export const ADDR_TOKEN = "0x3600000000000000000000000000000000000000"; // Arc Testnet USDC (placeholder for tests)
export const HASH_ZERO32 = "0x" + "00".repeat(32);
export const HASH_TEST = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

export type PartialTerms = Partial<Omit<AgreementTerms, "schemaVersion">> & {
  amountPerPeriod: bigint;
  periodSeconds: bigint;
  noticeSeconds: bigint;
  startAt: bigint;
};

export function makeTerms(override: PartialTerms): AgreementTerms {
  return {
    schemaVersion: 1,
    client: ADDR_CLIENT,
    provider: ADDR_PROVIDER,
    token: ADDR_TOKEN,
    clientNonce: 0n,
    acceptanceDeadline: 9_999_999_999n,
    termsDocumentHash: HASH_TEST,
    ...override,
  };
}

/** No-op caps: max everything */
export const noCaps: AgreementCaps = {
  maxLiabilityPerAgreement: UINT256_MAX,
};

export function noFCaps(): FactoryCaps {
  return { maxTotalLiability: UINT256_MAX, currentFactoryLiability: 0n };
}
