/** Serialization and projected funding deltas. Production controller regressions are in T042. */
import { describe, it, expect } from "vitest";
import {
  safeStringify, safeParse,
} from "./storage.js";
import {
  G1_TERMS, G1_T0, G3_TERMS, G3_T0, DAY, DEMO_CLIENT_ADDR,
} from "./scenarios.js";
import {
  applyFundNextPeriod, applyStartNotice,
} from "./transitions.js";
import { makeProjectedEvent } from "./projector.js";
import {
  createInitialState, computeD, fundNextPeriod, UINT256_MAX,
} from "@noticevault/domain";
import type { DemoAgreement } from "./types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const NO_CAPS = {
  agreementCaps: { maxLiabilityPerAgreement: UINT256_MAX },
  factoryCaps:   { maxTotalLiability: UINT256_MAX, currentFactoryLiability: 0n },
};

function makeAgreement(id: string): DemoAgreement {
  return { id, name: id, state: createInitialState(G1_TERMS), eventLog: [], createdAt: G1_T0 };
}

// ── Export round-trip ─────────────────────────────────────────────────────────

describe("T041 — export round-trip", () => {
  it("safeStringify/safeParse preserves bigints > Number.MAX_SAFE_INTEGER", () => {
    const large = BigInt("9007199254740993"); // 2^53 + 1, above JS safe int
    const obj = { amount: large, nested: { x: large * 2n } };
    const json = safeStringify(obj);
    expect(json).toContain("bigint:9007199254740993");
    const restored = safeParse<typeof obj>(json);
    expect(restored.amount).toBe(large);
    expect(restored.nested.x).toBe(large * 2n);
  });

  it("DemoAgreement with events round-trips losslessly", () => {
    let ag = makeAgreement("rt-1");
    const t15 = G1_T0 + 15n * DAY;
    ag = applyStartNotice(ag, t15, DEMO_CLIENT_ADDR);
    const json = safeStringify(ag);
    const restored = safeParse<DemoAgreement>(json);
    expect(restored.state.terms.amountPerPeriod).toBe(G1_TERMS.amountPerPeriod);
    expect(restored.state.regularFunded).toBe(ag.state.regularFunded);
    expect(restored.eventLog.length).toBe(ag.eventLog.length);
    expect(restored.eventLog[0]?.scenarioTime).toBe(t15);
  });

  it("full export envelope with snapshot bigints round-trips", () => {
    const envelope = {
      source: "SIMULATION" as const,
      scenarioTime: G1_T0 + 45n * DAY,
      amount: 3_500_000_000n,
      state: {
        regularFunded: 6_000_000_000n,
        regularPaid: 0n,
        noticePaid: 0n,
        clientRefunded: 0n,
      },
    };
    const json = safeStringify(envelope);
    const r = safeParse<typeof envelope>(json);
    expect(r.state.regularFunded).toBe(6_000_000_000n);
    expect(r.amount).toBe(3_500_000_000n);
    expect(r.source).toBe("SIMULATION");
  });
});

// ── PeriodFunded deltaAmount ──────────────────────────────────────────────────

describe("T041 — PeriodFunded.deltaAmount = actual transfer", () => {
  it("first fund: deltaAmount = A (newF - 0)", () => {
    // Initial state: regularFunded = A (one period pre-loaded by createInitialState)
    // Fund a second period: oldF = A, newF = 2A, delta = A
    const ag = makeAgreement("pf-1");
    const D1 = computeD(G3_TERMS, ag.state.regularFunded);
    const t29 = G3_T0 + 29n * DAY;
    const ag3: DemoAgreement = {
      ...ag,
      state: createInitialState(G3_TERMS),
    };
    const funded = applyFundNextPeriod(ag3, t29, DEMO_CLIENT_ADDR, D1);
    const fundEvent = funded.eventLog.find(e => e.kind === "PeriodFunded");
    expect(fundEvent).toBeDefined();
    // Delta should be exactly A (one period's transfer), not cumulative 2A
    expect(fundEvent?.deltaAmount).toBe(G3_TERMS.amountPerPeriod);
  });

  it("makeProjectedEvent rejects missing previous funding", () => {
    const domainResult = fundNextPeriod(
      createInitialState(G3_TERMS),
      G3_T0 + 29n * DAY,
      DEMO_CLIENT_ADDR,
      computeD(G3_TERMS, createInitialState(G3_TERMS).regularFunded),
      NO_CAPS.agreementCaps,
      NO_CAPS.factoryCaps,
    );
    const fundDomainEvent = domainResult.events.find(e => e.kind === "PeriodFunded");
    expect(fundDomainEvent).toBeDefined();
    // Without prevF: delta = 0 (documented fallback)
    expect(() => makeProjectedEvent("test", fundDomainEvent!, G3_T0 + 29n * DAY)).toThrow("previous funding");
  });

  it("makeProjectedEvent PeriodFunded with prevF: deltaAmount = A", () => {
    const initialState = createInitialState(G3_TERMS);
    const prevF = initialState.regularFunded;
    const domainResult = fundNextPeriod(
      initialState,
      G3_T0 + 29n * DAY,
      DEMO_CLIENT_ADDR,
      computeD(G3_TERMS, prevF),
      NO_CAPS.agreementCaps,
      NO_CAPS.factoryCaps,
    );
    const fundDomainEvent = domainResult.events.find(e => e.kind === "PeriodFunded");
    expect(fundDomainEvent).toBeDefined();
    const projected = makeProjectedEvent("test", fundDomainEvent!, G3_T0 + 29n * DAY, prevF);
    expect(projected.deltaAmount).toBe(G3_TERMS.amountPerPeriod); // A = newF - prevF
  });
});

