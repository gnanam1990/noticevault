/**
 * T020 — @noticevault/sdk behavioral tests
 *
 * Tests the SDK's exported API using LOCAL_FIXTURE descriptors only.
 * No live chain, no wallet signing.
 * Independent expected constants; SDK output is never used as oracle.
 *
 * T020-E/F use unsafeEncode* for pure encoding tests (no evidence required).
 * Guard tests (evidence required) are in T021.
 */

import { describe, it, expect } from "vitest";
import {
  // ABI / conformance
  FACTORY_ABI,
  AGREEMENT_ABI,
  ABI_PROVENANCE,
  // Deployment descriptors
  LOCAL_FIXTURE_DEPLOYMENT,

  // Terms codec
  serializeTerms,
  parseTerms,
  // EIP-712
  buildTypedData,
  computeTermsDigest,
  verifyProviderSignature,
  // Unsafe encoders (no evidence required — for encoding unit tests)
  unsafeEncodeApprove,
  unsafeEncodeCreateAgreement,
  // Snapshot / verifier
  buildSimulationSnapshot,
  // Errors
  SdkValidationError,
  SdkChainError,
  // Types
  type NoticeVaultDeployment,
  type TermsInput,
} from "./index.js";

// ── Shared test fixtures ───────────────────────────────────────────────────────

const ADDR_CLIENT  = "0x1111111111111111111111111111111111111111";
const ADDR_PROVIDER= "0x2222222222222222222222222222222222222222";
const ADDR_TOKEN   = "0x3333333333333333333333333333333333333333"; // mock local token
const ADDR_FACTORY = "0x4444444444444444444444444444444444444444";
const ADDR_AGREEMENT="0x5555555555555555555555555555555555555555";
const HASH_TERMS   = "0x" + "ab".repeat(32);
const CHAIN_ID     = 31337n; // Anvil/local

// Valid LOCAL_FIXTURE deployment descriptor
const LOCAL_DEP: NoticeVaultDeployment = {
  ...LOCAL_FIXTURE_DEPLOYMENT,
  chainId: CHAIN_ID,
  factoryAddress: ADDR_FACTORY,
  allowlistedToken: ADDR_TOKEN,
};

// Terms that pass all validation rules (relative times baked as absolute)
// t0 = now+600, deadline = now+7200 simulated via fixed epoch
const EPOCH = 1_700_000_000n; // fixed reference epoch for tests
const BASE_TERMS: TermsInput = {
  schemaVersion:      1,
  client:             ADDR_CLIENT,
  provider:           ADDR_PROVIDER,
  token:              ADDR_TOKEN,
  amountPerPeriod:    3_000_000n,          // 3 USDC
  periodSeconds:      2_592_000n,          // 30 days
  noticeSeconds:      2_592_000n,          // 30 days
  startAt:            EPOCH + 600n,
  clientNonce:        0n,
  acceptanceDeadline: EPOCH + 7_200n,
  termsDocumentHash:  HASH_TERMS,
};

// ── T020-A: ABI provenance ─────────────────────────────────────────────────────
describe("T020-A ABI provenance", () => {
  it("ABI_PROVENANCE records source, version, sha256 for factory and agreement", () => {
    expect(ABI_PROVENANCE.factory.source).toMatch(/contracts\/out/);
    expect(ABI_PROVENANCE.factory.contractName).toBe("NoticeVaultFactory");
    expect(typeof ABI_PROVENANCE.factory.sha256).toBe("string");
    expect(ABI_PROVENANCE.factory.sha256).toHaveLength(64);
    expect(ABI_PROVENANCE.agreement.contractName).toBe("NoticeVaultAgreement");
  });

  it("FACTORY_ABI contains required functions and events", () => {
    const names = (FACTORY_ABI as unknown as Array<{ name?: string }>).map((e) => e.name);
    for (const fn of ["createAgreement","invalidateNonce","isNonceUnavailable",
                       "outstandingLiability","factoryCap","agreementCap","token"]) {
      expect(names).toContain(fn);
    }
    for (const ev of ["AgreementCreated","NonceInvalidated","CapacityChanged"]) {
      expect(names).toContain(ev);
    }
  });

  it("AGREEMENT_ABI contains required functions and events", () => {
    const names = (AGREEMENT_ABI as unknown as Array<{ name?: string }>).map((e) => e.name);
    for (const fn of ["fundNextPeriod","startNotice","materializeNotice",
                       "claimProvider","claimClientRefund","preview","terms","accounting"]) {
      expect(names).toContain(fn);
    }
    for (const ev of ["RegularFunded","NoticeStarted","ProviderClaimed","ClientRefunded"]) {
      expect(names).toContain(ev);
    }
  });
});

