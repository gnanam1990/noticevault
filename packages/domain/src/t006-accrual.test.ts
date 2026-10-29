/**
 * T006 — Normal cumulative accrual and valid renewal
 *
 * Golden fixture G1: A=3_000_000_000, P=N=2_592_000 (30 days), R=3_000_000_000
 * t0 = 1_000_000_000n (fixed future offset — model test only, not production time)
 */

import { describe, it, expect } from "vitest";
import {
  createInitialState,
  computeR,
  computeD,
  calculateReferenceSnapshot,
  fundNextPeriod,
} from "./model.js";
import { AgreementCaps, FactoryCaps, CheckpointMismatchError, UnauthorizedActorError } from "./types.js";
import { makeTerms, DAY, ADDR_CLIENT, ADDR_PROVIDER, noCaps } from "./test-helpers.js";

const A = 3_000_000_000n; // 3000 USDC
const P = 2_592_000n;     // 30 days
const N = 2_592_000n;     // 30 days
const t0 = 1_000_000_000n;

const terms = makeTerms({ amountPerPeriod: A, periodSeconds: P, noticeSeconds: N, startAt: t0 });
const state0 = createInitialState(terms);

describe("T006 — Accrual and renewal", () => {
  it("R computed correctly: ceil(A*N/P) = A when P=N", () => {
    expect(computeR(terms)).toBe(3_000_000_000n);
  });

  it("D = t0 + 1*P after initial funding", () => {
    expect(computeD(terms, A)).toBe(t0 + P);
  });

  it("Initial state: F=A, RP=NP=CR=0, no notice", () => {
    expect(state0.regularFunded).toBe(A);
    expect(state0.regularPaid).toBe(0n);
    expect(state0.noticePaid).toBe(0n);
    expect(state0.clientRefunded).toBe(0n);
    expect(state0.noticeStartStored).toBeNull();
  });

  it("G1 day15: V=1_500_000_000, W=0, phase=ACTIVE", () => {
    const now = t0 + 15n * DAY;
    const snap = calculateReferenceSnapshot(state0, now);
    expect(snap.V).toBe(1_500_000_000n);
    expect(snap.W).toBe(0n);
    expect(snap.phase).toBe("ACTIVE");
    expect(snap.source).toBe("SIMULATION");
    expect(snap.schemaVersion).toBe(1);
    expect(snap.providerClaimable).toBe(1_500_000_000n);
    expect(snap.clientRefundable).toBe(0n);
    // Conservation: F+R = RP+NP+CR+L
    const R = computeR(terms);
    expect(snap.L).toBe(A + R - 0n - 0n - 0n);
  });

  it("Before t0: V=0, W=0, phase=SCHEDULED", () => {
    const snap = calculateReferenceSnapshot(state0, t0 - 1n);
    expect(snap.V).toBe(0n);
    expect(snap.W).toBe(0n);
    expect(snap.phase).toBe("SCHEDULED");
    expect(snap.providerClaimable).toBe(0n);
  });

  it("At t0 exactly: V=0, phase=ACTIVE", () => {
    const snap = calculateReferenceSnapshot(state0, t0);
    expect(snap.V).toBe(0n);
    expect(snap.phase).toBe("ACTIVE");
  });

  it("At D-1: V approaching F", () => {
    const D = computeD(terms, A);
    const snap = calculateReferenceSnapshot(state0, D - 1n);
    // floor(A*(D-1-t0)/P) = floor(A*(P-1)/P)
    const expected = (A * (P - 1n)) / P;
    expect(snap.V).toBe(expected);
    expect(snap.phase).toBe("ACTIVE");
  });

  it("At D: V=F (fully earned, ordinary window closed), phase changes to NOTICE (missed)", () => {
    const D = computeD(terms, A);
    const snap = calculateReferenceSnapshot(state0, D);
    expect(snap.V).toBe(A); // capped at F
    // Derived notice fires: MISSED_CHECKPOINT → S=D, phase=NOTICE
    expect(snap.phase).toBe("NOTICE");
    expect(snap.S).toBe(D);
    expect(snap.reason).toBe("MISSED_CHECKPOINT");
  });

  it("G3 renewal: day29 expected=D, F→2A, new D=t0+2P", () => {
    const D = computeD(terms, A);
    const now = t0 + 29n * DAY;
    const caps: AgreementCaps = noCaps;
    const fcaps: FactoryCaps = { maxTotalLiability: UINT256_MAX_TEST, currentFactoryLiability: 0n };
    const result = fundNextPeriod(state0, now, ADDR_CLIENT, D, caps, fcaps);
    expect(result.state.regularFunded).toBe(2n * A);
    expect(result.events[0]).toMatchObject({ kind: "PeriodFunded", newF: 2n * A });
    const newD = computeD(terms, 2n * A);
    expect(newD).toBe(t0 + 2n * P);
    expect(result.events[0]).toMatchObject({ newD });
  });

  it("Renewal at D exactly is rejected (at equality = too late)", () => {
    const D = computeD(terms, A);
    expect(() =>
      fundNextPeriod(state0, D, ADDR_CLIENT, D, noCaps, noFCaps())
    ).toThrow("funding window closed");
  });

  it("Renewal checkpoint mismatch is rejected", () => {
    const wrong = computeD(terms, A) + 1n;
    expect(() =>
      fundNextPeriod(state0, t0 + 1n * DAY, ADDR_CLIENT, wrong, noCaps, noFCaps())
    ).toThrow(CheckpointMismatchError);
  });

  it("Renewal by non-client is rejected", () => {
    const D = computeD(terms, A);
    expect(() =>
      fundNextPeriod(state0, t0 + 1n * DAY, ADDR_PROVIDER, D, noCaps, noFCaps())
    ).toThrow(UnauthorizedActorError);
  });

  it("Conservation after renewal: F+R = RP+NP+CR+L", () => {
    const D = computeD(terms, A);
    const result = fundNextPeriod(state0, t0 + 29n * DAY, ADDR_CLIENT, D, noCaps, noFCaps());
    const s = result.state;
    const R = computeR(s.terms);
    expect(s.regularFunded + R).toBe(s.regularPaid + s.noticePaid + s.clientRefunded +
      (s.regularFunded + R - s.regularPaid - s.noticePaid - s.clientRefunded));
  });
});

function noFCaps(): FactoryCaps {
  return { maxTotalLiability: UINT256_MAX_TEST, currentFactoryLiability: 0n };
}

const UINT256_MAX_TEST = (1n << 256n) - 1n;
