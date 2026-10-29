import { validatedAgreementRpc } from "./agreement-rpc.js";
/**
 * @noticevault/sdk — simulation snapshot and onchain verifier
 *
 * buildSimulationSnapshot: pure domain-model snapshot from AccountingState.
 *   source = "SIMULATION". No onchain evidence. No node: imports.
 *
 * observeAgreement: block-pinned read-only verifier.
 *   source = "VERIFIED". All reads pinned to one block.
 *   Fail-CLOSED: every required read must succeed with a valid result,
 *   or the observation returns a non-ok status with an actionable reason.
 *   No silent catches for required reads.
 *
 *   Code hash verification: deployment descriptor carries expectedFactoryCodeHash
 *   and expectedTokenCodeHash (keccak256 of runtime bytecode). Missing expected
 *   hash → deployment_unknown (not ok). Mismatch → code_hash_mismatch (not ok).
 *
 *   Branded issuance: every VerifiedObservation produced here is registered in
 *   the module-internal WeakSet inside observeAgreement(). Fabricated plain
 *   objects are not registered and will fail _isIssuedObservation() in txprep.
 *
 *   Domain cross-check: domain MalformedStateError or any material preview
 *   mismatch → accounting_mismatch (not ok). All preview fields compared.
 *
 *   Reorg check: getBlock(blockNumber) recheck after all reads. RPC failure
 *   on recheck → rpc_failure (not ok). Hash change → reorg_detected (not ok).
 *
 * IMPORTANT separation of concerns:
 *   SIMULATION ≠ VERIFIED. A fabricated or indexed snapshot must never carry
 *   source="VERIFIED". LOCAL_FIXTURE is labelled explicitly and is never live.
 */

import {
  calculateReferenceSnapshot,
  computeR,
} from "@noticevault/domain";
import { keccak256 } from "viem";
import { validateTermsInput } from "./codec.js";
import type { AccountingState, AgreementTerms, NoticeReason } from "@noticevault/domain";
import { FACTORY_ABI }   from "./generated/factory-abi.js";
import { AGREEMENT_ABI } from "./generated/agreement-abi.js";
import type {
  SimulationSnapshot,
  VerifiedObservation,
  FactoryObservation,
  BlockProof,
  ContractPreview,
  VerifierStatus,
  NoticeVaultDeployment,
} from "./types.js";

// ── ERC20 minimal ABI (balance + allowance) ────────────────────────────────────