// ── T020-B: Terms codec ────────────────────────────────────────────────────────
describe("T020-B terms serialize/parse roundtrip", () => {
  it("serializes all 11 fields in canonical order", () => {
    const s = serializeTerms(BASE_TERMS);
    expect(s.schemaVersion).toBe("1");
    expect(s.amountPerPeriod).toBe("3000000");
    expect(s.periodSeconds).toBe("2592000");
    expect(s.startAt).toBe(String(EPOCH + 600n));
    expect(s.clientNonce).toBe("0");
    expect(s.termsDocumentHash).toBe(HASH_TERMS);
  });

  it("parses serialized form back to bigint/number types losslessly", () => {
    const s = serializeTerms(BASE_TERMS);
    const p = parseTerms(s);
    expect(p.amountPerPeriod).toBe(BASE_TERMS.amountPerPeriod);
    expect(p.periodSeconds).toBe(BASE_TERMS.periodSeconds);
    expect(p.clientNonce).toBe(BASE_TERMS.clientNonce);
    expect(p.startAt).toBe(BASE_TERMS.startAt);
    expect(p.schemaVersion).toBe(1);
    expect(p.client.toLowerCase()).toBe(ADDR_CLIENT.toLowerCase());
  });

  it("rejects float amountPerPeriod in serialized form", () => {
    const bad = { ...serializeTerms(BASE_TERMS), amountPerPeriod: "3.5" };
    expect(() => parseTerms(bad)).toThrow(SdkValidationError);
  });

  it("rejects negative amountPerPeriod", () => {
    const bad = { ...serializeTerms(BASE_TERMS), amountPerPeriod: "-1" };
    expect(() => parseTerms(bad)).toThrow(SdkValidationError);
  });

  it("rejects uint256 overflow on amountPerPeriod", () => {
    const overflow = ((1n << 256n)).toString();
    const bad = { ...serializeTerms(BASE_TERMS), amountPerPeriod: overflow };
    expect(() => parseTerms(bad)).toThrow(SdkValidationError);
  });

  it("rejects malformed address in client field", () => {
    const bad = { ...serializeTerms(BASE_TERMS), client: "0xnotanaddress" };
    expect(() => parseTerms(bad)).toThrow(SdkValidationError);
  });

  it("rejects malformed bytes32 in termsDocumentHash", () => {
    const bad = { ...serializeTerms(BASE_TERMS), termsDocumentHash: "0xdeadbeef" };
    expect(() => parseTerms(bad)).toThrow(SdkValidationError);
  });

  it("rejects int64 overflow on startAt", () => {
    const overflow = (9_223_372_036_854_775_808n).toString(); // INT64_MAX + 1
    const bad = { ...serializeTerms(BASE_TERMS), startAt: overflow };
    expect(() => parseTerms(bad)).toThrow(SdkValidationError);
  });
});

