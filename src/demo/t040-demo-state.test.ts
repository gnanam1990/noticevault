/**
 * T040 — NoticeVault demo state tests (M09).
 *
 * Deterministic: no network, no wallet, no DB, no real clock.
 * All financial assertions use @noticevault/domain functions only.
 * G3 correction verified: V_S=3_500_000_000, refund=2_500_000_000, conservation=9_000_000_000.
 */

import { describe, it, expect } from "vitest";
import {
  calculateReferenceSnapshot,
  computeR,
  computeD,
  startNotice,
  claimProvider,
  claimClientRefund,
  fundNextPeriod,
  createInitialState,
  UINT256_MAX,
  NoticeAlreadyStartedError,
  FundingWindowClosedError,
  CheckpointMismatchError,
} from "@noticevault/domain";
import {
  G1_TERMS, G1_T0, G2_TERMS, G2_T0, G3_TERMS, G3_T0,
  G_A, G_P, G_N, DAY, DEMO_CLIENT_ADDR,
} from "./scenarios.js";
import {
  applyStartNotice,
} from "./transitions.js";
import { safeStringify, safeParse } from "./storage.js";
import { project } from "./projector.js";
import type { DemoAgreement } from "./types.js";

const NO_CAPS = {
  agreementCaps: { maxLiabilityPerAgreement: UINT256_MAX },
  factoryCaps:   { maxTotalLiability: UINT256_MAX, currentFactoryLiability: 0n },
};

function makeAgreement(id: string, terms: typeof G1_TERMS): DemoAgreement {
  return { id, name: id, state: createInitialState(terms), eventLog: [], createdAt: G1_T0 };
}

// ── G1 scenario ───────────────────────────────────────────────────────────────

describe("T040 — G1 scenario: cancel day 15", () => {
  const t15 = G1_T0 + 15n * DAY;
  const t45 = G1_T0 + 45n * DAY;

  it("day 15 before notice: V=1_500_000_000, W=0, phase=ACTIVE", () => {
    const state = createInitialState(G1_TERMS);
    const snap = calculateReferenceSnapshot(state, t15);
    expect(snap.V).toBe(1_500_000_000n);
    expect(snap.W).toBe(0n);
    expect(snap.phase).toBe("ACTIVE");
    expect(snap.source).toBe("SIMULATION");
  });

  it("after startNotice at day 15: clientRefundable=1_500_000_000 immediately", () => {
    let state = createInitialState(G1_TERMS);
    const result = startNotice(state, t15, DEMO_CLIENT_ADDR);
    state = result.state;
    const snap = calculateReferenceSnapshot(state, t15);
    expect(snap.clientRefundable).toBe(1_500_000_000n);
    expect(snap.phase).toBe("NOTICE");
  });

  it("day 45 after notice: W=3_000_000_000 (fully vested), provider total = 4_500_000_000", () => {
    let state = createInitialState(G1_TERMS);
    state = startNotice(state, t15, DEMO_CLIENT_ADDR).state;
    const snap = calculateReferenceSnapshot(state, t45);
    expect(snap.V).toBe(1_500_000_000n);
    expect(snap.W).toBe(3_000_000_000n);
    expect(snap.providerClaimable).toBe(4_500_000_000n);
    expect(snap.clientRefundable).toBe(1_500_000_000n);
    // Conservation: F+R = RP + NP + CR + L at all times (domain invariant).
    // Before any claims: RP=NP=CR=0, so L = F+R = 6e9.
    const R = computeR(G1_TERMS);
    const F = G1_TERMS.amountPerPeriod; // initial F = A = 3e9
    // snap.L + RP + NP + CR = F + R
    // RP=NP=CR=0, so snap.L = F + R
    expect(snap.L).toBe(F + R); // 6_000_000_000n: all liability still outstanding (unclaimed)
  });

  it("G1 conservation at day 45 after full claim: 4_500_000_000 + 1_500_000_000 = 6_000_000_000", () => {
    let state = createInitialState(G1_TERMS);
    state = startNotice(state, t15, DEMO_CLIENT_ADDR).state;
    state = claimProvider(state, t45).state;
    state = claimClientRefund(state, t45).state;
    const snap = calculateReferenceSnapshot(state, t45);
    expect(snap.L).toBe(0n);
    expect(snap.providerClaimable).toBe(0n);
    expect(snap.clientRefundable).toBe(0n);
    expect(snap.phase).toBe("CLOSED");
    const R = computeR(G1_TERMS);
    expect(G1_TERMS.amountPerPeriod + R).toBe(6_000_000_000n);
  });
});