const ERC20_READ_ABI = [
  { type: "function", name: "decimals", inputs: [], outputs: [{ name: "", type: "uint8" }], stateMutability: "view" },
  {
    type: "function", name: "balanceOf",
    inputs:  [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "allowance",
    inputs:  [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

// ── MinimalPublicClient interface (injectable, no viem import at type level) ───

/**
 * Subset of viem PublicClient used by the verifier.
 * Injectable for deterministic testing.
 */
export interface MinimalPublicClient {
  getChainId():              Promise<number>;
  getBlock(args: { blockTag: "latest" }): Promise<{
    number:    bigint;
    hash:      `0x${string}`;
    timestamp: bigint;
  }>;
  getBlock(args: { blockNumber: bigint }): Promise<{
    number:    bigint;
    hash:      `0x${string}`;
    timestamp: bigint;
  }>;
  getBytecode(args: { address: `0x${string}`; blockNumber: bigint }): Promise<`0x${string}` | undefined>;
  readContract(args: {
    address:      `0x${string}`;
    abi:          readonly unknown[];
    functionName: string;
    args?:        readonly unknown[];
    blockNumber:  bigint;
  }): Promise<unknown>;
}

// ── Simulation snapshot ────────────────────────────────────────────────────────

/**
 * Build a SIMULATION snapshot from pure domain state.
 *
 * Delegates all financial arithmetic to @noticevault/domain.
 * source is always "SIMULATION". Never carries block/RPC evidence.
 */
export function buildSimulationSnapshot(
  state: AccountingState,
  now: bigint,
  actualBalance?: bigint,
): SimulationSnapshot {
  const s = calculateReferenceSnapshot(state, now, actualBalance);
  return {
    source:               "SIMULATION",
    observationTimestamp: s.observationTimestamp,
    phase:                s.phase,
    R:                    s.R,
    D:                    s.D,
    hasStoredNotice:      s.hasStoredNotice,
    S:                    s.S,
    E:                    s.E,
    reason:               s.reason,
    V:                    s.V,
    W:                    s.W,
    RP:                   s.RP,
    NP:                   s.NP,
    providerClaimable:    s.providerClaimable,
    clientRefundable:     s.clientRefundable,
    L:                    s.L,
    noticeRemaining:      s.noticeRemaining,
  };
}

// ── Solidity enum mappings ─────────────────────────────────────────────────────
// Verified against contracts/src/NoticeVaultAgreement.sol preview() comments:
//   phase: 0=SCHEDULED 1=ACTIVE 2=NOTICE_SCHEDULED 3=NOTICE 4=ENDED_CLAIMABLE 5=CLOSED
//   reason: 0=absent(REASON_NONE) 1=CLIENT_CANCELLED 2=MISSED_CHECKPOINT

const PHASE_MAP: Record<number, import("@noticevault/domain").AgreementPhase> = {
  0: "SCHEDULED",
  1: "ACTIVE",
  2: "NOTICE_SCHEDULED",
  3: "NOTICE",
  4: "ENDED_CLAIMABLE",
  5: "CLOSED",
} as Record<number, import("@noticevault/domain").AgreementPhase>;

// reason: 0 = absent (no notice), 1 = CLIENT_CANCELLED, 2 = MISSED_CHECKPOINT
const REASON_MAP: Record<number, NoticeReason> = { 1: "CLIENT_CANCELLED", 2: "MISSED_CHECKPOINT" };

function decodePhase(raw: number): import("@noticevault/domain").AgreementPhase {
  const p = PHASE_MAP[raw];
  if (p === undefined) throw new Error(`Invalid phase enum value: ${raw}`);
  return p;
}

function decodeReason(raw: number, hasNotice: boolean): NoticeReason | null {
  if (!hasNotice) {
    // reason must be 0 (REASON_NONE) when no notice
    if (raw !== 0) throw new Error(`Invalid reason enum value ${raw} when hasNotice=false`);
    return null;
  }
  const r = REASON_MAP[raw];
  if (r === undefined) throw new Error(`Invalid reason enum value: ${raw}`);
  return r;
}

// ── Onchain verifier ───────────────────────────────────────────────────────────

/**
 * Observe and verify one agreement against the chain.
 *
 * All reads pinned to a single block. Returns a branded VerifiedObservation.
 * Fail-closed: every required read must succeed or the function returns non-ok.
 * Never throws for RPC failures — wraps them in status.
 *
 * Code hash verification: if dep.expectedFactoryCodeHash is set, the factory's
 * runtime bytecode keccak256 must match exactly. Missing → deployment_unknown.
 * Similarly for dep.expectedTokenCodeHash.
 *
 * @param client          Injectable MinimalPublicClient (real viem or deterministic mock).
 * @param dep             Deployment descriptor (must have factoryAddress + allowlistedToken).
 * @param agreementAddress Address of the child agreement to observe.
 * @param expectedTerms   Optional: if supplied, observed terms are compared field-by-field.
 * @param clientAddress   Optional: client address for allowance reads.
 */
export async function observeAgreement(
  client: MinimalPublicClient,
  dep: NoticeVaultDeployment,
  agreementAddress: `0x${string}`,
  expectedTerms?: AgreementTerms,
  clientAddress?: `0x${string}`,
): Promise<VerifiedObservation> {
  dep = Object.freeze({ ...dep });
  expectedTerms = expectedTerms ? Object.freeze({ ...expectedTerms }) : undefined;
function _issue(obs: VerifiedObservation, binding?: TargetBinding): VerifiedObservation {
  _issuedObservations.add(obs);
  if (binding) _targetBindings.set(obs as object, Object.freeze({ ...binding, policy: dep }));
  Object.freeze(obs);
  if (obs.block) Object.freeze(obs.block);
  if (obs.observedTerms) Object.freeze(obs.observedTerms);
  if (obs.domainSnapshot) Object.freeze(obs.domainSnapshot);
  if (obs.contractPreview) Object.freeze(obs.contractPreview);
  return obs;
}

  const observedAt = Date.now();
  client = validatedAgreementRpc(client);

  // ── 1. Validate deployment descriptor ────────────────────────────────────────
  if (!dep.factoryAddress || !dep.allowlistedToken) {
    return _issue(_failObs("deployment_unknown", "Deployment missing factoryAddress or allowlistedToken", dep, observedAt));
  }
  const factoryAddr = dep.factoryAddress as `0x${string}`;
  const tokenAddr   = dep.allowlistedToken as `0x${string}`;

  // ── 2. Chain ID check ─────────────────────────────────────────────────────────
  let connectedChainId: number;
  try {
    connectedChainId = await client.getChainId();
  } catch (err) {
    return _issue(_failObs("rpc_failure", `getChainId failed: ${_msg(err)}`, dep, observedAt));
  }
  if (BigInt(connectedChainId) !== dep.chainId) {
    return _issue(_failObs(
      "wrong_chain",
      `Chain mismatch: expected ${dep.chainId}, got ${connectedChainId}`,
      dep, observedAt,
    ));
  }

  // ── 3. Pin to a single block ──────────────────────────────────────────────────
  let latestBlock: { number: bigint; hash: `0x${string}`; timestamp: bigint };
  try {
    latestBlock = await client.getBlock({ blockTag: "latest" });
  } catch (err) {
    return _issue(_failObs("rpc_failure", `getBlock(latest) failed: ${_msg(err)}`, dep, observedAt));
  }
  const blockNumber    = latestBlock.number;
  const blockHash      = latestBlock.hash;
  const blockTimestamp = latestBlock.timestamp;

  const block: BlockProof = { chainId: dep.chainId, blockNumber, blockHash, blockTimestamp, observedAt };

  // ── 4. Verify factory bytecode + code hash ────────────────────────────────────
  // Required read — fail fatal on error or empty code.
  // If dep.expectedFactoryCodeHash is set, keccak256(bytecode) must match exactly.
  // If not set: deployment_unknown (cannot verify identity).
  let factoryBytecode: `0x${string}` | undefined;
  try {
    factoryBytecode = await client.getBytecode({ address: factoryAddr, blockNumber });
  } catch (err) {
    return _issue(_failObs("rpc_failure", `getBytecode(factory) failed: ${_msg(err)}`, dep, observedAt, block));
  }
  if (!factoryBytecode || factoryBytecode === "0x" || factoryBytecode.length <= 2) {
    return _issue(_failObs("deployment_unknown", "Factory address has no bytecode at pinned block", dep, observedAt, block));
  }
  if (dep.expectedFactoryCodeHash === null) {
    // LOCAL_FIXTURE or undeployed: no hash to compare — deployment_unknown
    return _issue(_failObs(
      "deployment_unknown",
      "Deployment has no expectedFactoryCodeHash — cannot verify factory identity (LOCAL_FIXTURE or undeployed)",
      dep, observedAt, block,
    ));
  }
  const actualFactoryHash = keccak256(factoryBytecode);
  if (actualFactoryHash.toLowerCase() !== dep.expectedFactoryCodeHash.toLowerCase()) {
    return _issue(_failObs(
      "code_hash_mismatch",
      `Factory code hash mismatch: expected ${dep.expectedFactoryCodeHash}, got ${actualFactoryHash}`,
      dep, observedAt, block,
    ));
  }

  // ── 5. Verify token bytecode hash ─────────────────────────────────────────────
  let tokenBytecode: `0x${string}` | undefined;
  try {
    tokenBytecode = await client.getBytecode({ address: tokenAddr, blockNumber });
  } catch (err) {
    return _issue(_failObs("rpc_failure", `getBytecode(token) failed: ${_msg(err)}`, dep, observedAt, block));
  }
  if (!tokenBytecode || tokenBytecode === "0x" || tokenBytecode.length <= 2) {
    return _issue(_failObs("deployment_unknown", "Token address has no bytecode at pinned block", dep, observedAt, block));
  }
  if (dep.expectedTokenCodeHash === null) {
    return _issue(_failObs(
      "deployment_unknown",
      "Deployment has no expectedTokenCodeHash — cannot verify token identity",
      dep, observedAt, block,
    ));
  }
  const actualTokenHash = keccak256(tokenBytecode);
  if (actualTokenHash.toLowerCase() !== dep.expectedTokenCodeHash.toLowerCase()) {
    return _issue(_failObs(
      "code_hash_mismatch",
      `Token code hash mismatch: expected ${dep.expectedTokenCodeHash}, got ${actualTokenHash}`,
      dep, observedAt, block,
    ));
  }

  // ── 6. Check agreement is registered with factory — REQUIRED ─────────────────
  let isRegistered: boolean;
  try {
    isRegistered = (await client.readContract({
      address: factoryAddr, abi: FACTORY_ABI,
      functionName: "registeredAgreement", args: [agreementAddress], blockNumber,
    })) as boolean;
  } catch (err) {
    return _issue(_failObs("rpc_failure", `registeredAgreement read failed: ${_msg(err)}`, dep, observedAt, block));
  }
  if (!isRegistered) {
    return _issue(_failObs("unregistered_child", "Agreement is not registered with this factory", dep, observedAt, block));
  }

  // ── 7. Read factory token — REQUIRED ─────────────────────────────────────────
  let factoryToken: string;
  try {
    factoryToken = (await client.readContract({
      address: factoryAddr, abi: FACTORY_ABI,
      functionName: "token", args: [], blockNumber,
    })) as string;
  } catch (err) {
    return _issue(_failObs("rpc_failure", `factory.token() read failed: ${_msg(err)}`, dep, observedAt, block));
  }
  if (factoryToken.toLowerCase() !== tokenAddr.toLowerCase()) {
    return _issue(_failObs(
      "token_mismatch",
      `Factory token ${factoryToken} ≠ deployment token ${tokenAddr}`,
      dep, observedAt, block,
    ));
  }

  // ── 8. Read factory caps and state — ALL REQUIRED ────────────────────────────
  let factoryCap: bigint;
  let agreementCap: bigint;
  let factoryOutstandingL: bigint;
  let factoryCreationPaused: boolean;
  try {
    factoryCap         = (await client.readContract({ address: factoryAddr, abi: FACTORY_ABI, functionName: "factoryCap",            args: [], blockNumber })) as bigint;
    agreementCap       = (await client.readContract({ address: factoryAddr, abi: FACTORY_ABI, functionName: "agreementCap",          args: [], blockNumber })) as bigint;
    factoryOutstandingL= (await client.readContract({ address: factoryAddr, abi: FACTORY_ABI, functionName: "outstandingLiability",  args: [], blockNumber })) as bigint;
    factoryCreationPaused = (await client.readContract({ address: factoryAddr, abi: FACTORY_ABI, functionName: "creationPaused",     args: [], blockNumber })) as boolean;
  } catch (err) {
    return _issue(_failObs("rpc_failure", `factory cap/pause read failed: ${_msg(err)}`, dep, observedAt, block));
  }

  // Nonce read requires a client address (optional — not fatal if absent)
  let factoryNonceUnavailable: boolean | undefined;
  if (clientAddress) {
    try {
      factoryNonceUnavailable = (await client.readContract({
        address: factoryAddr, abi: FACTORY_ABI, functionName: "isNonceUnavailable",
        args: [clientAddress, 0n], blockNumber,
      })) as boolean;
    } catch (err) {
      return _issue(_failObs("rpc_failure", `isNonceUnavailable read failed: ${_msg(err)}`, dep, observedAt, block, {
        factoryCap, agreementCap, factoryOutstandingL, factoryCreationPaused,
      }));
    }
  }

  // ── 9. Read agreement terms — REQUIRED ────────────────────────────────────────
  let rawTerms: unknown;
  try {
    rawTerms = await client.readContract({
      address: agreementAddress, abi: AGREEMENT_ABI, functionName: "terms",
      args: [], blockNumber,
    });
  } catch (err) {
    return _issue(_failObs("rpc_failure", `agreement.terms() read failed: ${_msg(err)}`, dep, observedAt, block, {
      factoryCap, agreementCap, factoryOutstandingL, factoryCreationPaused,
      ...(factoryNonceUnavailable !== undefined ? { factoryNonceUnavailable } : {}),
    }));
  }

  // terms() returns 11 positional values as an array
  const termsArr = rawTerms as [number, string, string, string, bigint, bigint, bigint, bigint, bigint, bigint, string];
  const observedTerms: AgreementTerms = {
    schemaVersion:      Number(termsArr[0]),
    client:             termsArr[1],
    provider:           termsArr[2],
    token:              termsArr[3],
    amountPerPeriod:    BigInt(termsArr[4]),
    periodSeconds:      BigInt(termsArr[5]),
    noticeSeconds:      BigInt(termsArr[6]),
    startAt:            BigInt(termsArr[7]),
    clientNonce:        BigInt(termsArr[8]),
    acceptanceDeadline: BigInt(termsArr[9]),
    termsDocumentHash:  termsArr[10],
  };

  try { validateTermsInput(observedTerms); } catch (err) {
    return _issue(_failObs("terms_mismatch", `Invalid observed terms: ${_msg(err)}`, dep, observedAt, block));
  }
  if (clientAddress && clientAddress.toLowerCase() !== observedTerms.client.toLowerCase())
    return _issue(_failObs("terms_mismatch", "Allowance client does not match agreement client", dep, observedAt, block));

  // Verify token in terms matches deployment
  if (observedTerms.token.toLowerCase() !== tokenAddr.toLowerCase()) {
    return _issue(_failObs(
      "token_mismatch",
      `Agreement terms.token ${observedTerms.token} ≠ deployment token ${tokenAddr}`,
      dep, observedAt, block,
      { factoryCap, agreementCap, factoryOutstandingL, factoryCreationPaused, observedTerms },
    ));
  }

  // Verify beneficiaries match expectations if provided
  if (expectedTerms) {
    const mismatch = _compareTerms(observedTerms, expectedTerms);
    if (mismatch) {
      return _issue(_failObs(
        "terms_mismatch", mismatch,
        dep, observedAt, block,
        { factoryCap, agreementCap, factoryOutstandingL, factoryCreationPaused, observedTerms },
      ));
    }
  }

  // ── 10. Read accounting state — REQUIRED ──────────────────────────────────────
  let rawAccounting: unknown;
  try {
    rawAccounting = await client.readContract({
      address: agreementAddress, abi: AGREEMENT_ABI, functionName: "accounting",
      args: [], blockNumber,
    });
  } catch (err) {
    return _issue(_failObs("rpc_failure", `agreement.accounting() failed: ${_msg(err)}`, dep, observedAt, block, {
      factoryCap, agreementCap, factoryOutstandingL, factoryCreationPaused, observedTerms,
    }));
  }

  // accounting() returns: F, RP_, NP_, CR_, R_, hn_, S_, reason_, L_
  const acc = rawAccounting as [bigint, bigint, bigint, bigint, bigint, boolean, bigint, number, bigint];
  const regularFunded    = BigInt(acc[0]);
  const regularPaid      = BigInt(acc[1]);
  const noticePaid       = BigInt(acc[2]);
  const clientRefunded   = BigInt(acc[3]);
  const noticeReserve    = BigInt(acc[4]);
  const hasStoredNotice  = Boolean(acc[5]);
  const noticeStartRaw   = BigInt(acc[6]);
  const noticeStartStored: bigint | null = hasStoredNotice ? noticeStartRaw : null;
  const noticeReasonRaw  = Number(acc[7]);

  // Validate enum values — invalid enum → accounting_mismatch
  let noticeReasonStored: NoticeReason | null;
  try {
    noticeReasonStored = decodeReason(noticeReasonRaw, hasStoredNotice);
  } catch {
    return _issue(_failObs("accounting_mismatch", `Invalid reason enum value: ${noticeReasonRaw}`, dep, observedAt, block, {
      factoryCap, agreementCap, factoryOutstandingL, factoryCreationPaused, observedTerms,
      regularFunded, regularPaid, noticePaid, clientRefunded, noticeReserve, hasStoredNotice, noticeStartStored: null,
    }));
  }

  // R from contract must match domain computeR
  const domainR = computeR(observedTerms);
  if (noticeReserve !== domainR) {
    return _issue(_failObs(
      "accounting_mismatch",
      `Contract R=${noticeReserve} ≠ domain R=${domainR}`,
      dep, observedAt, block, {
        factoryCap, agreementCap, factoryOutstandingL, factoryCreationPaused, observedTerms,
        regularFunded, regularPaid, noticePaid, clientRefunded, noticeReserve, hasStoredNotice, noticeStartStored,
      },
    ));
  }

  // Contract L (acc[8]) must equal F+R-RP-NP-CR arithmetic
  const contractL = BigInt(acc[8]);
  const expectedL = regularFunded + noticeReserve - regularPaid - noticePaid - clientRefunded;
  if (contractL !== expectedL) {
    return _issue(_failObs(
      "accounting_mismatch",
      `Contract L=${contractL} ≠ arithmetic L=${expectedL} (F+R-RP-NP-CR)`,
      dep, observedAt, block, {
        factoryCap, agreementCap, factoryOutstandingL, factoryCreationPaused, observedTerms,
        regularFunded, regularPaid, noticePaid, clientRefunded, noticeReserve, hasStoredNotice, noticeStartStored,
      },
    ));
  }

  // ── 11. Read contract preview — REQUIRED ──────────────────────────────────────
  let contractPreview: ContractPreview;
  try {
    const rawPreview = await client.readContract({
      address: agreementAddress, abi: AGREEMENT_ABI, functionName: "preview",
      args: [], blockNumber,
    }) as Record<string, unknown>;
    // Validate phase enum
    const phaseRaw = Number(rawPreview["phase"] ?? rawPreview[1]);
    try { decodePhase(phaseRaw); } catch {
      return _issue(_failObs("accounting_mismatch", `Invalid phase enum value: ${phaseRaw}`, dep, observedAt, block));
    }
    contractPreview = {
      observationTimestamp: BigInt(rawPreview["observationTimestamp"] as bigint ?? 0n),
      phase:                phaseRaw,
      R:                    BigInt(rawPreview["R"] as bigint),
      D:                    BigInt(rawPreview["D"] as bigint),
      hasStoredNotice:      Boolean(rawPreview["hasStoredNotice_"] ?? rawPreview["hasStoredNotice"]),
      S:                    BigInt(rawPreview["S"] as bigint ?? 0n),
      E:                    BigInt(rawPreview["E"] as bigint ?? 0n),
      reason:               Number(rawPreview["reason"] ?? 0),
      V:                    BigInt(rawPreview["V"] as bigint),
      W:                    BigInt(rawPreview["W"] as bigint),
      RP:                   BigInt(rawPreview["RP"] as bigint),
      NP:                   BigInt(rawPreview["NP"] as bigint),
      providerClaimable:    BigInt(rawPreview["providerClaimable"] as bigint),
      clientRefundable:     BigInt(rawPreview["clientRefundable"] as bigint),
      L:                    BigInt(rawPreview["L"] as bigint),
      noticeRemaining:      BigInt(rawPreview["noticeRemaining"] as bigint),
    };
  } catch (err) {
    return _issue(_failObs("rpc_failure", `agreement.preview() failed: ${_msg(err)}`, dep, observedAt, block, {
      factoryCap, agreementCap, factoryOutstandingL, factoryCreationPaused, observedTerms,
      regularFunded, regularPaid, noticePaid, clientRefunded, noticeReserve, hasStoredNotice, noticeStartStored,
    }));
  }

  // ── 12. Domain cross-check — mismatch is fatal ────────────────────────────────
  const accountingState: AccountingState = {
    terms: observedTerms,
    regularFunded,
    regularPaid,
    noticePaid,
    clientRefunded,
    noticeStartStored,
    noticeReasonStored,
  };

  let domainSnapshot: SimulationSnapshot;
  try {
    domainSnapshot = buildSimulationSnapshot(accountingState, blockTimestamp);
  } catch (err) {
    // Domain threw (e.g. MalformedStateError) — state is inconsistent
    return _issue(_failObs(
      "accounting_mismatch",
      `Domain model threw on observed state: ${_msg(err)}`,
      dep, observedAt, block, {
        factoryCap, agreementCap, factoryOutstandingL, factoryCreationPaused, observedTerms,
        regularFunded, regularPaid, noticePaid, clientRefunded, noticeReserve, hasStoredNotice, noticeStartStored,
        contractPreview,
      },
    ));
  }

  // Compare all financially meaningful preview fields.
  // Phase: both domain and contract use identical 6-state enum
  //   (SCHEDULED/ACTIVE/NOTICE_SCHEDULED/NOTICE/ENDED_CLAIMABLE/CLOSED) —
  //   compare by name. Contract phase is decoded to string via PHASE_MAP above.
  // noticeRemaining: both define R - NP unconditionally — compare exactly.
  // S/E: domain null → 0n for contract comparison (contract stores 0 for absent).
  const contractPhaseName = PHASE_MAP[contractPreview.phase];
  const mismatches: string[] = [];
  if (contractPreview.observationTimestamp !== blockTimestamp) mismatches.push("preview timestamp does not match pinned block");
  if (contractPreview.hasStoredNotice !== domainSnapshot.hasStoredNotice) mismatches.push("preview notice flag mismatch");
  const expectedReason = domainSnapshot.reason === null ? 0 : domainSnapshot.reason === "CLIENT_CANCELLED" ? 1 : 2;
  if (contractPreview.reason !== expectedReason) mismatches.push("preview notice reason mismatch");

  if (contractPhaseName !== domainSnapshot.phase)
    mismatches.push(`phase: domain=${domainSnapshot.phase} contract=${contractPhaseName}(${contractPreview.phase})`);
  if (domainSnapshot.R  !== contractPreview.R)  mismatches.push(`R: domain=${domainSnapshot.R} contract=${contractPreview.R}`);
  if (domainSnapshot.V  !== contractPreview.V)  mismatches.push(`V: domain=${domainSnapshot.V} contract=${contractPreview.V}`);
  if (domainSnapshot.W  !== contractPreview.W)  mismatches.push(`W: domain=${domainSnapshot.W} contract=${contractPreview.W}`);
  if (domainSnapshot.L  !== contractPreview.L)  mismatches.push(`L: domain=${domainSnapshot.L} contract=${contractPreview.L}`);
  if (domainSnapshot.D  !== contractPreview.D)  mismatches.push(`D: domain=${domainSnapshot.D} contract=${contractPreview.D}`);
  if (domainSnapshot.RP !== contractPreview.RP) mismatches.push(`RP: domain=${domainSnapshot.RP} contract=${contractPreview.RP}`);
  if (domainSnapshot.NP !== contractPreview.NP) mismatches.push(`NP: domain=${domainSnapshot.NP} contract=${contractPreview.NP}`);
  if (domainSnapshot.providerClaimable !== contractPreview.providerClaimable)
    mismatches.push(`providerClaimable: domain=${domainSnapshot.providerClaimable} contract=${contractPreview.providerClaimable}`);
  if (domainSnapshot.clientRefundable !== contractPreview.clientRefundable)
    mismatches.push(`clientRefundable: domain=${domainSnapshot.clientRefundable} contract=${contractPreview.clientRefundable}`);
  if (domainSnapshot.noticeRemaining !== contractPreview.noticeRemaining)
    mismatches.push(`noticeRemaining: domain=${domainSnapshot.noticeRemaining} contract=${contractPreview.noticeRemaining}`);
  // S/E: domain uses null for absent; contract uses 0. Normalize for comparison.
  const domainS = domainSnapshot.S ?? 0n;
  const domainE = domainSnapshot.E ?? 0n;
  if (domainS !== BigInt(contractPreview.S))
    mismatches.push(`S: domain=${domainS} contract=${contractPreview.S}`);
  if (domainE !== BigInt(contractPreview.E))
    mismatches.push(`E: domain=${domainE} contract=${contractPreview.E}`);

  if (mismatches.length > 0) {
    return _issue(_failObs(
      "accounting_mismatch",
      `Domain/contract preview mismatch: ${mismatches.join("; ")}`,
      dep, observedAt, block, {
        factoryCap, agreementCap, factoryOutstandingL, factoryCreationPaused, observedTerms,
        regularFunded, regularPaid, noticePaid, clientRefunded, noticeReserve, hasStoredNotice, noticeStartStored,
        contractPreview, domainSnapshot,
      },
    ));
  }

  // ── 13. Token balance — REQUIRED ──────────────────────────────────────────────
  let tokenBalance: bigint;
  try {
    tokenBalance = (await client.readContract({
      address: tokenAddr, abi: ERC20_READ_ABI, functionName: "balanceOf",
      args: [agreementAddress], blockNumber,
    })) as bigint;
  } catch (err) {
    return _issue(_failObs("rpc_failure", `token.balanceOf(agreement) failed: ${_msg(err)}`, dep, observedAt, block, {
      factoryCap, agreementCap, factoryOutstandingL, factoryCreationPaused, observedTerms,
      regularFunded, regularPaid, noticePaid, clientRefunded, noticeReserve, hasStoredNotice, noticeStartStored,
      contractPreview, domainSnapshot,
    }));
  }

  // Validate: token balance must be >= L (liability must be covered)
  const domainL = domainSnapshot.L;
  if (tokenBalance < domainL) {
    return _issue(_failObs(
      "accounting_mismatch",
      `Token balance ${tokenBalance} < liability L=${domainL}: agreement is underfunded`,
      dep, observedAt, block, {
        factoryCap, agreementCap, factoryOutstandingL, factoryCreationPaused, observedTerms,
        regularFunded, regularPaid, noticePaid, clientRefunded, noticeReserve, hasStoredNotice, noticeStartStored,
        contractPreview, domainSnapshot, tokenBalance,
      },
    ));
  }

  // ── 14. Client balance + allowances (optional — required if clientAddress given) ─
  let clientAllowanceToFactory: bigint | undefined;
  let clientAllowanceToAgreement: bigint | undefined;
  let clientTokenBalance_: bigint | undefined;
  if (clientAddress) {
    try {
      clientAllowanceToFactory = (await client.readContract({
        address: tokenAddr, abi: ERC20_READ_ABI, functionName: "allowance",
        args: [clientAddress, factoryAddr], blockNumber,
      })) as bigint;
      clientAllowanceToAgreement = (await client.readContract({
        address: tokenAddr, abi: ERC20_READ_ABI, functionName: "allowance",
        args: [clientAddress, agreementAddress], blockNumber,
      })) as bigint;
      clientTokenBalance_ = (await client.readContract({
        address: tokenAddr, abi: ERC20_READ_ABI, functionName: "balanceOf",
        args: [clientAddress], blockNumber,
      })) as bigint;
    } catch (err) {
      return _issue(_failObs("rpc_failure", `client balance/allowance read failed: ${_msg(err)}`, dep, observedAt, block, {
        factoryCap, agreementCap, factoryOutstandingL, factoryCreationPaused, observedTerms,
        regularFunded, regularPaid, noticePaid, clientRefunded, noticeReserve, hasStoredNotice, noticeStartStored,
        contractPreview, domainSnapshot, tokenBalance,
      }));
    }
  }

  // ── 15. Reorg check: re-read block by number — REQUIRED ──────────────────────
  // Fatal on RPC failure or hash change.
  try {
    const recheck = await client.getBlock({ blockNumber });
    if (BigInt(await client.getChainId()) !== dep.chainId)
      return _issue(_failObs("wrong_chain", "RPC chain changed during agreement observation", dep, observedAt, block));

    if (recheck.hash !== blockHash || recheck.number !== blockNumber || recheck.timestamp !== blockTimestamp) {
      return _issue({
        source:         "VERIFIED",
        configIdentity: dep.configIdentity,
        status:         "reorg_detected",
        statusDetail:   `Block ${blockNumber} hash changed: expected ${blockHash}, got ${recheck.hash}`,
        block,
      });
    }
  } catch (err) {
    return _issue(_failObs(
      "rpc_failure",
      `Reorg recheck getBlock(${blockNumber}) failed: ${_msg(err)}`,
      dep, observedAt, block, {
        factoryCap, agreementCap, factoryOutstandingL, factoryCreationPaused, observedTerms,
        regularFunded, regularPaid, noticePaid, clientRefunded, noticeReserve, hasStoredNotice, noticeStartStored,
        contractPreview, domainSnapshot, tokenBalance,
        ...(clientAllowanceToFactory    !== undefined ? { clientAllowanceToFactory }    : {}),
        ...(clientAllowanceToAgreement  !== undefined ? { clientAllowanceToAgreement }  : {}),
      },
    ));
  }

  // ── 16. Build final ok observation ────────────────────────────────────────────
  const binding: TargetBinding = {
    agreementAddress: agreementAddress.toLowerCase(),
    factoryAddress:   factoryAddr.toLowerCase(),
    tokenAddress:     tokenAddr.toLowerCase(),
    configIdentity:   dep.configIdentity,
  };
  return _issue({
    source:           "VERIFIED",
    configIdentity:   dep.configIdentity,
    status:           "ok",
    block,

    ...(factoryNonceUnavailable !== undefined ? { factoryNonceUnavailable } : {}),
    factoryCreationPaused,
    factoryCap,
    agreementCap,
    factoryOutstandingL,

    observedTerms,
    regularFunded,
    regularPaid,
    noticePaid,
    clientRefunded,
    noticeReserve,
    hasStoredNotice,
    noticeStartStored,

    contractPreview,
    domainSnapshot,
    domainMatchesContract: true, // all field checks passed above

    tokenBalance,
    ...(clientTokenBalance_ !== undefined ? { clientTokenBalance: clientTokenBalance_ } : {}),
    ...(clientAllowanceToFactory    !== undefined ? { clientAllowanceToFactory }    : {}),
    ...(clientAllowanceToAgreement  !== undefined ? { clientAllowanceToAgreement }  : {}),
  }, binding);
}

// ── Factory-only observation (for creation / nonce invalidation) ───────────────

/**
 * Observe factory state for a creation or nonce-invalidation flow.
 * No child agreement address required — the child doesn't exist yet.
 *
 * Pins all reads to one block. Verifies factory/token bytecode hashes.
 * Returns a FactoryObservation (distinct discriminant from VerifiedObservation
 * to prevent existing child evidence from being reused for creation).
 *
 * @param client      Injectable MinimalPublicClient.
 * @param dep         Deployment descriptor with expectedFactoryCodeHash and expectedTokenCodeHash.
 * @param clientAddr  Client address for nonce + balance + allowance reads.
 * @param nonce       Client nonce to check availability of.
 * @param requestedTerms  Terms for creation (used to compute A+R for balance/allowance check).
 */
// Factory policy bindings are private: no public function can insert evidence.
const _factoryPolicies = new WeakMap<object, Readonly<NoticeVaultDeployment>>();

/** Read-only predicate; cannot register or alter evidence. */
export function _isIssuedFactoryObservation(obs: object): boolean {
  return _factoryPolicies.has(obs);
}

/** Compare every captured descriptor field; no mutable binding is exposed. */
export function _matchesFactoryDeployment(obs: object, dep: NoticeVaultDeployment): boolean {
  const policy = _factoryPolicies.get(obs);
  return !!policy && policy.configIdentity === dep.configIdentity &&
    policy.chainId === dep.chainId && policy.factoryAddress === dep.factoryAddress &&
    policy.allowlistedToken === dep.allowlistedToken &&
    policy.expectedFactoryCodeHash === dep.expectedFactoryCodeHash &&
    policy.expectedTokenCodeHash === dep.expectedTokenCodeHash &&
    policy.isLive === dep.isLive && policy.label === dep.label;
}

export async function observeFactoryForCreation(
  client: MinimalPublicClient,
  dep: NoticeVaultDeployment,
  clientAddr: `0x${string}`,
  nonce: bigint,
  requestedTerms: AgreementTerms,
): Promise<FactoryObservation> {
  // Capture caller-owned policy before any await; all reads use this snapshot.
  dep = Object.freeze({ ...dep });
  // This closure is the only writer to the private factory policy registry.
  const _issueFactoryObservation = (obs: FactoryObservation): FactoryObservation => {
    _factoryPolicies.set(obs, dep);
    Object.freeze(obs.block);
    if (obs.requestedTerms) Object.freeze(obs.requestedTerms);
    return Object.freeze(obs);
  };
  const observedAt = Date.now();

  const _failFac = (status: FactoryObservation["status"], detail: string, block?: BlockProof): FactoryObservation => ({
    kind: "FACTORY_OBSERVATION",
    source: "VERIFIED",
    configIdentity: dep.configIdentity,
    status,
    statusDetail: detail,
    block: block ?? { chainId: dep.chainId, blockNumber: 0n, blockHash: "0x" as `0x${string}`, blockTimestamp: 0n, observedAt },
  });

  // Own and validate the requested terms before the first asynchronous read.
  requestedTerms = Object.freeze({ ...requestedTerms });
  try {
    validateTermsInput(requestedTerms);
    if (typeof clientAddr !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(clientAddr) ||
        requestedTerms.client.toLowerCase() !== clientAddr.toLowerCase() ||
        typeof nonce !== "bigint" || nonce !== requestedTerms.clientNonce) {
      return _issueFactoryObservation(_failFac("terms_mismatch", "Requested client or nonce does not match factory query"));
    }
    if (typeof dep.allowlistedToken !== "string" ||
        requestedTerms.token.toLowerCase() !== dep.allowlistedToken.toLowerCase()) {
      return _issueFactoryObservation(_failFac("token_mismatch", "Requested token is not the deployment token"));
    }
  } catch (err) {
    return _issueFactoryObservation(_failFac("terms_mismatch", "Invalid requested terms: " + _msg(err)));
  }

  if (!dep.factoryAddress || !dep.allowlistedToken) {
    return _issueFactoryObservation(_failFac("deployment_unknown", "Missing factoryAddress or allowlistedToken"));
  }
  const factoryAddr = dep.factoryAddress as `0x${string}`;
  const tokenAddr   = dep.allowlistedToken as `0x${string}`;

  // Chain ID
  let connectedChainId: number;
  try { connectedChainId = await client.getChainId(); }
  catch (err) { return _issueFactoryObservation(_failFac("rpc_failure", `getChainId failed: ${_msg(err)}`)); }
  if (BigInt(connectedChainId) !== dep.chainId)
    return _issueFactoryObservation(_failFac("wrong_chain", `Chain mismatch: expected ${dep.chainId}, got ${connectedChainId}`));

  const isUint256 = (value: unknown): value is bigint =>
    typeof value === "bigint" && value >= 0n && value < (1n << 256n);
  const isBlockProof = (value: unknown): value is { number: bigint; hash: `0x${string}`; timestamp: bigint } => {
    if (value === null || typeof value !== "object") return false;
    const proof = value as Record<string, unknown>;
    return isUint256(proof.number) && isUint256(proof.timestamp) &&
      typeof proof.hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(proof.hash);
  };

  // Pin to block
  let latestBlock: { number: bigint; hash: `0x${string}`; timestamp: bigint };
  try { latestBlock = await client.getBlock({ blockTag: "latest" }); }
  catch (err) { return _issueFactoryObservation(_failFac("rpc_failure", `getBlock(latest) failed: ${_msg(err)}`)); }
  if (!isBlockProof(latestBlock))
    return _issueFactoryObservation(_failFac("rpc_failure", "Invalid latest block proof"));
  const blockNumber    = latestBlock.number;
  const blockHash      = latestBlock.hash;
  const blockTimestamp = latestBlock.timestamp;
  const block: BlockProof = { chainId: dep.chainId, blockNumber, blockHash, blockTimestamp, observedAt };

  // Factory bytecode hash
  let factoryBytecode: `0x${string}` | undefined;
  try { factoryBytecode = await client.getBytecode({ address: factoryAddr, blockNumber }); }
  catch (err) { return _issueFactoryObservation(_failFac("rpc_failure", `getBytecode(factory) failed: ${_msg(err)}`, block)); }
  if (!factoryBytecode || factoryBytecode.length <= 2)
    return _issueFactoryObservation(_failFac("deployment_unknown", "Factory has no bytecode", block));
  if (dep.expectedFactoryCodeHash === null)
    return _issueFactoryObservation(_failFac("deployment_unknown", "No expectedFactoryCodeHash in deployment descriptor", block));
  if (keccak256(factoryBytecode).toLowerCase() !== dep.expectedFactoryCodeHash.toLowerCase())
    return _issueFactoryObservation(_failFac("code_hash_mismatch", "Factory bytecode hash mismatch", block));

  // Token bytecode hash
  let tokenBytecode: `0x${string}` | undefined;
  try { tokenBytecode = await client.getBytecode({ address: tokenAddr, blockNumber }); }
  catch (err) { return _issueFactoryObservation(_failFac("rpc_failure", `getBytecode(token) failed: ${_msg(err)}`, block)); }
  if (!tokenBytecode || tokenBytecode.length <= 2)
    return _issueFactoryObservation(_failFac("deployment_unknown", "Token has no bytecode", block));
  if (dep.expectedTokenCodeHash === null)
    return _issueFactoryObservation(_failFac("deployment_unknown", "No expectedTokenCodeHash in deployment descriptor", block));
  if (keccak256(tokenBytecode).toLowerCase() !== dep.expectedTokenCodeHash.toLowerCase())
    return _issueFactoryObservation(_failFac("code_hash_mismatch", "Token bytecode hash mismatch", block));

  // These are required pinned RPC results, not descriptor assumptions.
  try {
    const actualToken = await client.readContract({ address: factoryAddr, abi: FACTORY_ABI, functionName: "token", args: [], blockNumber });
    if (typeof actualToken !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(actualToken) ||
        actualToken.toLowerCase() !== tokenAddr.toLowerCase())
      return _issueFactoryObservation(_failFac("token_mismatch", "Factory token does not match deployment", block));
    const decimals = await client.readContract({ address: tokenAddr, abi: ERC20_READ_ABI, functionName: "decimals", args: [], blockNumber });
    if (decimals !== 6)
      return _issueFactoryObservation(_failFac("token_mismatch", "Token decimals must be the supported uint8 value 6", block));
  } catch (err) {
    return _issueFactoryObservation(_failFac("rpc_failure", "Factory token/decimals read failed: " + _msg(err), block));
  }

  // Factory caps, pause, nonce
  let factoryCap: bigint, agreementCap: bigint, factoryOutstandingL: bigint;
  let factoryCreationPaused: boolean, nonceUnavailable: boolean;
  try {
    factoryCap         = (await client.readContract({ address: factoryAddr, abi: FACTORY_ABI, functionName: "factoryCap",           args: [], blockNumber })) as bigint;
    agreementCap       = (await client.readContract({ address: factoryAddr, abi: FACTORY_ABI, functionName: "agreementCap",         args: [], blockNumber })) as bigint;
    factoryOutstandingL= (await client.readContract({ address: factoryAddr, abi: FACTORY_ABI, functionName: "outstandingLiability", args: [], blockNumber })) as bigint;
    factoryCreationPaused = (await client.readContract({ address: factoryAddr, abi: FACTORY_ABI, functionName: "creationPaused",    args: [], blockNumber })) as boolean;
    nonceUnavailable   = (await client.readContract({ address: factoryAddr, abi: FACTORY_ABI, functionName: "isNonceUnavailable",   args: [clientAddr, nonce], blockNumber })) as boolean;
  } catch (err) {
    return _issueFactoryObservation(_failFac("rpc_failure", `factory reads failed: ${_msg(err)}`, block));
  }

  if (![factoryCap, agreementCap, factoryOutstandingL].every(isUint256) ||
      typeof factoryCreationPaused !== "boolean" || typeof nonceUnavailable !== "boolean")
    return _issueFactoryObservation(_failFac("rpc_failure", "Invalid factory read values", block));

  // Token: client balance + allowance to factory
  let clientBalance: bigint, clientAllowanceToFactory: bigint;
  try {
    clientBalance           = (await client.readContract({ address: tokenAddr, abi: ERC20_READ_ABI, functionName: "balanceOf",  args: [clientAddr], blockNumber })) as bigint;
    clientAllowanceToFactory= (await client.readContract({ address: tokenAddr, abi: ERC20_READ_ABI, functionName: "allowance",  args: [clientAddr, factoryAddr], blockNumber })) as bigint;
  } catch (err) {
    return _issueFactoryObservation(_failFac("rpc_failure", `token reads failed: ${_msg(err)}`, block));
  }

  if (!isUint256(clientBalance) || !isUint256(clientAllowanceToFactory))
    return _issueFactoryObservation(_failFac("rpc_failure", "Invalid token balance or allowance", block));

  // Provider bytecode (for ERC1271 vs EOA determination)
  let providerBytecode: `0x${string}` | undefined;
  try { providerBytecode = await client.getBytecode({ address: requestedTerms.provider as `0x${string}`, blockNumber }); }
  catch (err) { return _issueFactoryObservation(_failFac("rpc_failure", `getBytecode(provider) failed: ${_msg(err)}`, block)); }

  // Reorg check
  try {
    const recheck = await client.getBlock({ blockNumber });
    if (!isBlockProof(recheck))
      return _issueFactoryObservation(_failFac("rpc_failure", "Invalid recheck block proof", block));
    if (recheck.number !== blockNumber || recheck.timestamp !== blockTimestamp ||
        recheck.hash.toLowerCase() !== blockHash.toLowerCase())
      return _issueFactoryObservation({ kind: "FACTORY_OBSERVATION", source: "VERIFIED", configIdentity: dep.configIdentity, status: "reorg_detected", statusDetail: `Block ${blockNumber} proof changed`, block });
  } catch (err) {
    return _issueFactoryObservation(_failFac("rpc_failure", `Reorg recheck failed: ${_msg(err)}`, block));
  }

  const result: FactoryObservation = {
    kind: "FACTORY_OBSERVATION",
    source: "VERIFIED",
    configIdentity: dep.configIdentity,
    status: "ok",
    block,
    factoryCap,
    agreementCap,
    factoryOutstandingL,
    factoryCreationPaused,
    nonceUnavailable,
    clientBalance,
    clientAllowanceToFactory,
    providerHasCode: Boolean(providerBytecode && providerBytecode.length > 2),
    requestedTerms,
    checkedNonce: nonce,
    checkedClientAddr: clientAddr,
  };
  return _issueFactoryObservation(result);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Target binding registry ───────────────────────────────────────────────────
// Maps each issued VerifiedObservation to the exact agreementAddress, factoryAddress,
// tokenAddress, configIdentity and termsDigest it was issued for.
// Used by requireFreshVerifiedEvidence to detect target swaps.

interface TargetBinding {
  readonly policy?: Readonly<NoticeVaultDeployment>;
  agreementAddress: string;
  factoryAddress:   string;
  tokenAddress:     string;
  configIdentity:   string;
}

const _targetBindings = new WeakMap<object, TargetBinding>();
const _issuedObservations = new WeakSet<object>();
export function _isIssuedObservation(obs: object): boolean { return _issuedObservations.has(obs); }

/** Read the target binding for an issued observation (null if not issued). */
export function _getTargetBinding(obs: VerifiedObservation): TargetBinding | undefined {
  return _targetBindings.get(obs as object) ?? undefined;
}

/**
 * Register a VerifiedObservation in the module-internal brand registry,
 * record its target binding, deep-freeze it, and return it.
 * All code paths through observeAgreement must call this.
 */
function _failObs(
  status: VerifierStatus,
  detail: string,
  dep: NoticeVaultDeployment,
  observedAt: number,
  block?: BlockProof,
  partial?: Partial<VerifiedObservation>,
): VerifiedObservation {
  return {
    source:        "VERIFIED",
    configIdentity: dep.configIdentity,
    status,
    statusDetail:  detail,
    block: block ?? {
      chainId:        dep.chainId,
      blockNumber:    0n,
      blockHash:      "0x" as `0x${string}`,
      blockTimestamp: 0n,
      observedAt,
    },
    ...partial,
  };
}

function _compareTerms(observed: AgreementTerms, expected: AgreementTerms): string | null {
  if (observed.schemaVersion  !== expected.schemaVersion)      return `schemaVersion mismatch`;
  if (observed.client.toLowerCase()   !== expected.client.toLowerCase())   return `client mismatch`;
  if (observed.provider.toLowerCase() !== expected.provider.toLowerCase()) return `provider mismatch`;
  if (observed.token.toLowerCase()    !== expected.token.toLowerCase())    return `token mismatch`;
  if (observed.amountPerPeriod  !== expected.amountPerPeriod)  return `amountPerPeriod mismatch`;
  if (observed.periodSeconds    !== expected.periodSeconds)    return `periodSeconds mismatch`;
  if (observed.noticeSeconds    !== expected.noticeSeconds)    return `noticeSeconds mismatch`;
  if (observed.startAt          !== expected.startAt)          return `startAt mismatch`;
  if (observed.clientNonce      !== expected.clientNonce)      return `clientNonce mismatch`;
  if (observed.acceptanceDeadline !== expected.acceptanceDeadline) return `acceptanceDeadline mismatch`;
  if (observed.termsDocumentHash.toLowerCase() !== expected.termsDocumentHash.toLowerCase()) return `termsDocumentHash mismatch`;
  return null;
}

// Re-export types for test use
export type { VerifiedObservation };
