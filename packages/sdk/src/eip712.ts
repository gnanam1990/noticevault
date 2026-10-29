/**
 * @noticevault/sdk — EIP-712 typed data and signature verification
 *
 * Domain: NoticeVaultAgreement / version 1 / chainId / factory address
 * TypeHash covers all 11 canonical AgreementTerms fields in ABI order.
 *
 * No function here signs anything. All signing is done by the caller.
 * verifyProviderSignature is a pure cryptographic helper (exported for tests).
 *
 * issueProviderConsent is the production entry point for creation flows:
 *   - async, requires a MinimalPublicClient
 *   - pins provider bytecode at the same block as factoryEvidence.block
 *   - returns an opaque module-branded ConsentEvidence object
 *   - ConsentEvidence is NOT exported from index: callers cannot fabricate it
 *
 * prepareCreateAgreement (in txprep.ts) accepts ConsentEvidence only.
 * It does NOT accept VerifyResult — that prevents a plain-object bypass.
 */

import type { Hex } from "viem";
import {
  hashTypedData,
  recoverTypedDataAddress,
  isAddressEqual,
} from "viem";
import type { TermsInput, NoticeVaultDeployment, VerifyResult, FactoryObservation } from "./types.js";
import { requireFactoryAddress } from "./deployments.js";
import type { MinimalPublicClient } from "./snapshot.js";
import { _matchesFactoryDeployment } from "./snapshot.js";
import { requireFreshFactoryEvidence } from "./factory-evidence.js";
import { validateTermsInput } from "./codec.js";

// ── EIP-712 type definitions ───────────────────────────────────────────────────

/** The EIP-712 types object for AgreementTerms. */
export const AGREEMENT_TERMS_TYPES = {
  AgreementTerms: [
    { name: "schemaVersion",       type: "uint32"  },
    { name: "client",              type: "address" },
    { name: "provider",            type: "address" },
    { name: "token",               type: "address" },
    { name: "amountPerPeriod",     type: "uint256" },
    { name: "periodSeconds",       type: "uint64"  },
    { name: "noticeSeconds",       type: "uint64"  },
    { name: "startAt",             type: "uint64"  },
    { name: "clientNonce",         type: "uint256" },
    { name: "acceptanceDeadline",  type: "uint64"  },
    { name: "termsDocumentHash",   type: "bytes32" },
  ],
} as const;

// ── Domain builder ────────────────────────────────────────────────────────────

function buildDomain(dep: NoticeVaultDeployment) {
  const factory = requireFactoryAddress(dep);
  return {
    name:              "NoticeVaultAgreement",
    version:           "1",
    chainId:           Number(dep.chainId), // viem expects number
    verifyingContract: factory as `0x${string}`,
  };
}

// ── Typed data builder ────────────────────────────────────────────────────────

/**
 * Build a complete EIP-712 typed data object ready for wallet signing.
 * Compatible with viem's `signTypedData` and wagmi's `useSignTypedData`.
 * The SDK never calls either — this is only for caller use.
 */
export function buildTypedData(terms: TermsInput, dep: NoticeVaultDeployment) {
  const domain = buildDomain(dep);
  const message = {
    schemaVersion:      terms.schemaVersion,
    client:             terms.client  as `0x${string}`,
    provider:           terms.provider as `0x${string}`,
    token:              terms.token   as `0x${string}`,
    amountPerPeriod:    terms.amountPerPeriod,
    periodSeconds:      terms.periodSeconds,
    noticeSeconds:      terms.noticeSeconds,
    startAt:            terms.startAt,
    clientNonce:        terms.clientNonce,
    acceptanceDeadline: terms.acceptanceDeadline,
    termsDocumentHash:  terms.termsDocumentHash as `0x${string}`,
  };
  return {
    domain,
    types: AGREEMENT_TERMS_TYPES,
    primaryType: "AgreementTerms" as const,
    message,
  };
}

// ── Digest ────────────────────────────────────────────────────────────────────

/**
 * Compute the EIP-712 digest (hash) for the given terms and deployment.
 * Returns a 0x-prefixed hex string.
 */
export function computeTermsDigest(
  terms: TermsInput,
  dep: NoticeVaultDeployment,
): `0x${string}` {
  const td = buildTypedData(terms, dep);
  return hashTypedData({
    domain:      td.domain,
    types:       td.types,
    primaryType: td.primaryType,
    message:     td.message,
  });
}

// ── Signature verification (pure cryptographic helper) ────────────────────────

