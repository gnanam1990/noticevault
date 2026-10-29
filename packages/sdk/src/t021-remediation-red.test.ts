/**
 * T021 — M03 Remediation behavioral tests
 *
 * Originally written as RED (asserting the wrong current behavior).
 * After fixes are applied, every test in this file asserts the CORRECT behavior.
 *
 * The DEFECT comments explain what was wrong; the actual assertions now pass.
 *
 * No live chain, no wallet signing. LOCAL_FIXTURE descriptors only.
 */

import { describe, it, expect } from "vitest";
import {
  validateTermsInput,
  buildSimulationSnapshot,
  prepareStartNotice,
  prepareClaimProvider,
  prepareClaimClientRefund,
  prepareMaterializeNotice,
  SdkValidationError,
  SdkStateError,
  LOCAL_FIXTURE_DEPLOYMENT,

} from "./index.js";
import type { TermsInput, VerifiedObservation } from "./types.js";
import { _isIssuedObservation } from "./types.js";
import { observeAgreement } from "./snapshot.js";
import type { MinimalPublicClient } from "./snapshot.js";

// ── Shared fixtures ────────────────────────────────────────────────────────────

const ADDR_CLIENT   = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const ADDR_PROVIDER = "0x2222222222222222222222222222222222222222" as `0x${string}`;
const ADDR_TOKEN    = "0x3333333333333333333333333333333333333333" as `0x${string}`;
const ADDR_FACTORY  = "0x4444444444444444444444444444444444444444" as `0x${string}`;
const ADDR_AGMT     = "0x5555555555555555555555555555555555555555" as `0x${string}`;
const HASH_TERMS    = "0x" + "ab".repeat(32) as `0x${string}`;
const CHAIN_ID      = 31337n;

// Deployment with expectedFactoryCodeHash/expectedTokenCodeHash set
// (required for verifier to proceed past step 4)
const FACTORY_CODE_HASH = "0x" + "de".repeat(32) as `0x${string}`;
const _TOKEN_CODE_HASH  = "0x" + "ef".repeat(32) as `0x${string}`; void _TOKEN_CODE_HASH;
const FACTORY_BYTECODE  = "0x" + "de".repeat(100); // hash = keccak256 of this
const TOKEN_BYTECODE    = "0x" + "ef".repeat(100);

// Compute expected hashes from bytecodes so tests use consistent values
import { keccak256 } from "viem";
const ACTUAL_FACTORY_HASH = keccak256(FACTORY_BYTECODE as `0x${string}`);
const ACTUAL_TOKEN_HASH   = keccak256(TOKEN_BYTECODE as `0x${string}`);

const LOCAL_DEP_NO_HASH = {
  ...LOCAL_FIXTURE_DEPLOYMENT,
  chainId:          CHAIN_ID,
  factoryAddress:   ADDR_FACTORY,
  allowlistedToken: ADDR_TOKEN,
  // expectedFactoryCodeHash and expectedTokenCodeHash remain null (LOCAL_FIXTURE default)
};

const LOCAL_DEP_WITH_HASH = {
  ...LOCAL_FIXTURE_DEPLOYMENT,
  chainId:                 CHAIN_ID,
  factoryAddress:          ADDR_FACTORY,
  allowlistedToken:        ADDR_TOKEN,
  expectedFactoryCodeHash: ACTUAL_FACTORY_HASH,
  expectedTokenCodeHash:   ACTUAL_TOKEN_HASH,
};

const BASE_TERMS: TermsInput = {
  schemaVersion:      1,
  client:             ADDR_CLIENT,
  provider:           ADDR_PROVIDER,
  token:              ADDR_TOKEN,
  amountPerPeriod:    3_000_000n,
  periodSeconds:      2_592_000n,
  noticeSeconds:      2_592_000n,
  startAt:            1_700_001_000n,
  clientNonce:        0n,
  acceptanceDeadline: 1_700_008_000n,
  termsDocumentHash:  HASH_TERMS,
};

// ── Helpers to build a full passing mock client ───────────────────────────────

