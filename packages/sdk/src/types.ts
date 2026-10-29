/**
 * @noticevault/sdk — public types
 *
 * Canonical AgreementTerms is re-exported from @noticevault/domain
 * (exact same 11-field interface). SDK adds deployment descriptors,
 * serialized forms, and result types.
 */

export type {
  AgreementTerms,
  AgreementPhase,
  NoticeReason,
} from "@noticevault/domain";

// ── Serialized terms (lossless string-encoded form for JSON/API transport) ────

/**
 * All bigint/number fields encoded as decimal strings.
 * Addresses and hashes remain as 0x-prefixed hex strings.
 * Floats are never valid in any field.
 */
export interface SerializedTerms {
  schemaVersion:       string; // "1"
  client:              string; // 0x address
  provider:            string; // 0x address
  token:               string; // 0x address
  amountPerPeriod:     string; // decimal integer string
  periodSeconds:       string;
  noticeSeconds:       string;
  startAt:             string;
  clientNonce:         string;
  acceptanceDeadline:  string;
  termsDocumentHash:   string; // 0x bytes32
}

/**
 * Input type for SDK functions — same fields as AgreementTerms.
 * Validated before use.
 */
export type TermsInput = {
  schemaVersion:       number;
  client:              string;
  provider:            string;
  token:               string;
  amountPerPeriod:     bigint;
  periodSeconds:       bigint;
  noticeSeconds:       bigint;
  startAt:             bigint;
  clientNonce:         bigint;
  acceptanceDeadline:  bigint;
  termsDocumentHash:   string;
};

// ── Deployment descriptor ─────────────────────────────────────────────────────

/**
 * CONFIG_IDENTITY values — must match M00 preflight identities.
 */
export type ConfigIdentity = "LOCAL_FIXTURE" | "ARC_TESTNET" | "ARC_MAINNET";

/**
 * Immutable deployment descriptor.
 * LOCAL_FIXTURE: factoryAddress=null, isLive=false.
 * ARC_TESTNET/MAINNET: factoryAddress must be set, isLive=true for mainnet.
 *
 * expectedFactoryCodeHash / expectedTokenCodeHash: keccak256 of the deployed
 * runtime bytecode for the factory and token contracts, recorded from a trusted
 * verified deployment. Set to null for LOCAL_FIXTURE (no deployment exists).
 * observeAgreement uses these for exact code-hash verification; a missing hash
 * produces status="deployment_unknown" rather than silently passing.
 *
 * Do NOT invent real contract addresses or code hashes — only use values
 * confirmed by actual deployment and independent verification.
 */
export interface NoticeVaultDeployment {
  readonly configIdentity:           ConfigIdentity;
  readonly chainId:                  bigint;
  readonly factoryAddress:           string | null; // null until deployed
  readonly allowlistedToken:         string | null; // null until configured
  readonly expectedFactoryCodeHash:  `0x${string}` | null; // keccak256 of runtime bytecode; null for LOCAL_FIXTURE
  readonly expectedTokenCodeHash:    `0x${string}` | null; // keccak256 of token runtime bytecode; null for LOCAL_FIXTURE
  readonly isLive:                   boolean;       // true only for mainnet
  readonly label:                    string;        // human-readable display
}

// ── Transaction request ───────────────────────────────────────────────────────

/**
 * A typed transaction request ready for the caller to sign and send.
 * The SDK NEVER signs or sends — it only prepares.
 */
export interface TxRequest {
  readonly to:           string;
  readonly functionName: string;
  readonly abi:          readonly unknown[];
  readonly args:         readonly unknown[];
  readonly chainId:      bigint;
}

// ── Signature verification result ────────────────────────────────────────────

/**
 * Result of verifyProviderSignature.
 * "valid"   — signature binds the exact terms to the provider address.
 * "invalid" — signature is wrong or recovery produces a different address.
 * "unknown" — RPC call for ERC1271 failed; cannot determine validity.
 */