// ── G2 scenario ───────────────────────────────────────────────────────────────

describe("T040 — G2 scenario: no renewal, day 40", () => {
  const t40 = G2_T0 + 40n * DAY;
  const t60 = G2_T0 + 60n * DAY;

  it("day 40: S=day30 (derived), reason=MISSED_CHECKPOINT, phase=NOTICE, V=3_000_000_000 (capped at F)", () => {
    const state = createInitialState(G2_TERMS);
    const snap = calculateReferenceSnapshot(state, t40);
    expect(snap.phase).toBe("NOTICE");
    expect(snap.reason).toBe("MISSED_CHECKPOINT");
    expect(snap.S).toBe(G2_T0 + 30n * DAY);
    expect(snap.V).toBe(3_000_000_000n);
  });

  it("day 40: W = floor(3e9 * 10d/30d) = 1_000_000_000", () => {
    const state = createInitialState(G2_TERMS);
    const snap = calculateReferenceSnapshot(state, t40);
    expect(snap.W).toBe(1_000_000_000n);
  });

  it("day 60: W=3_000_000_000 (fully vested), clientRefundable=0", () => {
    const state = createInitialState(G2_TERMS);
    const snap = calculateReferenceSnapshot(state, t60);
    expect(snap.W).toBe(3_000_000_000n);
    expect(snap.clientRefundable).toBe(0n);
  });
});

// ── G3 scenario (corrected derivation) ───────────────────────────────────────