function makeFullPassingClient(): MinimalPublicClient {
  let blockCallCount = 0;
  return {
    getChainId: async () => 31337,
    getBlock: async (args: { blockTag?: string; blockNumber?: bigint }) => {
      void args;
      blockCallCount++;
      return { number: 100n, hash: ("0x" + "ab".repeat(32)) as `0x${string}`, timestamp: 1_700_000_000n };
    },
    getBytecode: async (args: { address: `0x${string}`; blockNumber: bigint }) => {
      if (args.address.toLowerCase() === ADDR_FACTORY.toLowerCase())
        return FACTORY_BYTECODE as `0x${string}`;
      if (args.address.toLowerCase() === ADDR_TOKEN.toLowerCase())
        return TOKEN_BYTECODE as `0x${string}`;
      return "0x6001" as `0x${string}`; // agreement also has code
    },
    readContract: async (args: { functionName: string; address?: `0x${string}` }) => {
      const fn = args.functionName;
      if (fn === "registeredAgreement") return true;
      if (fn === "token") return ADDR_TOKEN;
      if (fn === "factoryCap") return 100_000_000n;
      if (fn === "agreementCap") return 50_000_000n;
      if (fn === "outstandingLiability") return 0n;
      if (fn === "creationPaused") return false;
      if (fn === "terms") return [
        1, ADDR_CLIENT, ADDR_PROVIDER, ADDR_TOKEN,
        3_000_000n, 2_592_000n, 2_592_000n, 1_700_001_000n, 0n, 1_700_008_000n, HASH_TERMS,
      ];
      // accounting: valid state (CR=0, no notice). L = F+R-RP-NP-CR = 3e6+3e6 = 6e6
      if (fn === "accounting") return [3_000_000n, 0n, 0n, 0n, 3_000_000n, false, 0n, 0, 6_000_000n];
      // preview: consistent with domain
      if (fn === "preview") return {
        observationTimestamp: 1_700_000_000n,
        phase: 0, R: 3_000_000n,
        D: 1_700_001_000n + 2_592_000n, // t0 + P
        hasStoredNotice_: false, S: 0n, E: 0n, reason: 0,
        V: 0n, W: 0n,
        RP: 0n, NP: 0n,
        providerClaimable: 0n, clientRefundable: 0n,
        // noticeRemaining = R - NP = 3_000_000 - 0 = 3_000_000
        L: 6_000_000n, noticeRemaining: 3_000_000n,
      };
      if (fn === "balanceOf") return 6_000_000n; // >= L
      if (fn === "allowance") return 0n;
      return null;
    },
  };
}

// ── T021-A: codec overflow in both directions (FIXED) ────────────────────────

describe("T021-A codec overflow: exact both directions (fixed)", () => {
  it("valid A above UINT256_MAX/3 with N < P is now accepted (was incorrectly rejected)", () => {
    // DEFECT WAS: UINT256_MAX/3 guard rejected valid combinations.
    // FIX: Use exact computeR + safeAddUint256. R = ceil(bigA * 3600 / 2_678_400) is tiny.
    const bigA = (((1n << 256n) - 1n) / 3n) + 1n;
    const terms: TermsInput = {
      ...BASE_TERMS,
      amountPerPeriod: bigA,
      noticeSeconds:   3_600n,     // N_MIN — small N
      periodSeconds:   2_678_400n, // P_MAX — large P → R is tiny
    };
    // After fix: must NOT throw
    expect(() => validateTermsInput(terms)).not.toThrow();
  });

  it("A below UINT256_MAX/3 with very large N/P overflow now rejected (was incorrectly accepted)", () => {
    // DEFECT WAS: UINT256_MAX/3 guard did not catch overflow when N >> P.
    // A = UINT256_MAX/4, N = 7_776_000 (N_MAX), P = 3600 (P_MIN)
    // R = ceil(A * 7_776_000 / 3600) = ceil(A * 2160) >> UINT256_MAX → overflow
    const A = ((1n << 256n) - 1n) / 4n;
    const terms: TermsInput = {
      ...BASE_TERMS,
      amountPerPeriod: A,
      noticeSeconds:   7_776_000n, // N_MAX
      periodSeconds:   3_600n,     // P_MIN → huge R
    };
    // After fix: must throw SdkValidationError (overflow caught by computeR + safeAddUint256)
    expect(() => validateTermsInput(terms)).toThrow(SdkValidationError);
  });
});

