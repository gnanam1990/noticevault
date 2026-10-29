/**
 * T008 — Late observation, materialization G2, and event idempotency.
 * Golden G2: no renewal, observe day40 without materialization.
 * S=D=day30, E=D+N=day60. V=F=3_000_000_000, W at day40.
 */

import { describe, it, expect } from "vitest";
import {
  createInitialState, computeR, computeD,
  calculateReferenceSnapshot, materializeNotice, claimProvider, claimClientRefund,
} from "./model.js";
import { FundingWindowClosedError } from "./types.js";
import { makeTerms, DAY } from "./test-helpers.js";

const A = 3_000_000_000n;
const P = 2_592_000n;
const N = 2_592_000n;
const t0 = 1_000_000_000n;
const terms = makeTerms({ amountPerPeriod: A, periodSeconds: P, noticeSeconds: N, startAt: t0 });
const R = computeR(terms);
const D = computeD(terms, A);

describe("T008 — Late observation and materialization", () => {
  it("G2 day40: derived notice S=D=day30, E=day60, V=F, W=floor(R*(day40-D)/N)", () => {
    const state0 = createInitialState(terms);
    const now40 = t0 + 40n * DAY;
    const snap = calculateReferenceSnapshot(state0, now40);

    // Derived notice at D=day30
    expect(snap.S).toBe(D);
    expect(snap.reason).toBe("MISSED_CHECKPOINT");
    expect(snap.E).toBe(D + N);
    expect(snap.hasStoredNotice).toBe(false);

    // V = F (capped — ordinary fully earned by D)
    expect(snap.V).toBe(A);

    // W = floor(R * (now40-D) / N) = floor(R * 10days / 30days) = R/3
    const elapsed = now40 - D; // 10 days
    const expectedW = (R * elapsed) / N;
    expect(snap.W).toBe(expectedW);
    expect(snap.W).toBe(1_000_000_000n);

    // phase = NOTICE
    expect(snap.phase).toBe("NOTICE");
    expect(snap.providerClaimable).toBe(snap.V + snap.W - snap.RP - snap.NP);
  });

  it("G2 day60: W=R=full, provider=6_000_000_000, refund=0", () => {
    const state0 = createInitialState(terms);
    const E = D + N;
    const snap = calculateReferenceSnapshot(state0, E);
    expect(snap.W).toBe(R);
    expect(snap.V).toBe(A);
    expect(snap.providerClaimable).toBe(A + R); // 6_000_000_000
    expect(snap.clientRefundable).toBe(0n);     // V_S = D-t0 = P, so V_S/A*P = A → refund = A-A = 0
    expect(snap.phase).toBe("ENDED_CLAIMABLE");
  });

  it("G2 day60+1 after full claim: phase=CLOSED, L=0", () => {
    const state0 = createInitialState(terms);
    const E = D + N;
    const { state: s1 } = claimProvider(state0, E);
    const snap = calculateReferenceSnapshot(s1, E + 1n);
    expect(snap.phase).toBe("CLOSED");
    expect(snap.L).toBe(0n);
  });

  it("Derived notice: snapshot at day40 shows no stored notice (hasStoredNotice=false)", () => {
    const state0 = createInitialState(terms);
    const snap = calculateReferenceSnapshot(state0, t0 + 40n * DAY);
    expect(snap.hasStoredNotice).toBe(false);
    expect(snap.S).toBe(D); // derived
  });

  it("materializeNotice stores S=D and emits event", () => {
    const state0 = createInitialState(terms);
    const { state: s1, events } = materializeNotice(state0, D + 1n);
    expect(s1.noticeStartStored).toBe(D);
    expect(s1.noticeReasonStored).toBe("MISSED_CHECKPOINT");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "NoticeStarted", S: D, reason: "MISSED_CHECKPOINT" });
    // hasStoredNotice = true now
    expect(calculateReferenceSnapshot(s1, D + 1n).hasStoredNotice).toBe(true);
  });

  it("materializeNotice idempotent: second call emits no new event", () => {
    const state0 = createInitialState(terms);
    const { state: s1 } = materializeNotice(state0, D + 1n);
    const { state: s2, events: ev2 } = materializeNotice(s1, D + 2n);
    expect(ev2).toHaveLength(0); // no duplicate event
    expect(s2).toStrictEqual(s1); // state unchanged
  });

  it("materializeNotice before D rejected (FundingWindowClosed)", () => {
    const state0 = createInitialState(terms);
    expect(() => materializeNotice(state0, D - 1n))
      .toThrow(FundingWindowClosedError);
  });

  it("claimProvider materializes derived notice internally (one NoticeStarted event)", () => {
    const state0 = createInitialState(terms);
    const nowOverdue = D + 1n;
    const { state: s1, events } = claimProvider(state0, nowOverdue);
    const noticeEvents = events.filter(e => e.kind === "NoticeStarted");
    expect(noticeEvents).toHaveLength(1);
    expect(s1.noticeStartStored).toBe(D);
  });

  it("Late materialization does NOT restart notice time (S remains D)", () => {
    const state0 = createInitialState(terms);
    const muchLater = D + 365n * DAY;
    const { state: s1 } = materializeNotice(state0, muchLater);
    expect(s1.noticeStartStored).toBe(D); // S = D, not muchLater
    // W at muchLater = R (fully vested — past E)
    const snap = calculateReferenceSnapshot(s1, muchLater);
    expect(snap.W).toBe(R);
  });

  it("Repeated claimProvider no duplicate NoticeStarted", () => {
    const state0 = createInitialState(terms);
    const nowOverdue = D + 1n;
    const { state: s1 } = claimProvider(state0, nowOverdue); // materializes
    const { events: ev2 } = claimProvider(s1, nowOverdue + 1n); // already stored
    const noticeEvents2 = ev2.filter(e => e.kind === "NoticeStarted");
    expect(noticeEvents2).toHaveLength(0); // no duplicate
  });

  /**
   * Modelling boundary: claimClientRefund on a DERIVED notice.
   *
   * When now>=D and noticeStartStored===null (derived MISSED_CHECKPOINT), claimClientRefund
   * runs without error and leaves noticeStartStored===null on the returned state.
   * For MISSED_CHECKPOINT: V_S = floor(A*(D-t0)/P) = F always, so clientRefundable=0
   * and CR is not incremented. assertConsistentState must not reject the resulting state.
   *
   * Correction of wording in commit 84071ea (history not amended):
   *   That commit stated "No valid transition produces [CR>0, noticeStartStored===null]".
   *   More precisely: claimClientRefund succeeds (no error) on a derived notice and
   *   leaves noticeStartStored===null. Whether CR>0 is possible depends on the refund
   *   amount; for MISSED_CHECKPOINT V_S=F so CR stays 0 here. A stateless consistency
   *   checker lacks `now` and must not reject CR=0/noticeStartStored===null.
   *   Time-aware callers must evaluate resolveNotice(state, now).
   *   This is a documented modelling boundary, not evidence of onchain enforcement.
   */
  it("claimClientRefund on derived notice: does not materialize, noticeStartStored stays null", () => {
    const state0 = createInitialState(terms);
    // D = t0 + P. Observe at D: derived MISSED_CHECKPOINT notice.
    const nowAtD = D;

    // Derived notice exists but is not stored
    expect(state0.noticeStartStored).toBeNull();
    const snap = calculateReferenceSnapshot(state0, nowAtD);
    expect(snap.hasStoredNotice).toBe(false);
    expect(snap.S).toBe(D);
    expect(snap.reason).toBe("MISSED_CHECKPOINT");
    // V_S = floor(A * (D-t0) / P) = floor(A * P / P) = A = F → clientRefundable = F-F-0 = 0
    expect(snap.clientRefundable).toBe(0n);

    // claimClientRefund runs without error on derived notice
    const { state: after, transferAmount, events } = claimClientRefund(state0, nowAtD);

    // No transfer (refundable=0), no events
    expect(transferAmount).toBe(0n);
    expect(events).toHaveLength(0);

    // noticeStartStored remains null — claimClientRefund does NOT materialize derived notice
    expect(after.noticeStartStored).toBeNull();
    expect(after.clientRefunded).toBe(0n);

    // assertConsistentState was called internally and did NOT throw — confirmed valid state.
    // A second call also returns without error (idempotent zero-claim).
    const { state: after2 } = claimClientRefund(after, nowAtD + 1n);
    expect(after2.noticeStartStored).toBeNull();
    expect(after2.clientRefunded).toBe(0n);
  });
});