export type VerifyStatus = "valid" | "invalid" | "unknown";

export interface VerifyResult {
  readonly status:  VerifyStatus;
  readonly method:  "ecdsa" | "erc1271" | "unknown";
  readonly detail?: string;
}

// ── Simulation snapshot ───────────────────────────────────────────────────────

/**
 * SIMULATION snapshot — computed from AccountingState + domain model only.
 * source is always "SIMULATION".
 * Has NO onchain evidence (no block number, no RPC data).
 * Must never be confused with an onchain VERIFIED observation.
 */
export interface SimulationSnapshot {
  readonly source:              "SIMULATION";
  readonly observationTimestamp: bigint;
  readonly phase:               import("@noticevault/domain").AgreementPhase;
  readonly R:                   bigint;
  readonly D:                   bigint;
  readonly hasStoredNotice:     boolean;
  readonly S:                   bigint | null;
  readonly E:                   bigint | null;
  readonly reason:              import("@noticevault/domain").NoticeReason | null;
  readonly V:                   bigint;
  readonly W:                   bigint;
  readonly RP:                  bigint;
  readonly NP:                  bigint;
  readonly providerClaimable:   bigint;
  readonly clientRefundable:    bigint;
  readonly L:                   bigint;
  readonly noticeRemaining:     bigint;
}

// ── Verified onchain observation ─────────────────────────────────────────────

/**
 * Evidence source for an observation.
 * VERIFIED: all reads pinned to one block via a real PublicClient.
 * SIMULATION: computed from AccountingState + domain model only — NO onchain evidence.
 * LOCAL_FIXTURE: deterministic test data — never live chain proof.
 */
export type ObservationSource = "VERIFIED" | "SIMULATION" | "LOCAL_FIXTURE";

/** Reorg/block-hash change detected during reads. */
export type VerifierStatus =
  | "ok"
  | "reorg_detected"
  | "rpc_failure"
  | "wrong_chain"
  | "deployment_unknown"
  | "code_hash_mismatch"
  | "unregistered_child"
  | "token_mismatch"
  | "terms_mismatch"
  | "accounting_mismatch";

/**
 * Block-pinned proof context attached to every VERIFIED observation.
 */
export interface BlockProof {
  readonly chainId:      bigint;
  readonly blockNumber:  bigint;
  readonly blockHash:    `0x${string}`;
  readonly blockTimestamp: bigint;
  readonly observedAt:   number; // Date.now() ms
}

/** Nominal type marker. Runtime authenticity uses the private observer registry. */
declare const _observationBrand: unique symbol;

// Read-only authenticity check; issuance is private to observeAgreement.
export { _isIssuedObservation } from "./snapshot.js";

/**
 * VERIFIED onchain observation of one agreement.
 * All reads pinned to one block. Fail-closed: status ≠ "ok" means the
 * observation is incomplete or suspect — never use as authoritative state.
 *
 * source is always "VERIFIED". Must never be produced from simulation or
 * fabricated data. The object must be issued by observeAgreement — only
 * module-issued observations pass _isIssuedObservation().
 */
export interface VerifiedObservation {
  readonly [_observationBrand]?: never; // structural brand (prevents plain object assignability)
  readonly source:             "VERIFIED";
  readonly configIdentity:     import("./types.js").ConfigIdentity;
  readonly status:             VerifierStatus;
  readonly statusDetail?:      string;
  readonly block:              BlockProof;

  // Factory state (undefined if read failed or status ≠ ok)
  readonly factoryNonceUnavailable?: boolean;
  readonly factoryCreationPaused?:   boolean;
  readonly factoryCap?:              bigint;
  readonly agreementCap?:            bigint;
  readonly factoryOutstandingL?:     bigint;

  // Agreement immutable terms (undefined if read failed)
  readonly observedTerms?:     import("@noticevault/domain").AgreementTerms;