// ── T021-B: observeAgreement fail-closed on cap RPC failure (FIXED) ──────────

describe("T021-B observeAgreement fail-closed on required reads (fixed)", () => {
  function makeMockClientCapFails(): MinimalPublicClient {
    return {
      getChainId: async () => 31337,
      getBlock: async () => ({ number: 100n, hash: ("0x" + "ab".repeat(32)) as `0x${string}`, timestamp: 1_700_000_000n }),
      getBytecode: async (args: { address: `0x${string}` }) => {
        if (args.address.toLowerCase() === ADDR_FACTORY.toLowerCase())
          return FACTORY_BYTECODE as `0x${string}`;
        if (args.address.toLowerCase() === ADDR_TOKEN.toLowerCase())
          return TOKEN_BYTECODE as `0x${string}`;
        return "0x6001" as `0x${string}`;
      },
      readContract: async (args: { functionName: string }) => {
        const fn = args.functionName;
        if (fn === "registeredAgreement") return true;
        if (fn === "token") return ADDR_TOKEN;
        // FAIL on cap reads
        if (fn === "factoryCap" || fn === "agreementCap" ||
            fn === "outstandingLiability" || fn === "creationPaused") {
          throw new Error("RPC timeout on cap read");
        }
        return null;
      },
    };
  }

  it("cap RPC failure now returns rpc_failure (was incorrectly ok)", async () => {
    const client = makeMockClientCapFails();
    const result = await observeAgreement(client, LOCAL_DEP_WITH_HASH, ADDR_AGMT);
    // After fix: rpc_failure (not ok)
    expect(result.status).toBe("rpc_failure");
  });
});

// ── T021-C: reorg recheck failure returns rpc_failure (FIXED) ────────────────

describe("T021-C failed reorg recheck is rpc_failure not ok (fixed)", () => {
  function makeMockClientReorgRecheckFails(): MinimalPublicClient {
    let blockCallCount = 0;
    return {
      getChainId: async () => 31337,
      getBlock: async (_args: { blockTag?: string; blockNumber?: bigint }) => {
        blockCallCount++;
        if (blockCallCount === 1) {
          return { number: 100n, hash: ("0x" + "ab".repeat(32)) as `0x${string}`, timestamp: 1_700_000_000n };
        }
        throw new Error("RPC failure on recheck");
      },
      getBytecode: async (args: { address: `0x${string}` }) => {
        if (args.address.toLowerCase() === ADDR_FACTORY.toLowerCase())
          return FACTORY_BYTECODE as `0x${string}`;
        if (args.address.toLowerCase() === ADDR_TOKEN.toLowerCase())
          return TOKEN_BYTECODE as `0x${string}`;
        return "0x6001" as `0x${string}`;
      },
      readContract: async (args: { functionName: string }) => {
        const fn = args.functionName;
        if (fn === "registeredAgreement") return true;
        if (fn === "token") return ADDR_TOKEN;
        if (fn === "factoryCap") return 100_000_000n;
        if (fn === "agreementCap") return 50_000_000n;
        if (fn === "outstandingLiability") return 0n;
        if (fn === "creationPaused") return false;
        if (fn === "terms") return [
          1, ADDR_CLIENT, ADDR_PROVIDER, ADDR_TOKEN,
          3_000_000n, 2_592_000n, 2_592_000n, 1_700_001_000n, 0n, 1_700_008_000n, HASH_TERMS,
        ];
        // L = F+R-RP-NP-CR = 3e6+3e6 = 6e6
        if (fn === "accounting") return [3_000_000n, 0n, 0n, 0n, 3_000_000n, false, 0n, 0, 6_000_000n];
        if (fn === "preview") return {
          observationTimestamp: 1_700_000_000n, phase: 0, R: 3_000_000n,
          D: 1_700_001_000n + 2_592_000n,
          hasStoredNotice_: false, S: 0n, E: 0n, reason: 0,
          V: 0n, W: 0n, RP: 0n, NP: 0n,
          providerClaimable: 0n, clientRefundable: 0n,
          // noticeRemaining = R - NP = 3_000_000 - 0 = 3_000_000 (verified from contract source)
          L: 6_000_000n, noticeRemaining: 3_000_000n,
        };
        if (fn === "balanceOf") return 6_000_000n;
        if (fn === "allowance") return 0n;
        return null;
      },
    };
  }

  it("reorg recheck RPC failure now returns rpc_failure (was incorrectly ok)", async () => {
    const client = makeMockClientReorgRecheckFails();
    const result = await observeAgreement(client, LOCAL_DEP_WITH_HASH, ADDR_AGMT);
    // After fix: rpc_failure
    expect(result.status).toBe("rpc_failure");
  });
});

