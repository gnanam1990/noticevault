import { requireCreationCapacity, requireRenewalCapacity } from "./capacity.js";
/**
 * @noticevault/sdk — transaction request preparation
 *
 * Architecture:
 *   unsafeEncode* (exported, clearly named) — raw ABI encoding only, no guards.
 *     Use only when you have already validated state externally or in tests.
 *   prepare* (exported) — require fresh VERIFIED module-issued evidence,
 *     validated connected account, and exact deployment target.
 *     Every public prepare* function MUST have mandatory evidence + account.
 *     No optional bypass paths.
 *
 * Nothing here signs or sends. All functions return TxRequest objects.
 *
 * Spender rules (enforced here and in tests):
 *   Creation allowance: spender = FACTORY,    amount = A + R
 *   Renewal allowance:  spender = AGREEMENT,  amount = A only
 *
 * Claims (claimProvider, claimClientRefund) have NO destination argument.
 * The contract pays immutable beneficiaries derived from agreement state.
 *
 * Actor rules:
 *   - createAgreement, fundNextPeriod, startNotice, approveFor*: client only.
 *   - materializeNotice, claimProvider, claimClientRefund: permissionless,
 *     but still require fresh verified evidence and known deployment.
 *   - startNotice client is derived from evidence.observedTerms.client,
 *     never from a caller-supplied address argument.
 *   - invalidateNonce: client only, exact uint256 nonce.
 *
 * Evidence requirement:
 *   All prepare* functions require module-issued evidence that:
 *     1. Was issued by observeAgreement or observeFactoryForCreation.
 *     2. Has status = "ok".
 *     3. Has matching chainId to the deployment.
 *     4. Has matching configIdentity to the deployment.
 *     5. Was observed within MAX_EVIDENCE_AGE_MS.
 *     6. Has a block timestamp not older than MAX_BLOCK_AGE_S seconds before observedAt.
 *     7. If an agreementAddress is given: target binding matches exactly.
 *   Fabricated plain objects, LOCAL_FIXTURE/SIMULATION sources, and
 *   stale/future/wrong-chain evidence are all blocked.
 *
 * Consent evidence:
 *   prepareCreateAgreement requires a module-issued ConsentEvidence produced by
 *   issueProviderConsent (in eip712.ts). A plain VerifyResult object cannot
 *   substitute — this prevents a {status:'valid'} bypass.
 */

import { computeR, safeAddUint256 } from "@noticevault/domain";
import { FACTORY_ABI, AGREEMENT_ABI } from "./abi.js";
import { requireFactoryAddress } from "./deployments.js";
import type {
  TxRequest,
  TermsInput,
  WalletContext,
  NoticeVaultDeployment,
  VerifiedObservation,
  FactoryObservation,
} from "./types.js";
import {
  SdkValidationError, SdkStateError, SdkChainError,
  _isIssuedObservation,
} from "./types.js";
import { validateTermsInput } from "./codec.js";
import { _getTargetBinding } from "./snapshot.js";
import { requireFreshFactoryEvidence } from "./factory-evidence.js";
import type { ConsentEvidence } from "./eip712.js";
import { computeTermsDigest, _isIssuedConsent, _consentMatchesFactoryEvidence } from "./eip712.js";

// ── Constants ─────────────────────────────────────────────────────────────────
const UINT256_MAX = (1n << 256n) - 1n;

/** Maximum age for evidence to be used in action prep (60 seconds). */
const MAX_EVIDENCE_AGE_MS = 60_000;

/**
 * Maximum age of the pinned block's timestamp relative to observedAt.
 * A block observed at T but with blockTimestamp T-7200 is too stale.
 * 7200 seconds (2 hours) allows for slow chains without permitting year-2000 blocks.
 */
const MAX_BLOCK_AGE_S = 7_200n;

// ── ERC20 approve ABI (minimal) ───────────────────────────────────────────────

