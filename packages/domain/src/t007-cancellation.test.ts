/**
 * T007 — Cancellation: instant W=0, no simultaneous normal+notice accrual,
 * ordinary freeze/refund/full notice schedule.
 * Golden fixture G1: A=3_000_000_000, P=N=30days, t0=1_000_000_000n
 */

import { describe, it, expect } from "vitest";
import {
  createInitialState, computeR, computeD,
  calculateReferenceSnapshot, startNotice, claimProvider, claimClientRefund, fundNextPeriod,
} from "./model.js";
import {
  NoticeAlreadyStartedError, UnauthorizedActorError,
} from "./types.js";
import { makeTerms, DAY, ADDR_CLIENT, ADDR_PROVIDER } from "./test-helpers.js";

const A = 3_000_000_000n;
const P = 2_592_000n;
const N = 2_592_000n;
const t0 = 1_000_000_000n;
const terms = makeTerms({ amountPerPeriod: A, periodSeconds: P, noticeSeconds: N, startAt: t0 });
const R = computeR(terms);
const D = computeD(terms, A);

describe("T007 — Cancellation and notice accrual", () => {
  it("G1: cancel at day15 — instant clientRefundable, W=0 immediately", () => {
    const state0 = createInitialState(terms);
    const now15 = t0 + 15n * DAY;
    const { state: cancelled } = startNotice(state0, now15, ADDR_CLIENT);

    expect(cancelled.noticeStartStored).toBe(now15); // S = max(now,t0) = now15
    expect(cancelled.noticeReasonStored).toBe("CLIENT_CANCELLED");

    // W=0 at S exactly (elapsed from S = 0)
    const snapAtS = calculateReferenceSnapshot(cancelled, now15);
    expect(snapAtS.W).toBe(0n);
    expect(snapAtS.phase).toBe("NOTICE");

    // Client refundable immediately at S = F - V_S - CR
    // V_S = floor(A * 15d / 30d) = A/2
    const V_S = A / 2n; // 1_500_000_000
    const expectedRefund = A - V_S; // 1_500_000_000
    expect(snapAtS.clientRefundable).toBe(expectedRefund);
    expect(snapAtS.V).toBe(V_S); // ordinary frozen at V_S
  });

  it("G1: ordinary accrual does NOT continue after notice (V frozen at V_S)", () => {
    const state0 = createInitialState(terms);
    const now15 = t0 + 15n * DAY;
    const { state: cancelled } = startNotice(state0, now15, ADDR_CLIENT);

    // Observe at day20 — V must still be V_S = 1_500_000_000 (frozen)
    const snapDay20 = calculateReferenceSnapshot(cancelled, t0 + 20n * DAY);
    expect(snapDay20.V).toBe(1_500_000_000n);
  });

  it("G1: by day45 (S+N) W=R=3_000_000_000, provider total=4_500_000_000", () => {
    const state0 = createInitialState(terms);
    const now15 = t0 + 15n * DAY;
    const { state: cancelled } = startNotice(state0, now15, ADDR_CLIENT);
    const S = now15;
    const E = S + N;

    // Claim at E
    const snapAtE = calculateReferenceSnapshot(cancelled, E);
    expect(snapAtE.W).toBe(R); // W = R = 3_000_000_000
    // V_S = 1_500_000_000, W = 3_000_000_000 → providerClaimable = 1_500_000_000 + 3_000_000_000
    expect(snapAtE.providerClaimable).toBe(1_500_000_000n + 3_000_000_000n);
    expect(snapAtE.clientRefundable).toBe(1_500_000_000n);

    // Conservation: total = 6_000_000_000 = initial A + R
    const totalProviderEntitled = 1_500_000_000n + 3_000_000_000n;
    const totalClientEntitled = 1_500_000_000n;
    expect(totalProviderEntitled + totalClientEntitled).toBe(A + R);
  });

  it("G1: actual claim sequence; state RP/NP updated cumulatively", () => {
    const state0 = createInitialState(terms);
    const now15 = t0 + 15n * DAY;
    const { state: s1 } = startNotice(state0, now15, ADDR_CLIENT);
    const E = now15 + N;

    const claim1 = claimProvider(s1, E);
    expect(claim1.state.regularPaid).toBe(1_500_000_000n);
    expect(claim1.state.noticePaid).toBe(3_000_000_000n);
    expect(claim1.transferAmount).toBe(4_500_000_000n);
    expect(claim1.transferTo).toBe(terms.provider);

    // Second claim: nothing left
    const claim2 = claimProvider(claim1.state, E);
    expect(claim2.transferAmount).toBe(0n);
    expect(claim2.events).toHaveLength(0);
    expect(claim2.state).toStrictEqual(claim1.state); // unchanged

    // Client refund
    const refund = claimClientRefund(s1, now15);
    expect(refund.transferAmount).toBe(1_500_000_000n);
    expect(refund.transferTo).toBe(terms.client);
  });

  it("G1: no notice → clientRefundable always 0 before cancellation", () => {
    const state0 = createInitialState(terms);
    const snap = calculateReferenceSnapshot(state0, t0 + 20n * DAY);
    expect(snap.clientRefundable).toBe(0n);
  });

  it("Pre-start cancel (before t0): S=t0, full notice window from t0, V_S=0, refund=F", () => {
    const state0 = createInitialState(terms);
    const nowBefore = t0 - 1000n;
    const { state: cancelled, events } = startNotice(state0, nowBefore, ADDR_CLIENT);

    // S = max(now, t0) = t0
    expect(cancelled.noticeStartStored).toBe(t0);
    expect(events[0]).toMatchObject({ kind: "NoticeStarted", S: t0, reason: "CLIENT_CANCELLED" });

    // Phase at nowBefore is NOTICE_SCHEDULED
    const snap = calculateReferenceSnapshot(cancelled, nowBefore);
    expect(snap.phase).toBe("NOTICE_SCHEDULED");
    // V_S = floor(A * max(0, min(t0,D)-t0) / P) = 0
    expect(snap.V).toBe(0n);
    // clientRefundable = F - 0 - 0 = A (full refund available)
    expect(snap.clientRefundable).toBe(A);
  });

  it("startNotice only client — provider rejected", () => {
    const state0 = createInitialState(terms);
    expect(() => startNotice(state0, t0 + 1n * DAY, ADDR_PROVIDER))
      .toThrow(UnauthorizedActorError);
  });

  it("startNotice twice: second call throws NoticeAlreadyStarted, state unchanged", () => {
    const state0 = createInitialState(terms);
    const { state: s1 } = startNotice(state0, t0 + 5n * DAY, ADDR_CLIENT);
    const before = { ...s1 };
    expect(() => startNotice(s1, t0 + 5n * DAY, ADDR_CLIENT))
      .toThrow(NoticeAlreadyStartedError);
    // State should be unchanged (deep equal)
    expect(s1).toStrictEqual(before);
  });

  it("fundNextPeriod after notice: rejected", () => {
    const state0 = createInitialState(terms);
    const { state: s1 } = startNotice(state0, t0 + 5n * DAY, ADDR_CLIENT);
    // Should throw NoticeAlreadyStarted
    expect(() =>
      fundNextPeriod(s1, t0 + 5n * DAY, ADDR_CLIENT, D, { maxLiabilityPerAgreement: (1n << 256n) - 1n },
        { maxTotalLiability: (1n << 256n) - 1n, currentFactoryLiability: 0n })
    ).toThrow(NoticeAlreadyStartedError);
  });

  it("Overdue startNotice: S=D not now, reason=MISSED_CHECKPOINT", () => {
    const state0 = createInitialState(terms);
    const nowOverdue = D + 5n * DAY;
    const { state: s1, events } = startNotice(state0, nowOverdue, ADDR_CLIENT);
    expect(s1.noticeStartStored).toBe(D); // S=D not now
    expect(s1.noticeReasonStored).toBe("MISSED_CHECKPOINT");
    expect(events[0]).toMatchObject({ S: D, reason: "MISSED_CHECKPOINT" });
  });
});