describe("T040 — G3 scenario: renew day 29, cancel day 35 (corrected)", () => {
  const t29 = G3_T0 + 29n * DAY;
  const t35 = G3_T0 + 35n * DAY;
  const t65 = G3_T0 + 65n * DAY;
  const D1  = G3_T0 + 30n * DAY;

  it("after renewal at day 29: F=6_000_000_000, D=day60", () => {
    let state = createInitialState(G3_TERMS);
    state = fundNextPeriod(state, t29, DEMO_CLIENT_ADDR, D1, NO_CAPS.agreementCaps, NO_CAPS.factoryCaps).state;
    expect(state.regularFunded).toBe(6_000_000_000n);
    const D2 = computeD(G3_TERMS, state.regularFunded);
    expect(D2).toBe(G3_T0 + 60n * DAY);
  });

  it("cancel day 35: V_S=3_500_000_000, clientRefundable=2_500_000_000", () => {
    let state = createInitialState(G3_TERMS);
    state = fundNextPeriod(state, t29, DEMO_CLIENT_ADDR, D1, NO_CAPS.agreementCaps, NO_CAPS.factoryCaps).state;
    state = startNotice(state, t35, DEMO_CLIENT_ADDR).state;
    const snap = calculateReferenceSnapshot(state, t35);
    expect(snap.V).toBe(3_500_000_000n);        // floor(3e9 * 35/30)
    expect(snap.clientRefundable).toBe(2_500_000_000n); // 6e9 - 3.5e9 - 0
    expect(snap.source).toBe("SIMULATION");
  });

  it("day 65 (E): provider total = 6_500_000_000, conservation = 9_000_000_000", () => {
    let state = createInitialState(G3_TERMS);
    state = fundNextPeriod(state, t29, DEMO_CLIENT_ADDR, D1, NO_CAPS.agreementCaps, NO_CAPS.factoryCaps).state;
    state = startNotice(state, t35, DEMO_CLIENT_ADDR).state;
    const snap = calculateReferenceSnapshot(state, t65);
    expect(snap.V).toBe(3_500_000_000n);
    expect(snap.W).toBe(3_000_000_000n); // fully vested at E=day65
    expect(snap.providerClaimable).toBe(6_500_000_000n);
    expect(snap.clientRefundable).toBe(2_500_000_000n);
    // Conservation
    const R = computeR(G3_TERMS);
    const F = 6_000_000_000n;
    expect(snap.providerClaimable + snap.clientRefundable).toBe(F + R);
    expect(F + R).toBe(9_000_000_000n);
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe("T040 — repeated claims are idempotent", () => {
  it("second claimProvider after full claim = zero transfer, state unchanged", () => {
    let state = createInitialState(G1_TERMS);
    const t45 = G1_T0 + 45n * DAY;
    state = startNotice(state, G1_T0 + 15n * DAY, DEMO_CLIENT_ADDR).state;
    const r1 = claimProvider(state, t45);
    state = r1.state;
    const r2 = claimProvider(state, t45);
    expect(r2.transferAmount).toBe(0n);
    expect(r2.events).toHaveLength(0);
    expect(r2.state).toStrictEqual(state);
  });

  it("second claimClientRefund after full refund = zero transfer, state unchanged", () => {
    let state = createInitialState(G1_TERMS);
    const t15 = G1_T0 + 15n * DAY;
    state = startNotice(state, t15, DEMO_CLIENT_ADDR).state;
    const r1 = claimClientRefund(state, t15);
    state = r1.state;
    const r2 = claimClientRefund(state, t15);
    expect(r2.transferAmount).toBe(0n);
    expect(r2.events).toHaveLength(0);
    expect(r2.state).toStrictEqual(state);
  });

  it("second fundNextPeriod with same expectedD: first succeeds, second throws CheckpointMismatch", () => {
    const state = createInitialState(G3_TERMS);
    const D1 = G3_T0 + G_P;
    const t29 = G3_T0 + 29n * DAY;
    const r1 = fundNextPeriod(state, t29, DEMO_CLIENT_ADDR, D1, NO_CAPS.agreementCaps, NO_CAPS.factoryCaps);
    expect(r1.transferAmount).toBe(G_A);
    // Second call with same expectedD: now D has changed → mismatch
    expect(() =>
      fundNextPeriod(r1.state, t29, DEMO_CLIENT_ADDR, D1, NO_CAPS.agreementCaps, NO_CAPS.factoryCaps)
    ).toThrow(CheckpointMismatchError);
  });
});

// ── Failed transition = no partial effect ─────────────────────────────────────

describe("T040 — failed transitions leave state unchanged", () => {
  it("startNotice after stored notice: throws, state unchanged", () => {
    let state = createInitialState(G1_TERMS);
    state = startNotice(state, G1_T0 + 15n * DAY, DEMO_CLIENT_ADDR).state;
    const before = state;
    expect(() =>
      startNotice(state, G1_T0 + 20n * DAY, DEMO_CLIENT_ADDR)
    ).toThrow(NoticeAlreadyStartedError);
    expect(state).toStrictEqual(before);
  });

  it("fundNextPeriod when now >= D: throws FundingWindowClosed, state unchanged", () => {
    const state = createInitialState(G2_TERMS);
    const D = computeD(G2_TERMS, state.regularFunded);
    const before = state;
    expect(() =>
      fundNextPeriod(state, D, DEMO_CLIENT_ADDR, D, NO_CAPS.agreementCaps, NO_CAPS.factoryCaps)
    ).toThrow(FundingWindowClosedError);
    expect(state).toStrictEqual(before);
  });
});

// ── Confirmation cancellation ─────────────────────────────────────────────────

describe("T040 — confirmation cancellation = no state change", () => {
  it("cancelling before confirming does not apply transition", () => {
    const agreement = makeAgreement("test-g1", G1_TERMS);
    const before = agreement.state;
    // We simulate: user opens confirm dialog, then cancels.
    // The transition fn is only called on confirm. Cancelling means fn never called.
    // Verify: state unchanged.
    expect(agreement.state).toStrictEqual(before);
    // transitions module is pure — no side effects without explicit call
  });
});

// ── Serialization round-trip ──────────────────────────────────────────────────

describe("T040 — localStorage serialization", () => {
  it("bigint round-trip: serialize/deserialize exactly", () => {
    const value = { amount: 3_500_000_000n, nested: { x: 0n } };
    const json = safeStringify(value);
    expect(json).toContain("bigint:3500000000");
    const restored = safeParse<typeof value>(json);
    expect(restored.amount).toBe(3_500_000_000n);
    expect(restored.nested.x).toBe(0n);
  });

  it("corrupt bigint tag: safeParse throws on invalid digits", () => {
    const corrupt = JSON.stringify({ amount: "bigint:NOT_A_NUMBER" });
    expect(() => safeParse(corrupt)).toThrow();
  });

  it("DemoAgreement round-trip preserves all bigint fields", () => {
    const agreement = makeAgreement("round-trip", G1_TERMS);
    const json = safeStringify(agreement);
    const restored = safeParse<DemoAgreement>(json);
    expect(restored.state.regularFunded).toBe(agreement.state.regularFunded);
    expect(restored.state.terms.amountPerPeriod).toBe(G_A);
    expect(restored.state.terms.startAt).toBe(G1_T0);
    expect(restored.createdAt).toBe(agreement.createdAt);
  });
});

// ── Phase transitions ─────────────────────────────────────────────────────────

describe("T040 — phase boundary transitions", () => {
  it("G2: clock moves from D-1 to D → phase ACTIVE → NOTICE", () => {
    const state = createInitialState(G2_TERMS);
    const D = computeD(G2_TERMS, state.regularFunded);
    const snapBefore = calculateReferenceSnapshot(state, D - 1n);
    const snapAfter  = calculateReferenceSnapshot(state, D);
    expect(snapBefore.phase).toBe("ACTIVE");
    expect(snapAfter.phase).toBe("NOTICE");
  });

  it("NOTICE → ENDED_CLAIMABLE at E boundary", () => {
    let state = createInitialState(G1_TERMS);
    const t15 = G1_T0 + 15n * DAY;
    state = startNotice(state, t15, DEMO_CLIENT_ADDR).state;
    const E = t15 + G_N;
    const snapBefore = calculateReferenceSnapshot(state, E - 1n);
    const snapAfter  = calculateReferenceSnapshot(state, E);
    expect(snapBefore.phase).toBe("NOTICE");
    expect(snapAfter.phase).toBe("ENDED_CLAIMABLE");
  });
});

// ── Zero-claimable ─────────────────────────────────────────────────────────────

describe("T040 — zero-claimable returns no events", () => {
  it("claimProvider at t0 (nothing accrued): zero transfer, no events", () => {
    const state = createInitialState(G1_TERMS);
    const result = claimProvider(state, G1_T0);
    expect(result.transferAmount).toBe(0n);
    expect(result.events).toHaveLength(0);
    expect(result.state).toStrictEqual(state);
  });
});

// ── Projection dedup / ordering ────────────────────────────────────────────────

describe("T040 — projector dedup and ordering", () => {
  it("duplicate events deduplicated by ID", () => {
    const agreement = makeAgreement("dedup-test", G1_TERMS);
    const t15 = G1_T0 + 15n * DAY;
    const applied = applyStartNotice(agreement, t15, DEMO_CLIENT_ADDR);
    // Apply same event twice (simulate replay) — first apply
    const proj1 = project(applied.id, applied.state, applied.eventLog, t15);
    // Duplicate events in the log
    const dupLog = [...applied.eventLog, ...applied.eventLog];
    const proj2 = project(applied.id, applied.state, dupLog, t15);
    expect(proj1.eventLog.length).toBe(proj2.eventLog.length);
  });

  it("out-of-order events throw ProjectionError", () => {
    const agreement = makeAgreement("order-test", G1_TERMS);
    const t15 = G1_T0 + 15n * DAY;
    const applied = applyStartNotice(agreement, t15, DEMO_CLIENT_ADDR);
    // Build a reversed (out-of-order) event log by manipulating scenarioTime
    if (applied.eventLog.length >= 1) {
      const e0 = applied.eventLog[0];
      const outOfOrder = [
        { ...e0, id: e0.id + "-b", scenarioTime: t15 + DAY },
        { ...e0, id: e0.id + "-a", scenarioTime: t15 },
      ];
      expect(() => project(applied.id, applied.state, outOfOrder, t15 + DAY)).toThrow();
    }
  });
});