const ERC20_APPROVE_ABI = [
  {
    type: "function", name: "approve",
    inputs:  [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

// ── Address guard ─────────────────────────────────────────────────────────────

const RE_NONZERO_ADDR = /^0x[0-9a-fA-F]{40}$/;

function requireAddress(addr: string, label: string): `0x${string}` {
  if (!RE_NONZERO_ADDR.test(addr) || BigInt(addr) === 0n)
    throw new SdkValidationError(`${label}: invalid or zero address "${addr}"`);
  return addr as `0x${string}`;
}

// ── Evidence freshness guard ──────────────────────────────────────────────────

/**
 * Assert that a VerifiedObservation is:
 *   1. Module-issued (from observeAgreement, not fabricated).
 *   2. VERIFIED source (not SIMULATION or LOCAL_FIXTURE).
 *   3. status = "ok".
 *   4. chainId + configIdentity matches deployment.
 *   5. Fresh: observedAt within MAX_EVIDENCE_AGE_MS; not in the future.
 *   6. Block timestamp not older than MAX_BLOCK_AGE_S before observedAt.
 *      Rejects future block timestamps (> now + 30s grace) and
 *      ancient block timestamps (blockTimestamp < observedAt/1000 - MAX_BLOCK_AGE_S).
 *   7. If agreementAddress given: target binding matches exactly (no target swap).
 */
function requireFreshVerifiedEvidence(
  evidence: VerifiedObservation,
  dep: NoticeVaultDeployment,
  label: string,
  agreementAddress?: string,
): void {
  // Brand check: must be module-issued
  if (!_isIssuedObservation(evidence))
    throw new SdkStateError(
      `${label}: evidence was not issued by observeAgreement — fabricated or copied objects are not accepted`,
    );
  if (evidence.source !== "VERIFIED")
    throw new SdkStateError(`${label}: evidence source must be VERIFIED, got "${evidence.source}"`);
  if (evidence.status !== "ok")
    throw new SdkStateError(`${label}: evidence status is "${evidence.status}" (not ok): ${evidence.statusDetail ?? ""}`);
  if (evidence.block.chainId !== dep.chainId)
    throw new SdkChainError(`${label}: evidence chainId ${evidence.block.chainId} ≠ deployment chainId ${dep.chainId}`);
  if (evidence.configIdentity !== dep.configIdentity)
    throw new SdkChainError(`${label}: evidence configIdentity "${evidence.configIdentity}" ≠ deployment "${dep.configIdentity}"`);

  // Freshness: observedAt must not be in the future; must not be stale
  const nowMs = Date.now();
  if (evidence.block.observedAt > nowMs + 5_000)
    throw new SdkStateError(`${label}: evidence observedAt is in the future`);
  const ageMs = nowMs - evidence.block.observedAt;
  if (ageMs > MAX_EVIDENCE_AGE_MS)
    throw new SdkStateError(`${label}: evidence is stale (${ageMs}ms old, max ${MAX_EVIDENCE_AGE_MS}ms)`);

  // Block timestamp staleness: reject future block and ancient block
  const nowSeconds = BigInt(Math.floor(nowMs / 1000));
  if (evidence.block.blockTimestamp > nowSeconds + 30n)
    throw new SdkStateError(`${label}: evidence block timestamp is in the future`);
  if (evidence.block.blockTimestamp < nowSeconds - MAX_BLOCK_AGE_S)
    throw new SdkStateError(
      `${label}: evidence block timestamp is too old (block=${evidence.block.blockTimestamp}, now=${nowSeconds}, maxAge=${MAX_BLOCK_AGE_S}s)`,
    );

  // Target binding check: if agreementAddress given, evidence must be for that exact target
  if (agreementAddress) {
    const binding = _getTargetBinding(evidence);
    if (!binding)
      throw new SdkStateError(`${label}: evidence has no target binding (was not issued for a specific agreement)`);
    const policyKeys = ["configIdentity", "chainId", "factoryAddress", "allowlistedToken", "expectedFactoryCodeHash", "expectedTokenCodeHash", "isLive", "label"] as const;
    if (!binding.policy || policyKeys.some(key => binding.policy![key] !== dep[key]))
      throw new SdkStateError(`${label}: agreement evidence deployment policy mismatch`);
    if (binding.agreementAddress !== agreementAddress.toLowerCase())
      throw new SdkStateError(
        `${label}: evidence was issued for agreement ${binding.agreementAddress} ≠ requested ${agreementAddress.toLowerCase()}`,
      );
    if (binding.factoryAddress !== dep.factoryAddress?.toLowerCase())
      throw new SdkStateError(`${label}: evidence factory address mismatch in target binding`);
    if (binding.tokenAddress !== dep.allowlistedToken?.toLowerCase())
      throw new SdkStateError(`${label}: evidence token address mismatch in target binding`);
    if (binding.configIdentity !== dep.configIdentity)
      throw new SdkStateError(`${label}: evidence config identity mismatch in target binding`);
  }
}

/**
 * Assert connected account matches required actor address.
 */
// Wallet context is required even for permissionless methods. The caller's wallet
// adapter must obtain it immediately before preparation and recheck before signing.
function requireWalletContext(wallet: WalletContext, dep: NoticeVaultDeployment, label: string, actor?: string): void {
  if (!wallet || typeof wallet.account !== "string" || !RE_NONZERO_ADDR.test(wallet.account) || BigInt(wallet.account) === 0n)
    throw new SdkValidationError(label + ": wallet account is missing or invalid");
  if (typeof wallet.chainId !== "bigint" || wallet.chainId <= 0n || wallet.chainId !== dep.chainId)
    throw new SdkChainError(label + ": wallet chain does not match deployment");
  if (actor !== undefined && (typeof actor !== "string" || wallet.account.toLowerCase() !== actor.toLowerCase()))
    throw new SdkValidationError(label + ": wallet account differs from requested actor");
}

// Legacy now arguments remain in the API for migration, but never authorize an
// operation. Tests inject the platform clock. Never move behind verified chain time.
function preparationTime(evidence: FactoryObservation | VerifiedObservation): bigint {
  const ms = Date.now();
  if (!Number.isSafeInteger(ms) || ms < 0) throw new SdkStateError("Invalid preparation clock");
  const now = BigInt(Math.floor(ms / 1000));
  return now > evidence.block.blockTimestamp ? now : evidence.block.blockTimestamp;
}

function requireActor(
  connectedAccount: string,
  requiredActor: string,
  label: string,
): void {
  if (connectedAccount.toLowerCase() !== requiredActor.toLowerCase())
    throw new SdkValidationError(
      `${label}: connected account ${connectedAccount} is not the required actor ${requiredActor}`,
    );
}

// ── Unsafe raw encoders (no evidence guards) ──────────────────────────────────
// These functions perform ABI encoding only. No state validation, no actor checks.
// Use them when you have externally validated evidence, or in unit tests for the
// encoding logic itself. Never use them in production flows — use prepare* instead.

export function unsafeEncodeApprove(
  tokenAddress: string,
  spender: string,
  amount: bigint,
  chainId: bigint,
): TxRequest {
  return {
    to:           requireAddress(tokenAddress, "token"),
    functionName: "approve",
    abi:          ERC20_APPROVE_ABI,
    args:         [requireAddress(spender, "spender"), amount],
    chainId,
  };
}

export function unsafeEncodeCreateAgreement(
  terms: TermsInput,
  providerSig: `0x${string}`,
  factoryAddress: string,
  chainId: bigint,
): TxRequest {
  const termsStruct = {
    schemaVersion:      terms.schemaVersion,
    client:             requireAddress(terms.client,   "client"),
    provider:           requireAddress(terms.provider, "provider"),
    token:              requireAddress(terms.token,    "token"),
    amountPerPeriod:    terms.amountPerPeriod,
    periodSeconds:      terms.periodSeconds,
    noticeSeconds:      terms.noticeSeconds,
    startAt:            terms.startAt,
    clientNonce:        terms.clientNonce,
    acceptanceDeadline: terms.acceptanceDeadline,
    termsDocumentHash:  terms.termsDocumentHash as `0x${string}`,
  };
  return {
    to:           requireAddress(factoryAddress, "factory"),
    functionName: "createAgreement",
    abi:          FACTORY_ABI,
    args:         [termsStruct, providerSig],
    chainId,
  };
}

// ── Public prepare API — all require fresh verified evidence ──────────────────

/**
 * Prepare ERC20 approve for agreement CREATION.
 * Spender = factory; amount = A + R.
 *
 * Requires fresh FactoryObservation (NOT VerifiedObservation of an existing child).
 * Creation happens before the child exists — child evidence cannot substitute.
 *
 * All business checks are mandatory — no if-defined skips:
 *   - connectedAccount === factoryEvidence.checkedClientAddr (immutable client binding)
 *   - now < acceptanceDeadline
 *   - factory not paused
 *   - nonce available
 *   - factory cap sufficient (factoryCap - factoryOutstandingL >= A+R)
 *   - agreement cap sufficient (agreementCap >= A+R)
 *   - client balance >= A+R (client's own funding, NOT child balance)
 *
 * Approve may allow existing allowance < A+R (that is the purpose of approval).
 * Creation funding prep (prepareCreateAgreement) requires sufficient allowance.
 */
export function prepareApproveForCreation(
  dep: NoticeVaultDeployment,
  evidence: FactoryObservation,
  connectedAccount: string,
  _legacyNowSeconds: bigint,
  wallet: WalletContext,
): TxRequest {
  requireWalletContext(wallet, dep, "prepareApproveForCreation", connectedAccount);

  dep = Object.freeze({ ...dep });
  requireFreshFactoryEvidence(evidence, dep, "prepareApproveForCreation");
  const nowSeconds = preparationTime(evidence);
  const factory = requireFactoryAddress(dep);

  // Derive client from evidence binding — not from caller input
  const clientAddr = evidence.checkedClientAddr;
  if (!clientAddr)
    throw new SdkStateError("prepareApproveForCreation: factoryEvidence missing checkedClientAddr");
  requireActor(connectedAccount, clientAddr, "prepareApproveForCreation");

  // Derive terms from evidence
  const terms = evidence.requestedTerms;
  if (!terms)
    throw new SdkStateError("prepareApproveForCreation: factoryEvidence missing requestedTerms");

  // Token must be the deployment allowlisted token
  if (!dep.allowlistedToken || terms.token.toLowerCase() !== dep.allowlistedToken.toLowerCase())
    throw new SdkValidationError(`prepareApproveForCreation: terms.token ${terms.token} is not the allowlisted deployment token`);

  if (nowSeconds >= terms.acceptanceDeadline)
    throw new SdkStateError(
      `prepareApproveForCreation: acceptance deadline ${terms.acceptanceDeadline} has expired (now=${nowSeconds})`,
    );

  // Factory state — all required (factory evidence must have them if status=ok)
  if (evidence.factoryCreationPaused === undefined)
    throw new SdkStateError("prepareApproveForCreation: factoryCreationPaused missing from evidence");
  if (evidence.factoryCreationPaused)
    throw new SdkStateError("prepareApproveForCreation: factory creation is paused");

  if (evidence.nonceUnavailable === undefined)
    throw new SdkStateError("prepareApproveForCreation: nonceUnavailable missing from evidence");
  if (evidence.nonceUnavailable)
    throw new SdkStateError("prepareApproveForCreation: nonce already consumed or invalidated");

  // Cap checks — required fields (status=ok means they were set)
  if (evidence.factoryCap === undefined || evidence.factoryOutstandingL === undefined)
    throw new SdkStateError("prepareApproveForCreation: factory cap/outstanding missing from evidence");
  if (evidence.agreementCap === undefined)
    throw new SdkStateError("prepareApproveForCreation: agreementCap missing from evidence");

  const R = computeR(terms);
  const needed = safeAddUint256(terms.amountPerPeriod, R, "A+R");

  if (evidence.factoryOutstandingL + needed > evidence.factoryCap)
    throw new SdkStateError(
      `prepareApproveForCreation: factory cap exceeded (outstanding ${evidence.factoryOutstandingL} + ${needed} > cap ${evidence.factoryCap})`,
    );
  if (needed > evidence.agreementCap)
    throw new SdkStateError(`prepareApproveForCreation: A+R=${needed} exceeds agreementCap=${evidence.agreementCap}`);

  requireCreationCapacity(dep, evidence, terms.amountPerPeriod, needed);

  // Client balance check — required (client's OWN balance, never child balance)
  if (evidence.clientBalance === undefined)
    throw new SdkStateError("prepareApproveForCreation: clientBalance missing from evidence");
  if (evidence.clientBalance < needed)
    throw new SdkStateError(
      `prepareApproveForCreation: client balance ${evidence.clientBalance} < required ${needed} (A+R)`,
    );

  // Approve: allowance check is intentionally OMITTED — approval is what sets the allowance.
  return unsafeEncodeApprove(terms.token, factory, needed, dep.chainId);
}

/**
 * Prepare ERC20 approve for period RENEWAL.
 * Spender = agreement (NOT factory); amount = A only.
 *
 * Derives ALL immutable actor/token/A from evidence — never from caller input.
 * Rejects mismatches between caller-supplied agreementAddress and evidence target binding.
 *
 * Requires:
 *   - fresh VERIFIED VerifiedObservation bound to agreementAddress
 *   - connectedAccount === evidence.observedTerms.client
 *   - no stored notice (evidence.hasStoredNotice must be false)
 *   - now < current D (from evidence.domainSnapshot.D)
 *   - expectedD exact (validated in prepareFundNextPeriod — approve just checks pre-D)
 */
export function prepareApproveForRenewal(
  agreementAddress: string,
  dep: NoticeVaultDeployment,
  evidence: VerifiedObservation,
  connectedAccount: string,
  _legacyNowSeconds: bigint,
  wallet: WalletContext,
): TxRequest {
  requireWalletContext(wallet, dep, "prepareApproveForRenewal", connectedAccount);

  requireAddress(agreementAddress, "agreementAddress");
  // Target binding required: evidence must be for this exact agreement
  requireFreshVerifiedEvidence(evidence, dep, "prepareApproveForRenewal", agreementAddress);
  const nowSeconds = preparationTime(evidence);

  // Derive client and token from immutable observed terms — never from caller
  const observedTerms = evidence.observedTerms;
  if (!observedTerms)
    throw new SdkStateError("prepareApproveForRenewal: evidence missing observedTerms");
  const clientAddr = observedTerms.client;
  const tokenAddr  = observedTerms.token;
  const A          = observedTerms.amountPerPeriod;

  // Verify token matches deployment (cross-check, already validated by verifier)
  if (!dep.allowlistedToken || tokenAddr.toLowerCase() !== dep.allowlistedToken.toLowerCase())
    throw new SdkValidationError(`prepareApproveForRenewal: observed token ${tokenAddr} ≠ deployment token ${dep.allowlistedToken}`);

  requireActor(connectedAccount, clientAddr, "prepareApproveForRenewal");

  // Renewal transfers A only. Child funds and factory allowance cannot substitute.
  const renewalAmount = evidence.observedTerms!.amountPerPeriod;
  if (evidence.clientTokenBalance === undefined || evidence.clientTokenBalance < renewalAmount)
    throw new SdkStateError("prepareApproveForRenewal: observed client balance missing or below renewal amount");
  // No allowance gate here: this standalone approval establishes that allowance.


  if (evidence.hasStoredNotice === undefined)
    throw new SdkStateError("prepareApproveForRenewal: hasStoredNotice missing from evidence");
  if (evidence.hasStoredNotice)
    throw new SdkStateError("prepareApproveForRenewal: notice already started — renewal not possible");

  if (!evidence.domainSnapshot)
    throw new SdkStateError("prepareApproveForRenewal: domainSnapshot missing from evidence");
  if (nowSeconds >= evidence.domainSnapshot.D)
    throw new SdkStateError(
      `prepareApproveForRenewal: funding window closed (now=${nowSeconds} >= D=${evidence.domainSnapshot.D})`,
    );

  requireRenewalCapacity(dep, evidence);

  // Approve: spender = agreement, amount = A only (renewal)
  return unsafeEncodeApprove(tokenAddr, agreementAddress, A, dep.chainId);
}

/**
 * Prepare createAgreement.
 *
 * Requires:
 *   - fresh FactoryObservation (not VerifiedObservation — child doesn't exist yet)
 *   - module-issued ConsentEvidence from issueProviderConsent (not a VerifyResult)
 *   - consent.termsDigest matches terms digest computed from (terms, dep)
 *   - consent bound to same configIdentity + chainId + block as factoryEvidence
 *   - connectedAccount === terms.client
 *   - startAt in [now+300, now+604800]
 *   - now < acceptanceDeadline
 *   - factory not paused, nonce available
 *   - A+R within factory cap and agreementCap
 *   - six-decimal allowlisted token
 *   - client balance >= A+R (client's own balance from evidence)
 *   - client allowance to factory >= A+R
 *
 * This function does NOT accept VerifyResult — that prevents a {status:'valid'} bypass.
 * Calling prepareCreateAgreement with a fabricated ConsentEvidence fails
 * _isIssuedConsent() since the brand WeakSet is private to eip712.ts.
 */
export async function prepareCreateAgreement(
  terms: TermsInput,
  providerSig: `0x${string}`,
  consent: ConsentEvidence,
  dep: NoticeVaultDeployment,
  factoryEvidence: FactoryObservation,
  connectedAccount: string,
  _legacyNowSeconds: bigint,
  wallet: WalletContext,
): Promise<TxRequest> {
  requireWalletContext(wallet, dep, "prepareCreateAgreement", connectedAccount);
  terms = Object.freeze({ ...terms });

  dep = Object.freeze({ ...dep });
  validateTermsInput(terms);
  const factory = requireFactoryAddress(dep);

  // Evidence freshness + brand checks
  requireFreshFactoryEvidence(factoryEvidence, dep, "prepareCreateAgreement");
  const nowSeconds = preparationTime(factoryEvidence);

  // Consent evidence brand check — prevents fabricated {status:'valid'} bypass
  if (!_isIssuedConsent(consent))
    throw new SdkStateError(
      "prepareCreateAgreement: consent was not issued by issueProviderConsent — a plain VerifyResult cannot substitute",
    );

  if (!_consentMatchesFactoryEvidence(consent, factoryEvidence, dep))
    throw new SdkStateError("prepareCreateAgreement: consent factory evidence binding mismatch");

  // Consent must be bound to the same deployment and block
  if (consent.configIdentity !== dep.configIdentity)
    throw new SdkStateError("prepareCreateAgreement: consent configIdentity mismatch");
  if (consent.chainId !== dep.chainId)
    throw new SdkChainError("prepareCreateAgreement: consent chainId mismatch");
  if (consent.pinnedBlock !== factoryEvidence.block.blockNumber)
    throw new SdkStateError(
      `prepareCreateAgreement: consent pinnedBlock ${consent.pinnedBlock} ≠ factoryEvidence block ${factoryEvidence.block.blockNumber}`,
    );

  // Consent terms digest must match the submitted terms (prevents consent reuse for different terms)
  const expectedDigest = computeTermsDigest(terms, dep);
  if (consent.termsDigest.toLowerCase() !== expectedDigest.toLowerCase())
    throw new SdkStateError(
      `prepareCreateAgreement: consent termsDigest ${consent.termsDigest} ≠ expected ${expectedDigest} — consent was issued for different terms`,
    );

  // Provider in consent must match terms.provider
  if (consent.provider.toLowerCase() !== terms.provider.toLowerCase())
    throw new SdkStateError(
      `prepareCreateAgreement: consent.provider ${consent.provider} ≠ terms.provider ${terms.provider}`,
    );

  // Sig in consent must match the submitted sig (consent is bound to exact sig bytes)
  if (consent.signature.toLowerCase() !== providerSig.toLowerCase())
    throw new SdkStateError("prepareCreateAgreement: providerSig does not match the sig in consent evidence");

  // Client check
  requireActor(connectedAccount, terms.client, "prepareCreateAgreement");

  // Evidence client binding
  if (factoryEvidence.checkedClientAddr?.toLowerCase() !== terms.client.toLowerCase())
    throw new SdkStateError("prepareCreateAgreement: factoryEvidence was issued for a different client");
  if (factoryEvidence.checkedNonce !== terms.clientNonce)
    throw new SdkStateError(`prepareCreateAgreement: factoryEvidence nonce ${factoryEvidence.checkedNonce} ≠ terms.clientNonce ${terms.clientNonce}`);

  // Token allowlist
  if (!dep.allowlistedToken || terms.token.toLowerCase() !== dep.allowlistedToken.toLowerCase())
    throw new SdkValidationError(`prepareCreateAgreement: token ${terms.token} is not the allowlisted deployment token`);

  // Deadline
  if (nowSeconds >= terms.acceptanceDeadline)
    throw new SdkStateError(
      `prepareCreateAgreement: acceptance deadline ${terms.acceptanceDeadline} expired (now=${nowSeconds})`,
    );

  // StartAt window: [now+300, now+604800]
  if (terms.startAt < nowSeconds + 300n || terms.startAt > nowSeconds + 604800n)
    throw new SdkStateError(
      `prepareCreateAgreement: startAt=${terms.startAt} out of creation window [now+300, now+604800]`,
    );

  // Factory state — all required
  if (factoryEvidence.factoryCreationPaused === undefined)
    throw new SdkStateError("prepareCreateAgreement: factoryCreationPaused missing from evidence");
  if (factoryEvidence.factoryCreationPaused)
    throw new SdkStateError("prepareCreateAgreement: factory creation is paused");
  if (factoryEvidence.nonceUnavailable === undefined)
    throw new SdkStateError("prepareCreateAgreement: nonceUnavailable missing from evidence");
  if (factoryEvidence.nonceUnavailable)
    throw new SdkStateError("prepareCreateAgreement: nonce already consumed or invalidated");

  // Cap checks — required
  if (factoryEvidence.factoryCap === undefined || factoryEvidence.factoryOutstandingL === undefined)
    throw new SdkStateError("prepareCreateAgreement: factory cap/outstanding missing from evidence");
  if (factoryEvidence.agreementCap === undefined)
    throw new SdkStateError("prepareCreateAgreement: agreementCap missing from evidence");

  const R = computeR(terms);
  const needed = safeAddUint256(terms.amountPerPeriod, R, "A+R");

  if (factoryEvidence.factoryOutstandingL + needed > factoryEvidence.factoryCap)
    throw new SdkStateError(
      `prepareCreateAgreement: factory cap exceeded (outstanding ${factoryEvidence.factoryOutstandingL} + ${needed} > cap ${factoryEvidence.factoryCap})`,
    );
  if (needed > factoryEvidence.agreementCap)
    throw new SdkStateError(`prepareCreateAgreement: A+R=${needed} exceeds agreementCap=${factoryEvidence.agreementCap}`);

  requireCreationCapacity(dep, factoryEvidence, terms.amountPerPeriod, needed);

  // Client balance + allowance — required (client's OWN balance, never child balance)
  if (factoryEvidence.clientBalance === undefined)
    throw new SdkStateError("prepareCreateAgreement: clientBalance missing from evidence");
  if (factoryEvidence.clientBalance < needed)
    throw new SdkStateError(
      `prepareCreateAgreement: client balance ${factoryEvidence.clientBalance} < required ${needed} (A+R)`,
    );
  if (factoryEvidence.clientAllowanceToFactory === undefined)
    throw new SdkStateError("prepareCreateAgreement: clientAllowanceToFactory missing from evidence");
  if (factoryEvidence.clientAllowanceToFactory < needed)
    throw new SdkStateError(
      `prepareCreateAgreement: client allowance to factory ${factoryEvidence.clientAllowanceToFactory} < required ${needed} (A+R)`,
    );

  return unsafeEncodeCreateAgreement(terms, providerSig, factory, dep.chainId);
}

/**
 * Prepare invalidateNonce.
 * Requires: fresh FactoryObservation, connectedAccount === clientAddress,
 * nonce is a valid uint256 bigint, factoryEvidence.checkedClientAddr matches.
 */
export function prepareInvalidateNonce(
  nonce: bigint,
  dep: NoticeVaultDeployment,
  evidence: FactoryObservation,
  connectedAccount: string,
  wallet: WalletContext,
): TxRequest {
  requireWalletContext(wallet, dep, "prepareInvalidateNonce", connectedAccount);

  if (typeof nonce !== "bigint")
    throw new SdkValidationError("prepareInvalidateNonce: nonce must be a bigint");
  if (nonce < 0n)
    throw new SdkValidationError("prepareInvalidateNonce: nonce must be non-negative");
  if (nonce > UINT256_MAX)
    throw new SdkValidationError("prepareInvalidateNonce: nonce exceeds uint256 max");

  dep = Object.freeze({ ...dep });
  requireFreshFactoryEvidence(evidence, dep, "prepareInvalidateNonce");

  const factory = requireFactoryAddress(dep);

  // Derive client from evidence — never from caller-supplied address
  const clientAddr = evidence.checkedClientAddr;
  if (!clientAddr)
    throw new SdkStateError("prepareInvalidateNonce: evidence missing checkedClientAddr");
  requireActor(connectedAccount, clientAddr, "prepareInvalidateNonce");

  // Nonce in evidence must match the nonce being invalidated
  if (evidence.checkedNonce !== nonce)
    throw new SdkStateError(
      `prepareInvalidateNonce: evidence was checked for nonce ${evidence.checkedNonce} ≠ requested nonce ${nonce}`,
    );

  return {
    to:           requireAddress(factory, "factory"),
    functionName: "invalidateNonce",
    abi:          FACTORY_ABI,
    args:         [nonce],
    chainId:      dep.chainId,
  };
}

/**
 * Prepare fundNextPeriod(expectedD).
 * Requires: fresh VERIFIED evidence, connectedAccount === client (from evidence),
 * no stored notice, now < current D, expectedD matches observed D.
 */
export function prepareFundNextPeriod(
  expectedD: bigint,
  agreementAddress: string,
  dep: NoticeVaultDeployment,
  evidence: VerifiedObservation,
  connectedAccount: string,
  _legacyNowSeconds: bigint,
  wallet: WalletContext,
): TxRequest {
  requireWalletContext(wallet, dep, "prepareFundNextPeriod", connectedAccount);

  if (typeof expectedD !== "bigint" || expectedD === 0n)
    throw new SdkValidationError("prepareFundNextPeriod: expectedD must be a non-zero bigint");
  requireAddress(agreementAddress, "agreementAddress");
  requireFreshVerifiedEvidence(evidence, dep, "prepareFundNextPeriod", agreementAddress);
  const nowSeconds = preparationTime(evidence);

  // Derive client from immutable observed terms
  const clientAddr = evidence.observedTerms?.client;
  if (!clientAddr)
    throw new SdkStateError("prepareFundNextPeriod: evidence missing observedTerms.client");
  requireActor(connectedAccount, clientAddr, "prepareFundNextPeriod");

  // Renewal transfers A only. Child funds and factory allowance cannot substitute.
  const renewalAmount = evidence.observedTerms!.amountPerPeriod;
  if (evidence.clientTokenBalance === undefined || evidence.clientTokenBalance < renewalAmount)
    throw new SdkStateError("prepareFundNextPeriod: observed client balance missing or below renewal amount");
  if (evidence.clientAllowanceToAgreement === undefined || evidence.clientAllowanceToAgreement < renewalAmount)
    throw new SdkStateError("prepareFundNextPeriod: observed agreement allowance missing or below renewal amount; approve then re-observe");


  if (evidence.hasStoredNotice === true)
    throw new SdkStateError("prepareFundNextPeriod: notice already stored");
  if (nowSeconds >= expectedD)
    throw new SdkStateError(`prepareFundNextPeriod: now=${nowSeconds} >= expectedD=${expectedD}; funding window closed`);
  if (evidence.domainSnapshot && evidence.domainSnapshot.D !== expectedD)
    throw new SdkStateError(`prepareFundNextPeriod: expectedD=${expectedD} ≠ observed D=${evidence.domainSnapshot.D}`);

  requireRenewalCapacity(dep, evidence);

  return {
    to:           requireAddress(agreementAddress, "agreementAddress"),
    functionName: "fundNextPeriod",
    abi:          AGREEMENT_ABI,
    args:         [expectedD],
    chainId:      dep.chainId,
  };
}

/**
 * Prepare startNotice.
 * msg.sender must be client. Client derived from evidence.observedTerms.client —
 * never from a caller-supplied address argument.
 * Requires: fresh VERIFIED evidence, connectedAccount === observedTerms.client,
 * no stored notice.
 */
export function prepareStartNotice(
  agreementAddress: string,
  dep: NoticeVaultDeployment,
  evidence: VerifiedObservation,
  connectedAccount: string,
  wallet: WalletContext,
): TxRequest {
  requireWalletContext(wallet, dep, "prepareStartNotice", connectedAccount);

  requireAddress(agreementAddress, "agreementAddress");
  requireFreshVerifiedEvidence(evidence, dep, "prepareStartNotice", agreementAddress);

  // Client derived from immutable observed terms — not from caller input
  const clientAddr = evidence.observedTerms?.client;
  if (!clientAddr)
    throw new SdkStateError("prepareStartNotice: evidence missing observedTerms.client");
  requireActor(connectedAccount, clientAddr, "prepareStartNotice");

  if (evidence.hasStoredNotice === true)
    throw new SdkStateError("prepareStartNotice: notice already started");

  return {
    to:           requireAddress(agreementAddress, "agreementAddress"),
    functionName: "startNotice",
    abi:          AGREEMENT_ABI,
    args:         [],
    chainId:      dep.chainId,
  };
}

/**
 * Prepare materializeNotice (permissionless).
 * Any connected account may call, but fresh evidence is MANDATORY.
 */
export function prepareMaterializeNotice(
  agreementAddress: string,
  dep: NoticeVaultDeployment,
  evidence: VerifiedObservation,
  wallet: WalletContext,
): TxRequest {
  requireWalletContext(wallet, dep, "prepareMaterializeNotice");

  requireAddress(agreementAddress, "agreementAddress");
  requireFreshVerifiedEvidence(evidence, dep, "prepareMaterializeNotice", agreementAddress);

  return {
    to:           requireAddress(agreementAddress, "agreementAddress"),
    functionName: "materializeNotice",
    abi:          AGREEMENT_ABI,
    args:         [],
    chainId:      dep.chainId,
  };
}

/**
 * Prepare claimProvider (permissionless, no destination arg).
 * The contract pays the immutable provider address.
 * Fresh evidence is MANDATORY.
 */
export function prepareClaimProvider(
  agreementAddress: string,
  dep: NoticeVaultDeployment,
  evidence: VerifiedObservation,
  wallet: WalletContext,
): TxRequest {
  requireWalletContext(wallet, dep, "prepareClaimProvider");

  requireAddress(agreementAddress, "agreementAddress");
  requireFreshVerifiedEvidence(evidence, dep, "prepareClaimProvider", agreementAddress);

  return {
    to:           requireAddress(agreementAddress, "agreementAddress"),
    functionName: "claimProvider",
    abi:          AGREEMENT_ABI,
    args:         [],
    chainId:      dep.chainId,
  };
}

/**
 * Prepare claimClientRefund (permissionless, no destination arg).
 * The contract pays the immutable client address.
 * Fresh evidence is MANDATORY.
 */
export function prepareClaimClientRefund(
  agreementAddress: string,
  dep: NoticeVaultDeployment,
  evidence: VerifiedObservation,
  wallet: WalletContext,
): TxRequest {
  requireWalletContext(wallet, dep, "prepareClaimClientRefund");

  requireAddress(agreementAddress, "agreementAddress");
  requireFreshVerifiedEvidence(evidence, dep, "prepareClaimClientRefund", agreementAddress);

  return {
    to:           requireAddress(agreementAddress, "agreementAddress"),
    functionName: "claimClientRefund",
    abi:          AGREEMENT_ABI,
    args:         [],
    chainId:      dep.chainId,
  };
}
