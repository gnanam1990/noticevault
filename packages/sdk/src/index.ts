/**
 * @noticevault/sdk — public API
 *
 * Canonical AgreementTerms and all M01 financial arithmetic are
 * re-exported from @noticevault/domain. The SDK adds:
 *   - ABI loading (from Foundry artifacts, browser-safe generated modules)
 *   - Terms validation, serialization, and parsing
 *   - EIP-712 typed-data preparation and provider consent issuance
 *   - Onchain verifier (block-pinned, fail-closed, injected PublicClient)
 *   - Transaction request preparation (mandatory verified evidence)
 *   - Deployment descriptors (LOCAL_FIXTURE, ARC_TESTNET, ARC_MAINNET)
 *
 * ConsentEvidence is opaque: only issueProviderConsent produces it.
 * VerifiedObservation is opaque: only observeAgreement produces it.
 * FactoryObservation is opaque: only observeFactoryForCreation produces it.
 * None of these can be fabricated by callers — brand WeakSets are private.
 *
 * LOCAL_FIXTURE: deterministic test data, never live chain proof.
 *   expectedFactoryCodeHash / expectedTokenCodeHash = null.
 *   Production prep guards always reject LOCAL_FIXTURE evidence.
 */

// ── Domain re-exports ─────────────────────────────────────────────────────────
export type {
  AgreementTerms,
  AgreementPhase,
  NoticeReason,
  AccountingState,
  AgreementSnapshot,
} from "@noticevault/domain";

// ── ABI ───────────────────────────────────────────────────────────────────────
export { FACTORY_ABI }   from "./generated/factory-abi.js";
export { AGREEMENT_ABI } from "./generated/agreement-abi.js";
export { ABI_PROVENANCE } from "./generated/provenance.js";

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  TermsInput,
  WalletContext,
  SerializedTerms,
  NoticeVaultDeployment,
  ConfigIdentity,
  TxRequest,
  VerifyStatus,
  VerifyResult,
  SimulationSnapshot,
  VerifiedObservation,
  FactoryObservation,
  BlockProof,
  ContractPreview,
  VerifierStatus,
  ObservationSource,
} from "./types.js";
export {
  SdkError,
  SdkValidationError,
  SdkStateError,
  SdkChainError,
} from "./types.js";

// ── Deployments ───────────────────────────────────────────────────────────────
export {
  LOCAL_FIXTURE_DEPLOYMENT,
  ARC_TESTNET_DEPLOYMENT, ARC_MAINNET_DEPLOYMENT, arcDeployment, assertRegisteredArcDeploymentPins,
  requireFactoryAddress,
} from "./deployments.js";

// ── Codec (terms validation + serialization) ──────────────────────────────────
export {
  validateTermsInput,
  serializeTerms,
  parseTerms,
} from "./codec.js";

// ── EIP-712 ───────────────────────────────────────────────────────────────────
export {
  AGREEMENT_TERMS_TYPES,
  buildTypedData,
  computeTermsDigest,
  verifyProviderSignature,
  issueProviderConsent,
} from "./eip712.js";
export type { ConsentEvidence, EIP712PublicClient } from "./eip712.js";

// ── Snapshot / verifier ───────────────────────────────────────────────────────
export {
  buildSimulationSnapshot,
  observeAgreement,
  observeFactoryForCreation,
} from "./snapshot.js";
export type { MinimalPublicClient } from "./snapshot.js";

// ── Transaction preparation ───────────────────────────────────────────────────
export {
  // Unsafe raw encoders (encoding only — no guards)
  unsafeEncodeApprove,
  unsafeEncodeCreateAgreement,
  // Public guarded preparation API
  prepareApproveForCreation,
  prepareApproveForRenewal,
  prepareCreateAgreement,
  prepareInvalidateNonce,
  prepareFundNextPeriod,
  prepareStartNotice,
  prepareMaterializeNotice,
  prepareClaimProvider,
  prepareClaimClientRefund,
} from "./txprep.js";

// Draft-bound unsigned preparation; persistence authorization belongs to the loader.
export {draftCreationBinding,prepareBoundDraftCreation} from './draft-consent.js';
export type {DraftConsentSnapshot,DraftPreparationDependencies} from './draft-consent.js';

export {parseArcTestnetManifest,parseArcManifest} from './manifest.js';

export {canonicalAttemptResource,isStructuredAttemptResource} from './attempt-identity.js';