  // Accounting state (undefined if read failed)
  readonly regularFunded?:     bigint;
  readonly regularPaid?:       bigint;
  readonly noticePaid?:        bigint;
  readonly clientRefunded?:    bigint;
  readonly noticeReserve?:     bigint;
  readonly hasStoredNotice?:   boolean;
  readonly noticeStartStored?: bigint | null;

  // Preview (from contract, at pinned block)
  readonly contractPreview?:   ContractPreview;

  // Domain model cross-check (independent computation from observedTerms + accounting)
  readonly domainSnapshot?:    SimulationSnapshot;
  readonly domainMatchesContract?: boolean;

  // Token balances/allowances
  readonly tokenBalance?:      bigint; // agreement contract balance
  readonly clientAllowanceToFactory?:   bigint;
  readonly clientAllowanceToAgreement?: bigint;
  /** Pinned balance of the immutable client, present only when client reads were requested. */
  readonly clientTokenBalance?: bigint;
}

/**
 * Raw preview data returned by the contract's preview() call.
 * Matches the Solidity Preview struct.
 */
export interface ContractPreview {
  readonly observationTimestamp: bigint;
  readonly phase:                number; // uint8 enum
  readonly R:                    bigint;
  readonly D:                    bigint;
  readonly hasStoredNotice:      boolean;
  readonly S:                    bigint;
  readonly E:                    bigint;
  readonly reason:               number; // uint8 enum
  readonly V:                    bigint;
  readonly W:                    bigint;
  readonly RP:                   bigint;
  readonly NP:                   bigint;
  readonly providerClaimable:    bigint;
  readonly clientRefundable:     bigint;
  readonly L:                    bigint;
  readonly noticeRemaining:      bigint;
}

// ── Factory-only observation (for creation / nonce invalidation) ──────────────

/**
 * Discriminated observation produced by observeFactoryForCreation.
 * Distinct from VerifiedObservation — cannot be used in place of child evidence.
 * kind: "FACTORY_OBSERVATION" field distinguishes it structurally.
 */
export interface FactoryObservation {
  readonly kind:            "FACTORY_OBSERVATION";  // discriminant: never creatable from VerifiedObservation
  readonly source:          "VERIFIED";
  readonly configIdentity:  ConfigIdentity;
  readonly status:          VerifierStatus;
  readonly statusDetail?:   string;
  readonly block:           BlockProof;

  // Factory state (defined when status=ok)
  readonly factoryCap?:             bigint;
  readonly agreementCap?:           bigint;
  readonly factoryOutstandingL?:    bigint;
  readonly factoryCreationPaused?:  boolean;
  readonly nonceUnavailable?:       boolean;

  // Client state at pinned block (defined when status=ok)
  readonly clientBalance?:              bigint;
  readonly clientAllowanceToFactory?:   bigint;

  // Provider code check (defined when status=ok)
  readonly providerHasCode?:       boolean;

  // Binding: the exact terms and client+nonce this observation was issued for
  readonly requestedTerms?:        import("@noticevault/domain").AgreementTerms;
  readonly checkedNonce?:          bigint;
  readonly checkedClientAddr?:     string;
}

// ── SDK error classes ─────────────────────────────────────────────────────────

export class SdkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SdkError";
  }
}

/** Input validation failure — bad field values, types, or ranges. */
export class SdkValidationError extends SdkError {
  constructor(message: string) {
    super(message);
    this.name = "SdkValidationError";
  }
}

/** Onchain state inconsistency or precondition failure. */
export class SdkStateError extends SdkError {
  constructor(message: string) {
    super(message);
    this.name = "SdkStateError";
  }
}

/** Wrong chain, unknown deployment, or chainId mismatch. */
export class SdkChainError extends SdkError {
  constructor(message: string) {
    super(message);
    this.name = "SdkChainError";
  }
}

/** Current adapter-supplied wallet snapshot. No signing or connection is performed. */
export interface WalletContext {
  readonly account: string;
  readonly chainId: bigint;
}