// ── T021-D: missing expected code hash → deployment_unknown (FIXED) ──────────

describe("T021-D missing expected code hash gives deployment_unknown (fixed)", () => {
  it("LOCAL_FIXTURE_DEPLOYMENT now has expectedFactoryCodeHash=null field", () => {
    // After fix: field exists (is null)
    expect("expectedFactoryCodeHash" in LOCAL_FIXTURE_DEPLOYMENT).toBe(true);
    expect(LOCAL_FIXTURE_DEPLOYMENT.expectedFactoryCodeHash).toBe(null);
  });

  it("observeAgreement with null expectedFactoryCodeHash returns deployment_unknown", async () => {
    const client = makeFullPassingClient();
    // LOCAL_DEP_NO_HASH has null code hashes
    const result = await observeAgreement(client, LOCAL_DEP_NO_HASH, ADDR_AGMT);
    expect(result.status).toBe("deployment_unknown");
    expect(result.statusDetail).toMatch(/expectedFactoryCodeHash/);
  });

  it("observeAgreement with matching code hashes proceeds past step 4", async () => {
    const client = makeFullPassingClient();
    const result = await observeAgreement(client, LOCAL_DEP_WITH_HASH, ADDR_AGMT);
    // Must NOT be deployment_unknown or code_hash_mismatch
    expect(result.status).not.toBe("deployment_unknown");
    expect(result.status).not.toBe("code_hash_mismatch");
  });

  it("observeAgreement with wrong expectedFactoryCodeHash returns code_hash_mismatch", async () => {
    const client = makeFullPassingClient();
    const wrongHashDep = { ...LOCAL_DEP_WITH_HASH, expectedFactoryCodeHash: "0x" + "aa".repeat(32) as `0x${string}` };
    const result = await observeAgreement(client, wrongHashDep, ADDR_AGMT);
    expect(result.status).toBe("code_hash_mismatch");
    expect(result.statusDetail).toMatch(/Factory code hash mismatch/);
  });
});

// ── T021-E: domain malformed-state throw → accounting_mismatch (FIXED) ───────

describe("T021-E domain MalformedStateError → accounting_mismatch (fixed)", () => {
  function makeMockClientDomainMismatch(): MinimalPublicClient {
    return {
      getChainId: async () => 31337,
      getBlock: async () => ({ number: 100n, hash: ("0x" + "de".repeat(32)) as `0x${string}`, timestamp: 1_700_000_000n }),
      getBytecode: async (args: { address: `0x${string}` }) => {
        if (args.address.toLowerCase() === ADDR_FACTORY.toLowerCase())
          return FACTORY_BYTECODE as `0x${string}`;
        if (args.address.toLowerCase() === ADDR_TOKEN.toLowerCase())
          return TOKEN_BYTECODE as `0x${string}`;
        return "0x6001" as `0x${string}`;
      },
      readContract: async (args: { functionName: string }) => {
        const fn = args.functionName;
        if (fn === "registeredAgreement") return true;
        if (fn === "token") return ADDR_TOKEN;
        if (fn === "factoryCap") return 100_000_000n;
        if (fn === "agreementCap") return 50_000_000n;
        if (fn === "outstandingLiability") return 0n;
        if (fn === "creationPaused") return false;
        if (fn === "terms") return [
          1, ADDR_CLIENT, ADDR_PROVIDER, ADDR_TOKEN,
          3_000_000n, 2_592_000n, 2_592_000n, 1_700_001_000n, 0n, 1_700_008_000n, HASH_TERMS,
        ];
        // accounting: CR=1n but no stored notice → MalformedStateError
        if (fn === "accounting") return [3_000_000n, 0n, 0n, 1n, 3_000_000n, false, 0n, 0, 2_999_999n];
        return null;
      },
    };
  }

  it("domain MalformedStateError now returns accounting_mismatch (was ok)", async () => {
    const client = makeMockClientDomainMismatch();
    const result = await observeAgreement(client, LOCAL_DEP_WITH_HASH, ADDR_AGMT);
    // After fix: accounting_mismatch (domain threw MalformedStateError)
    expect(result.status).toBe("accounting_mismatch");
  });
});