/** Verify only after explicit account-type evidence at a caller-supplied block.
 * Missing client/pin/code or failed RPC is UNKNOWN. Contract accounts always
 * use ERC1271, even when ECDSA recovery would match their address. No reads
 * fall back to latest. This helper alone does not establish canonicality or
 * freshness; production callers must validate the surrounding observation.
 */
export async function verifyProviderSignature(
  terms: TermsInput,
  dep: NoticeVaultDeployment,
  signature: Hex,
  publicClient: EIP712PublicClient | null,
  pinnedBlock?: bigint,
): Promise<VerifyResult> {
  if (!publicClient?.getBytecode || typeof pinnedBlock !== "bigint" || pinnedBlock < 0n) {
    return {status:"unknown",method:"unknown",detail:"Pinned provider account-type evidence is required"};
  }
  let bytecode:unknown;
  try { bytecode=await publicClient.getBytecode({address:terms.provider as Hex,blockNumber:pinnedBlock}); }
  catch { return {status:"unknown",method:"unknown",detail:"Provider bytecode read failed at pinned block"}; }
  if(typeof bytecode!=="string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(bytecode)) {
    return {status:"unknown",method:"unknown",detail:"Provider bytecode evidence missing or malformed"};
  }
  if(bytecode==="0x") {
    try {
      const td=buildTypedData(terms,dep);
      const recovered=await recoverTypedDataAddress({...td,signature});
      if(isAddressEqual(recovered,terms.provider as Hex)) return {status:"valid",method:"ecdsa"};
    } catch { /* Known EOA: malformed or mismatched signature is invalid. */ }
    return {status:"invalid",method:"ecdsa",detail:"Confirmed EOA signature did not match"};
  }
  const ERC1271_ABI=[{type:"function",name:"isValidSignature",inputs:[{name:"hash",type:"bytes32"},{name:"signature",type:"bytes"}],outputs:[{name:"magicValue",type:"bytes4"}],stateMutability:"view"}] as const;
  try {
    const result=await publicClient.readContract({address:terms.provider as Hex,abi:ERC1271_ABI,functionName:"isValidSignature",args:[computeTermsDigest(terms,dep),signature],blockNumber:pinnedBlock});
    if(typeof result!=="string" || !/^0x[0-9a-fA-F]{8}$/.test(result)) return {status:"unknown",method:"unknown",detail:"Malformed ERC1271 response"};
    return result.toLowerCase()==="0x1626ba7e" ? {status:"valid",method:"erc1271"} : {status:"invalid",method:"erc1271",detail:"Wrong ERC1271 magic value"};
  } catch {return {status:"unknown",method:"unknown",detail:"ERC1271 read failed at pinned block"};}
}

/** Extended public client with pinned bytecode check. */
export type EIP712PublicClient = {
  getBytecode?: (args: { address: `0x${string}`; blockNumber?: bigint }) => Promise<`0x${string}` | undefined>;
  readContract: (args: {
    address:      `0x${string}`;
    abi:          readonly unknown[];
    functionName: string;
    args:         readonly unknown[];
    blockNumber: bigint;
  }) => Promise<unknown>;
};

// ── ConsentEvidence — module-owned opaque provider consent proof ──────────────

/**
 * Opaque, module-branded proof that the provider has cryptographically consented
 * to EXACT terms at a pinned block.
 *
 * Produced ONLY by issueProviderConsent(). Cannot be fabricated or exported
 * from index — the brand WeakSet is private to this module.
 *
 * Binds:
 *   - exact terms digest (EIP-712 hash of all 11 fields)
 *   - exact signature bytes
 *   - provider address
 *   - pinned block number (from factoryEvidence)
 *   - deployment configIdentity + chainId
 *   - verify method (ecdsa | erc1271)
 */
export interface ConsentEvidence {
  /** Frozen by _brandConsent — cannot be mutated after issuance. */
  readonly _type: "ConsentEvidence";
  readonly termsDigest:     `0x${string}`;
  readonly signature:       `0x${string}`;
  readonly provider:        string;
  readonly pinnedBlock:     bigint;
  readonly configIdentity:  string;
  readonly chainId:         bigint;
  readonly method:          "ecdsa" | "erc1271";
}

const _consentFactoryEvidence = new WeakMap<object, FactoryObservation>();

/** Read-only binding check: no caller can register consent or alter its origin. */
export function _consentMatchesFactoryEvidence(
  consent: object, evidence: FactoryObservation, dep: NoticeVaultDeployment,
): boolean {
  const issued = _consentFactoryEvidence.get(consent);
  return !!issued && _matchesFactoryDeployment(issued, dep) &&
    issued.block.blockNumber === evidence.block.blockNumber &&
    issued.block.blockTimestamp === evidence.block.blockTimestamp &&
    issued.block.blockHash.toLowerCase() === evidence.block.blockHash.toLowerCase();
}