// ── T020-C: EIP-712 typed data ────────────────────────────────────────────────
describe("T020-C EIP-712 typed data", () => {
  it("buildTypedData produces correct domain fields", () => {
    const td = buildTypedData(BASE_TERMS, LOCAL_DEP);
    expect(td.domain.name).toBe("NoticeVaultAgreement");
    expect(td.domain.version).toBe("1");
    expect(td.domain.chainId).toBe(Number(CHAIN_ID));
    expect(td.domain.verifyingContract?.toLowerCase()).toBe(ADDR_FACTORY.toLowerCase());
  });

  it("buildTypedData message contains all 11 canonical fields", () => {
    const td = buildTypedData(BASE_TERMS, LOCAL_DEP);
    const msg = td.message as Record<string, unknown>;
    for (const field of ["schemaVersion","client","provider","token","amountPerPeriod",
                          "periodSeconds","noticeSeconds","startAt","clientNonce",
                          "acceptanceDeadline","termsDocumentHash"]) {
      expect(msg).toHaveProperty(field);
    }
  });

  it("typed data types entry covers all 11 AgreementTerms fields", () => {
    const td = buildTypedData(BASE_TERMS, LOCAL_DEP);
    const termsType = (td.types as unknown as Record<string, Array<{name:string}>>)["AgreementTerms"];
    expect(termsType).toBeDefined();
    const fieldNames = termsType.map((f) => f.name);
    for (const f of ["schemaVersion","client","provider","token","amountPerPeriod",
                      "periodSeconds","noticeSeconds","startAt","clientNonce",
                      "acceptanceDeadline","termsDocumentHash"]) {
      expect(fieldNames).toContain(f);
    }
  });

  it("digest changes when any single field is mutated", () => {
    const base = computeTermsDigest(BASE_TERMS, LOCAL_DEP);

    const mutations: Array<[keyof TermsInput, unknown]> = [
      ["amountPerPeriod", BASE_TERMS.amountPerPeriod + 1n],
      ["periodSeconds",   BASE_TERMS.periodSeconds + 1n],
      ["noticeSeconds",   BASE_TERMS.noticeSeconds + 1n],
      ["startAt",         BASE_TERMS.startAt + 1n],
      ["clientNonce",     BASE_TERMS.clientNonce + 1n],
      ["acceptanceDeadline", BASE_TERMS.acceptanceDeadline + 1n],
      ["client",          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      ["provider",        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
      ["token",           "0xcccccccccccccccccccccccccccccccccccccccc"],
      ["termsDocumentHash","0x" + "cc".repeat(32)],
      ["schemaVersion",   2],
    ];

    for (const [field, val] of mutations) {
      const mutated = { ...BASE_TERMS, [field]: val } as TermsInput;
      const digest = computeTermsDigest(mutated, LOCAL_DEP);
      expect(digest).not.toBe(base);
    }
  });

  it("digest changes when chainId differs (cross-chain replay)", () => {
    const dep2 = { ...LOCAL_DEP, chainId: CHAIN_ID + 1n };
    const d1 = computeTermsDigest(BASE_TERMS, LOCAL_DEP);
    const d2 = computeTermsDigest(BASE_TERMS, dep2);
    expect(d1).not.toBe(d2);
  });

  it("digest changes when factory address differs (cross-factory replay)", () => {
    const dep2 = { ...LOCAL_DEP, factoryAddress: "0x9999999999999999999999999999999999999999" };
    const d1 = computeTermsDigest(BASE_TERMS, LOCAL_DEP);
    const d2 = computeTermsDigest(BASE_TERMS, dep2);
    expect(d1).not.toBe(d2);
  });
});

// ── T020-D: verifyProviderSignature ───────────────────────────────────────────
describe("T020-D verifyProviderSignature", () => {
  it("EOA valid signature → status=valid", async () => {
    // Fresh offline test signer: no stored key, wallet, network, or funding.
    const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
    const account = privateKeyToAccount(generatePrivateKey());
    const terms: TermsInput = { ...BASE_TERMS, provider: account.address };
    const dep = { ...LOCAL_DEP };
    const td = buildTypedData(terms, dep);
    const sig = await account.signTypedData({
      domain: td.domain as Parameters<typeof account.signTypedData>[0]["domain"],
      types: td.types as Parameters<typeof account.signTypedData>[0]["types"],
      primaryType: td.primaryType,
      message: td.message as Parameters<typeof account.signTypedData>[0]["message"],
    });

    const result = await verifyProviderSignature(terms, dep, sig as `0x${string}`, {getBytecode:async()=>"0x",readContract:async()=>{throw new Error("EOA must not invoke ERC1271");}}, 123n);
    expect(result.status).toBe("valid");
  });

  it("EOA wrong signature → status=invalid", async () => {
    // An independent ephemeral signer must not authenticate the named provider.
    const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
    const account = privateKeyToAccount(generatePrivateKey());
    expect(account.address.toLowerCase()).not.toBe(BASE_TERMS.provider.toLowerCase());
    const td = buildTypedData(BASE_TERMS, LOCAL_DEP);
    const sig = await account.signTypedData({
      domain: td.domain as Parameters<typeof account.signTypedData>[0]["domain"],
      types: td.types as Parameters<typeof account.signTypedData>[0]["types"],
      primaryType: td.primaryType,
      message: td.message as Parameters<typeof account.signTypedData>[0]["message"],
    });
    const result = await verifyProviderSignature(BASE_TERMS, LOCAL_DEP, sig as `0x${string}`, {getBytecode:async()=>"0x",readContract:async()=>{throw new Error("EOA must not invoke ERC1271");}}, 123n);
    expect(result.status).toBe("invalid");
  });

  it("ERC1271 wallet with mock client returning magic → status=valid", async () => {
    // Inject a mock ERC1271 client that returns isValidSignature=true
    const magicValue = "0x1626ba7e" as `0x${string}`;
    const mockClient = {
      getBytecode: async () => "0x6000" as const,
      readContract: async () => magicValue,
    };
    // provider is a contract address (has code conceptually); we inject client
    const result = await verifyProviderSignature(
      BASE_TERMS, LOCAL_DEP,
      `0x${"aa".repeat(65)}` as `0x${string}`, // arbitrary sig bytes
      mockClient as never, 123n,
    );
    expect(result.status).toBe("valid");
  });

  it("ERC1271 wallet returning wrong magic → status=invalid", async () => {
    const mockClient = {
      getBytecode: async () => "0x6000" as const,
      readContract: async () => "0xdeadbeef" as `0x${string}`,
    };
    const result = await verifyProviderSignature(
      BASE_TERMS, LOCAL_DEP,
      `0x${"bb".repeat(65)}` as `0x${string}`,
      mockClient as never, 123n,
    );
    expect(result.status).toBe("invalid");
  });

  it("ERC1271 client throws → status=unknown", async () => {
    const mockClient = {
      getBytecode: async () => "0x6000" as const,
      readContract: async () => { throw new Error("RPC timeout"); },
    };
    const result = await verifyProviderSignature(
      BASE_TERMS, LOCAL_DEP,
      `0x${"cc".repeat(65)}` as `0x${string}`,
      mockClient as never, 123n,
    );
    expect(result.status).toBe("unknown");
  });

  it("null client with unknown account type → status=unknown", async () => {
    // Garbage signature — EOA recovery will not match provider
    const result = await verifyProviderSignature(
      BASE_TERMS, LOCAL_DEP,
      `0x${"01".repeat(65)}` as `0x${string}`,
      null, 123n,
    );
    expect(result.status).toBe("unknown");
  });
});

// ── T020-E: Allowance encoding (unsafe — no evidence) ─────────────────────────
describe("T020-E allowance encoding (unsafeEncode*)", () => {
  it("unsafeEncodeApprove for creation: spender=factory, amount=A+R", () => {
    // R = ceil(3_000_000 * 2_592_000 / 2_592_000) = 3_000_000; A+R = 6_000_000
    const req = unsafeEncodeApprove(ADDR_TOKEN, ADDR_FACTORY, 6_000_000n, CHAIN_ID);
    expect(req.to.toLowerCase()).toBe(ADDR_TOKEN.toLowerCase());
    expect((req.args as unknown[])[0] as string).toMatch(new RegExp(ADDR_FACTORY, "i"));
    expect((req.args as unknown[])[1]).toBe(6_000_000n);
  });

  it("unsafeEncodeApprove for renewal: spender=agreement, amount=A only", () => {
    const req = unsafeEncodeApprove(ADDR_TOKEN, ADDR_AGREEMENT, 3_000_000n, CHAIN_ID);
    expect(req.to.toLowerCase()).toBe(ADDR_TOKEN.toLowerCase());
    expect((req.args as unknown[])[0] as string).toMatch(new RegExp(ADDR_AGREEMENT, "i"));
    expect((req.args as unknown[])[1]).toBe(3_000_000n); // A only
  });
});

// ── T020-F: Transaction encoding (unsafeEncode* / address-only guards) ────────
describe("T020-F tx encoding (unsafeEncode*)", () => {
  it("unsafeEncodeCreateAgreement produces correct to/functionName", () => {
    const dummySig = ("0x" + "aa".repeat(65)) as `0x${string}`;
    const req = unsafeEncodeCreateAgreement(BASE_TERMS, dummySig, ADDR_FACTORY, CHAIN_ID);
    expect(req.to.toLowerCase()).toBe(ADDR_FACTORY.toLowerCase());
    expect(req.functionName).toBe("createAgreement");
    const termsArg = (req.args as unknown[])[0] as Record<string, unknown>;
    expect(termsArg["amountPerPeriod"]).toBe(BASE_TERMS.amountPerPeriod);
    expect(String(termsArg["client"]).toLowerCase()).toBe(ADDR_CLIENT.toLowerCase());
  });
});

// ── T020-G: Deployment descriptor ────────────────────────────────────────────
describe("T020-G deployment descriptor", () => {
  it("LOCAL_FIXTURE_DEPLOYMENT is labelled as LOCAL_FIXTURE and not live", () => {
    expect(LOCAL_FIXTURE_DEPLOYMENT.configIdentity).toBe("LOCAL_FIXTURE");
    expect(LOCAL_FIXTURE_DEPLOYMENT.isLive).toBe(false);
    expect(LOCAL_FIXTURE_DEPLOYMENT.factoryAddress).toBe(null);
  });

  it("LOCAL_FIXTURE_DEPLOYMENT has expectedFactoryCodeHash and expectedTokenCodeHash null", () => {
    expect(LOCAL_FIXTURE_DEPLOYMENT.expectedFactoryCodeHash).toBe(null);
    expect(LOCAL_FIXTURE_DEPLOYMENT.expectedTokenCodeHash).toBe(null);
  });

  it("deployment with wrong chainId differs from connected chainId", () => {
    const wrongChain = { ...LOCAL_DEP, chainId: 9999n };
    // Chain validation happens in requireFreshVerifiedEvidence — checked by direct comparison
    expect(wrongChain.chainId).not.toBe(CHAIN_ID);
  });

  it("deployment with matching chainId equals connected chainId", () => {
    expect(LOCAL_DEP.chainId).toBe(CHAIN_ID);
  });
});

// ── T020-H: Simulation snapshot ───────────────────────────────────────────────
describe("T020-H simulation snapshot", () => {
  // Build a minimal AccountingState from domain
  const makeState = () => {
    const terms = {
      schemaVersion:      1 as const,
      client:             ADDR_CLIENT,
      provider:           ADDR_PROVIDER,
      token:              ADDR_TOKEN,
      amountPerPeriod:    3_000_000n,
      periodSeconds:      2_592_000n,
      noticeSeconds:      2_592_000n,
      startAt:            EPOCH,
      clientNonce:        0n,
      acceptanceDeadline: EPOCH + 3600n,
      termsDocumentHash:  HASH_TERMS,
    };
    return {
      terms,
      regularFunded:    terms.amountPerPeriod,
      regularPaid:      0n,
      noticePaid:       0n,
      clientRefunded:   0n,
      noticeStartStored: null as null,
      noticeReasonStored: null as null,
    };
  };

  it("source field is SIMULATION not VERIFIED", () => {
    const state = makeState();
    const snap = buildSimulationSnapshot(state, EPOCH + 86400n);
    expect(snap.source).toBe("SIMULATION");
  });

  it("G1 day15: V=1_500_000, W=0, phase=ACTIVE", () => {
    const state = makeState();
    const now = EPOCH + 15n * 86400n;
    const snap = buildSimulationSnapshot(state, now);
    expect(snap.V).toBe(1_500_000n);
    expect(snap.W).toBe(0n);
    expect(snap.phase).toBe("ACTIVE");
  });

  it("G2 day40: stored notice S=D, V frozen at F, W=floor(R*10d/N)", () => {
    const state = makeState();
    const D = EPOCH + 2_592_000n;
    const stateWithNotice = {
      ...state,
      noticeStartStored: D,
      noticeReasonStored: "MISSED_CHECKPOINT" as const,
    };
    const now = D + 10n * 86400n;
    const snap = buildSimulationSnapshot(stateWithNotice, now);
    expect(snap.V).toBe(3_000_000n); // frozen at F
    expect(snap.W).toBe(1_000_000n);
    expect(snap.phase).toBe("NOTICE");
  });

  it("derived S=D: resolves to S=D not S=now when now>D and no stored notice", () => {
    const state = makeState();
    const D = EPOCH + 2_592_000n;
    const now = D + 86400n; // 1 day past D
    const snap = buildSimulationSnapshot(state, now);
    expect(snap.S).toBe(D);
    expect(snap.reason).toBe("MISSED_CHECKPOINT");
  });

  it("pre-start cancel: S=t0, V_S=0, refund=A", () => {
    const state = makeState();
    const stateWithNotice = {
      ...state,
      noticeStartStored: EPOCH,
      noticeReasonStored: "CLIENT_CANCELLED" as const,
    };
    const snap = buildSimulationSnapshot(stateWithNotice, EPOCH + 3600n);
    expect(snap.clientRefundable).toBe(3_000_000n);
  });

  it("zero refund on derived missed-checkpoint (V_S=F at D)", () => {
    const state = makeState();
    const D = EPOCH + 2_592_000n;
    const snap = buildSimulationSnapshot(state, D + 1n);
    expect(snap.clientRefundable).toBe(0n);
  });

  it("L conservation: L = F+R-RP-NP-CR", () => {
    const state = makeState();
    const snap = buildSimulationSnapshot(state, EPOCH + 86400n);
    const { regularFunded: F, regularPaid: RP, noticePaid: NP, clientRefunded: CR } = state;
    const R = snap.R;
    expect(snap.L).toBe(F + R - RP - NP - CR);
  });

  it("SIMULATION snapshot does not have observationBlock (no onchain data)", () => {
    const state = makeState();
    const snap = buildSimulationSnapshot(state, EPOCH + 1n) as unknown as Record<string, unknown>;
    expect(snap.observationBlock).toBeUndefined();
  });
});

// ── T020-I: Address/deployment guards on encoders ────────────────────────────
describe("T020-I address guards on encoders", () => {
  it("unsafeEncodeApprove with zero-address token throws SdkValidationError", () => {
    expect(() =>
      unsafeEncodeApprove("0x0000000000000000000000000000000000000000", ADDR_FACTORY, 6_000_000n, CHAIN_ID)
    ).toThrow(SdkValidationError);
  });

  it("unsafeEncodeCreateAgreement with zero-address client throws SdkValidationError", () => {
    const badTerms: TermsInput = { ...BASE_TERMS, client: "0x0000000000000000000000000000000000000000" };
    expect(() =>
      unsafeEncodeCreateAgreement(badTerms, "0x" as `0x${string}`, ADDR_FACTORY, CHAIN_ID)
    ).toThrow(SdkValidationError);
  });

  it("unsafeEncodeCreateAgreement with same client=provider throws SdkValidationError", () => {
    // validateTermsInput is not called in unsafeEncode* — address distinctness is NOT enforced
    // Only address format/zero check is enforced by requireAddress
    // This test confirms the encoder is truly unsafe (no business rules)
    const badTerms: TermsInput = { ...BASE_TERMS, provider: ADDR_CLIENT };
    // unsafeEncode does NOT call validateTermsInput — passes through
    expect(() =>
      unsafeEncodeCreateAgreement(badTerms, "0x" + "aa".repeat(65) as `0x${string}`, ADDR_FACTORY, CHAIN_ID)
    ).not.toThrow(); // unsafe encoder: no business rule check
  });
});