// ── T021-F: fabricated evidence rejected by brand check (FIXED) ──────────────

describe("T021-F fabricated evidence rejected by brand check (fixed)", () => {
  it("hand-constructed VerifiedObservation fails _isIssuedObservation check", () => {
    const fabricated = {
      source:         "VERIFIED" as const,
      configIdentity: "LOCAL_FIXTURE" as const,
      status:         "ok" as const,
      block: {
        chainId:        CHAIN_ID,
        blockNumber:    100n,
        blockHash:      "0xaaa" as `0x${string}`,
        blockTimestamp: 1_700_000_000n,
        observedAt:     Date.now(),
      },
      hasStoredNotice: false,
    };
    // After fix: fabricated object is not in the brand registry
    expect(_isIssuedObservation(fabricated)).toBe(false);
  });

  it("fabricated evidence causes prepareClaimProvider to throw SdkStateError", () => {
    const fabricated = {
      source:         "VERIFIED" as const,
      configIdentity: "LOCAL_FIXTURE" as const,
      status:         "ok" as const,
      block: {
        chainId:        CHAIN_ID,
        blockNumber:    100n,
        blockHash:      "0xaaa" as `0x${string}`,
        blockTimestamp: 1_700_000_000n,
        observedAt:     Date.now(),
      },
      hasStoredNotice: false,
    };
    // After fix: throws because evidence is not module-issued
    expect(() =>
      prepareClaimProvider(ADDR_AGMT, LOCAL_DEP_NO_HASH, fabricated as VerifiedObservation, { account: ADDR_CLIENT, chainId: LOCAL_DEP_NO_HASH.chainId })
    ).toThrow(SdkStateError);
  });
});

// ── T021-G: prepareStartNotice requires evidence + derives client from it (FIXED) ──

describe("T021-G startNotice requires evidence, client from observedTerms (fixed)", () => {
  it("prepareStartNotice without evidence now throws SdkStateError", () => {
    // After fix: evidence is mandatory — calling without evidence throws
    // (TypeScript also prevents this at compile time now)
    // Test via the runtime guard: pass a fabricated (unbranded) object
    const fabricated = {
      source:         "VERIFIED" as const,
      configIdentity: "LOCAL_FIXTURE" as const,
      status:         "ok" as const,
      block: { chainId: CHAIN_ID, blockNumber: 100n, blockHash: "0xaaa" as `0x${string}`, blockTimestamp: 1_700_000_000n, observedAt: Date.now() },
      hasStoredNotice: false,
      observedTerms: { client: ADDR_CLIENT, provider: ADDR_PROVIDER, token: ADDR_TOKEN,
        amountPerPeriod: 3_000_000n, periodSeconds: 2_592_000n, noticeSeconds: 2_592_000n,
        startAt: 1_700_001_000n, clientNonce: 0n, acceptanceDeadline: 1_700_008_000n,
        termsDocumentHash: HASH_TERMS, schemaVersion: 1 as const },
    };
    expect(() =>
      prepareStartNotice(ADDR_AGMT, LOCAL_DEP_NO_HASH, fabricated as VerifiedObservation, ADDR_CLIENT, { account: ADDR_CLIENT, chainId: LOCAL_DEP_NO_HASH.chainId })
    ).toThrow(SdkStateError); // fabricated evidence rejected
  });
});

// ── T021-H: permissionless prepares require mandatory evidence (FIXED) ────────