const _issuedConsents = new WeakSet<object>();

/** @internal — sets the brand and deep-freezes the evidence object. */
function _brandConsent(c: ConsentEvidence): ConsentEvidence {
  _issuedConsents.add(c as object);
  Object.freeze(c);
  return c;
}

/** Returns true iff the object was issued by issueProviderConsent. Not exported from index. */
export function _isIssuedConsent(c: object): boolean {
  return _issuedConsents.has(c);
}

/**
 * Cryptographically verify provider consent and produce opaque ConsentEvidence.
 *
 * Uses pinned bytecode from factoryEvidence (so provider code-type check is at
 * the same block as the factory state check). The returned ConsentEvidence object:
 *   - is module-branded and deep-frozen
 *   - records the exact terms digest, signature, provider, block and deployment
 *   - is the ONLY accepted proof for prepareCreateAgreement
 *
 * Returns null if verification fails (status ≠ "valid").
 * Caller may inspect verifyResult.status for details.
 *
 * @param client          MinimalPublicClient (injected; from factoryEvidence's session).
 * @param terms           Terms to verify consent for (must match what will be submitted).
 * @param dep             Deployment descriptor (chainId, factoryAddress).
 * @param signature       Provider-supplied EIP-712 signature.
 * @param factoryEvidence Fresh module-issued FactoryObservation (status must be ok).
 */
export async function issueProviderConsent(
  client: MinimalPublicClient,
  terms: TermsInput,
  dep: NoticeVaultDeployment,
  signature: `0x${string}`,
  factoryEvidence: FactoryObservation,
): Promise<{ consent: ConsentEvidence | null; verifyResult: VerifyResult }> {
  const unknown = (detail: string): { consent: null; verifyResult: VerifyResult } =>
    ({ consent: null, verifyResult: { status: "unknown", method: "unknown", detail } });
  try {
    terms = Object.freeze({ ...terms });
    dep = Object.freeze({ ...dep });
    requireFreshFactoryEvidence(factoryEvidence, dep, "issueProviderConsent");
    validateTermsInput(terms);
    const termsDigest = computeTermsDigest(terms, dep);
    if (!factoryEvidence.requestedTerms ||
        termsDigest !== computeTermsDigest(factoryEvidence.requestedTerms, dep))
      return unknown("Consent terms do not match factory evidence");
    const deadlineExpired = () => BigInt(Math.floor(Date.now() / 1000)) >= terms.acceptanceDeadline;
    if (deadlineExpired()) return unknown("Acceptance deadline has expired");
    const sameChain = async () => {
      const chain = await client.getChainId();
      return Number.isSafeInteger(chain) && chain >= 0 && BigInt(chain) === dep.chainId;
    };
    if (!await sameChain()) return unknown("Consent RPC chain mismatch");
    const pinnedBlock = factoryEvidence.block.blockNumber;
    const bridgingClient: EIP712PublicClient = {
      getBytecode: async ({ address }) => client.getBytecode({ address, blockNumber: pinnedBlock }),
      readContract: async args => client.readContract({ ...args, blockNumber: pinnedBlock }),
    };
    const verifyResult = await verifyProviderSignature(terms, dep, signature, bridgingClient, pinnedBlock);
    if (verifyResult.status !== "valid") return { consent: null, verifyResult };
    const recheck = await client.getBlock({ blockNumber: pinnedBlock });
    if (!recheck || recheck.number !== pinnedBlock ||
        recheck.timestamp !== factoryEvidence.block.blockTimestamp ||
        typeof recheck.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(recheck.hash) ||
        recheck.hash.toLowerCase() !== factoryEvidence.block.blockHash.toLowerCase())
      return unknown("Consent pinned block changed or is malformed");
    if (!await sameChain()) return unknown("Consent RPC chain changed");
    requireFreshFactoryEvidence(factoryEvidence, dep, "issueProviderConsent");
    if (deadlineExpired()) return unknown("Acceptance deadline expired during verification");
    const consent = _brandConsent({
      _type: "ConsentEvidence", termsDigest, signature, provider: terms.provider,
      pinnedBlock, configIdentity: dep.configIdentity, chainId: dep.chainId,
      method: verifyResult.method as "ecdsa" | "erc1271",
    });
    _consentFactoryEvidence.set(consent, factoryEvidence);
    return { consent, verifyResult };
  } catch {
    return unknown("Factory evidence or pinned consent verification is unavailable");
  }
}
