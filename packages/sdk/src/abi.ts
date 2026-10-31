/**
 * @noticevault/sdk — ABI exports
 *
 * Re-exports browser-safe generated ABI constants and provenance manifest.
 * Source of truth: packages/sdk/src/generated/ (produced by generate-abi.ts).
 *
 * NO Node.js imports. Safe for browser/Vite bundling.
 *
 * Drift check: run `bun run packages/sdk/scripts/generate-abi.ts` and assert
 * `git diff --exit-code packages/sdk/src/generated/` to detect stale ABIs.
 *
 * ABI counts (from Foundry build cbf3370):
 *   NoticeVaultFactory:  39 entries
 *   NoticeVaultAgreement: 41 entries
 */

export { FACTORY_ABI }    from "./generated/factory-abi.js";
export { AGREEMENT_ABI }  from "./generated/agreement-abi.js";
export { ABI_PROVENANCE } from "./generated/provenance.js";

export type { NoticeVaultFactoryAbi }   from "./generated/factory-abi.js";
export type { NoticeVaultAgreementAbi } from "./generated/agreement-abi.js";
export type { AbiProvenance }           from "./generated/provenance.js";

// ── ABI conformance helpers (runtime, no Node deps) ───────────────────────────

import { FACTORY_ABI }    from "./generated/factory-abi.js";
import { AGREEMENT_ABI }  from "./generated/agreement-abi.js";

const REQUIRED_FACTORY_ENTRIES = [
  "createAgreement","invalidateNonce","isNonceUnavailable","outstandingLiability",
  "factoryCap","agreementCap","allocatedCapacity","perAgreementAllocation","token","registeredAgreement","setCreationPaused",
  "AgreementCreated","NonceInvalidated","CapacityChanged","CreationPauseChanged",
] as const;

const REQUIRED_AGREEMENT_ENTRIES = [
  "fundNextPeriod","startNotice","materializeNotice","claimProvider","claimClientRefund",
  "preview","terms","accounting","factory","client","provider",
  "RegularFunded","NoticeStarted","ProviderClaimed","ClientRefunded",
] as const;

function assertAbiConformance(
  abi: readonly Record<string, unknown>[],
  required: readonly string[],
  label: string,
): void {
  const names = new Set(abi.map((e) => e["name"] as string));
  for (const req of required) {
    if (!names.has(req))
      throw new Error(`ABI conformance failure: ${label} missing entry "${req}"`);
  }
}

// Runs once at module init — throws if generated ABIs are stale or wrong.
assertAbiConformance(
  FACTORY_ABI as unknown as Record<string, unknown>[],
  REQUIRED_FACTORY_ENTRIES,
  "NoticeVaultFactory",
);
assertAbiConformance(
  AGREEMENT_ABI as unknown as Record<string, unknown>[],
  REQUIRED_AGREEMENT_ENTRIES,
  "NoticeVaultAgreement",
);