describe("T021-H permissionless prepares now require mandatory evidence (fixed)", () => {
  it("prepareMaterializeNotice signature now requires evidence argument", () => {
    // TypeScript enforces this at compile time.
    // Runtime: fabricated (unbranded) evidence throws SdkStateError
    const fabricated = {
      source:         "VERIFIED" as const,
      configIdentity: "LOCAL_FIXTURE" as const,
      status:         "ok" as const,
      block: { chainId: CHAIN_ID, blockNumber: 100n, blockHash: "0xaaa" as `0x${string}`, blockTimestamp: 1_700_000_000n, observedAt: Date.now() },
    };
    expect(() =>
      prepareMaterializeNotice(ADDR_AGMT, LOCAL_DEP_NO_HASH, fabricated as VerifiedObservation, { account: ADDR_CLIENT, chainId: LOCAL_DEP_NO_HASH.chainId })
    ).toThrow(SdkStateError);
  });

  it("prepareClaimProvider requires evidence — fabricated throws", () => {
    const fabricated = {
      source:         "VERIFIED" as const,
      configIdentity: "LOCAL_FIXTURE" as const,
      status:         "ok" as const,
      block: { chainId: CHAIN_ID, blockNumber: 100n, blockHash: "0xaaa" as `0x${string}`, blockTimestamp: 1_700_000_000n, observedAt: Date.now() },
    };
    expect(() =>
      prepareClaimProvider(ADDR_AGMT, LOCAL_DEP_NO_HASH, fabricated as VerifiedObservation, { account: ADDR_CLIENT, chainId: LOCAL_DEP_NO_HASH.chainId })
    ).toThrow(SdkStateError);
  });

  it("prepareClaimClientRefund requires evidence — fabricated throws", () => {
    const fabricated = {
      source:         "VERIFIED" as const,
      configIdentity: "LOCAL_FIXTURE" as const,
      status:         "ok" as const,
      block: { chainId: CHAIN_ID, blockNumber: 100n, blockHash: "0xaaa" as `0x${string}`, blockTimestamp: 1_700_000_000n, observedAt: Date.now() },
    };
    expect(() =>
      prepareClaimClientRefund(ADDR_AGMT, LOCAL_DEP_NO_HASH, fabricated as VerifiedObservation, { account: ADDR_CLIENT, chainId: LOCAL_DEP_NO_HASH.chainId })
    ).toThrow(SdkStateError);
  });
});

// ── T021-I: token balance read failure is fatal (FIXED) ──────────────────────

describe("T021-I token balance read failure is fatal (fixed)", () => {
  function makeMockClientBalanceFails(): MinimalPublicClient {
    return {
      getChainId: async () => 31337,
      getBlock: async () => ({ number: 100n, hash: ("0x" + "ab".repeat(32)) as `0x${string}`, timestamp: 1_700_000_000n }),
      getBytecode: async (args: { address: `0x${string}` }) => {
        if (args.address.toLowerCase() === ADDR_FACTORY.toLowerCase()) return FACTORY_BYTECODE as `0x${string}`;
        if (args.address.toLowerCase() === ADDR_TOKEN.toLowerCase()) return TOKEN_BYTECODE as `0x${string}`;
        return "0x6001" as `0x${string}`;
      },
      readContract: async (args: { functionName: string }) => {
        const fn = args.functionName;
        if (fn === "registeredAgreement") return true;
        if (fn === "token") return ADDR_TOKEN;
        if (fn === "factoryCap") return 100_000_000n;
        if (fn === "agreementCap") return 50_000_000n;
        if (fn === "outstandingLiability") return 0n;
        if (fn === "creationPaused") return false;
        if (fn === "terms") return [
          1, ADDR_CLIENT, ADDR_PROVIDER, ADDR_TOKEN,
          3_000_000n, 2_592_000n, 2_592_000n, 1_700_001_000n, 0n, 1_700_008_000n, HASH_TERMS,
        ];
        // L = F+R-RP-NP-CR = 3e6+3e6 = 6e6
        if (fn === "accounting") return [3_000_000n, 0n, 0n, 0n, 3_000_000n, false, 0n, 0, 6_000_000n];
        if (fn === "preview") return {
          observationTimestamp: 1_700_000_000n, phase: 0, R: 3_000_000n,
          D: 1_700_001_000n + 2_592_000n,
          hasStoredNotice_: false, S: 0n, E: 0n, reason: 0,
          V: 0n, W: 0n, RP: 0n, NP: 0n,
          providerClaimable: 0n, clientRefundable: 0n,
        // noticeRemaining = R - NP = 3_000_000 - 0 = 3_000_000
        L: 6_000_000n, noticeRemaining: 3_000_000n,
        };
        if (fn === "balanceOf") throw new Error("RPC failure on balanceOf");
        return null;
      },
    };
  }

  it("balanceOf RPC failure now returns rpc_failure (was ok)", async () => {
    const client = makeMockClientBalanceFails();
    const result = await observeAgreement(client, LOCAL_DEP_WITH_HASH, ADDR_AGMT);
    expect(result.status).toBe("rpc_failure");
  });
});

// ── T021-J: preview read failure is fatal (FIXED) ────────────────────────────

describe("T021-J preview read failure is fatal (fixed)", () => {
  function makeMockClientPreviewFails(): MinimalPublicClient {
    return {
      getChainId: async () => 31337,
      getBlock: async () => ({ number: 100n, hash: ("0x" + "ab".repeat(32)) as `0x${string}`, timestamp: 1_700_000_000n }),
      getBytecode: async (args: { address: `0x${string}` }) => {
        if (args.address.toLowerCase() === ADDR_FACTORY.toLowerCase()) return FACTORY_BYTECODE as `0x${string}`;
        if (args.address.toLowerCase() === ADDR_TOKEN.toLowerCase()) return TOKEN_BYTECODE as `0x${string}`;
        return "0x6001" as `0x${string}`;
      },
      readContract: async (args: { functionName: string }) => {
        const fn = args.functionName;
        if (fn === "registeredAgreement") return true;
        if (fn === "token") return ADDR_TOKEN;
        if (fn === "factoryCap") return 100_000_000n;
        if (fn === "agreementCap") return 50_000_000n;
        if (fn === "outstandingLiability") return 0n;
        if (fn === "creationPaused") return false;
        if (fn === "terms") return [
          1, ADDR_CLIENT, ADDR_PROVIDER, ADDR_TOKEN,
          3_000_000n, 2_592_000n, 2_592_000n, 1_700_001_000n, 0n, 1_700_008_000n, HASH_TERMS,
        ];
        // L = F+R-RP-NP-CR = 3e6+3e6 = 6e6
        if (fn === "accounting") return [3_000_000n, 0n, 0n, 0n, 3_000_000n, false, 0n, 0, 6_000_000n];
        if (fn === "preview") throw new Error("preview RPC failure");
        return null;
      },
    };
  }

  it("preview RPC failure now returns rpc_failure (was ok)", async () => {
    const client = makeMockClientPreviewFails();
    const result = await observeAgreement(client, LOCAL_DEP_WITH_HASH, ADDR_AGMT);
    expect(result.status).toBe("rpc_failure");
  });
});

// ── T021-K: full happy-path observeAgreement returns ok with hash checks ─────

describe("T021-K full happy-path with code hashes", () => {
  it("observeAgreement returns ok when all reads succeed and hashes match", async () => {
    const client = makeFullPassingClient();
    const result = await observeAgreement(client, LOCAL_DEP_WITH_HASH, ADDR_AGMT);
    expect(result.status).toBe("ok");
    expect(result.source).toBe("VERIFIED");
    expect(_isIssuedObservation(result)).toBe(true);
    expect(result.factoryCap).toBe(100_000_000n);
    expect(result.factoryCreationPaused).toBe(false);
    expect(result.observedTerms?.amountPerPeriod).toBe(3_000_000n);
    expect(result.domainMatchesContract).toBe(true);
  });

  it("module-issued ok observation passes _isIssuedObservation", async () => {
    const client = makeFullPassingClient();
    const result = await observeAgreement(client, LOCAL_DEP_WITH_HASH, ADDR_AGMT);
    expect(_isIssuedObservation(result)).toBe(true);
  });
});
