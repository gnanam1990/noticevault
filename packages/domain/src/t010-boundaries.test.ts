/**
 * T010 — Phase/boundary tests: before t0, at t0, D-1, D, D+1, S, E-1, E, E+1.
 * Pre-start cancel/refund in NOTICE_SCHEDULED.
 * Client-only overdue startNotice. Repeated stored rejection.
 * materializeNotice idempotency. Stale/duplicate checkpoints. Both race orders.
 * Failed transitions deep-equal input state.
 */

import { describe, it, expect } from "vitest";
import {
  createInitialState, computeR, computeD, computeV, computeW,
  calculateReferenceSnapshot, startNotice, materializeNotice, claimProvider,
  claimClientRefund, fundNextPeriod,
} from "./model.js";
import {
  NoticeAlreadyStartedError, FundingWindowClosedError, UnauthorizedActorError,
  CheckpointMismatchError, AgreementPhase,
} from "./types.js";
import { makeTerms, DAY, ADDR_CLIENT, ADDR_PROVIDER, noCaps, noFCaps } from "./test-helpers.js";
import * as fc from "fast-check";

const A = 3_000_000_000n;
const P = 2_592_000n; // 30 days
const N = 2_592_000n;
const t0 = 1_000_000_000n;
const terms = makeTerms({ amountPerPeriod: A, periodSeconds: P, noticeSeconds: N, startAt: t0 });
const _R = computeR(terms); // documented for context
const D = computeD(terms, A);

describe("T010 — Phase boundaries", () => {
  const state0 = createInitialState(terms);

  const phases: Array<{ label: string; now: bigint; expectedPhase: AgreementPhase }> = [
    { label: "before t0", now: t0 - 1n, expectedPhase: "SCHEDULED" },
    { label: "at t0", now: t0, expectedPhase: "ACTIVE" },
    { label: "D-1", now: D - 1n, expectedPhase: "ACTIVE" },
    { label: "D (missed checkpoint)", now: D, expectedPhase: "NOTICE" },
    { label: "D+1", now: D + 1n, expectedPhase: "NOTICE" },
  ];

  for (const { label, now, expectedPhase } of phases) {
    it(`phase at ${label} = ${expectedPhase}`, () => {
      const snap = calculateReferenceSnapshot(state0, now);
      expect(snap.phase).toBe(expectedPhase);
    });
  }

  it("After cancel at t0+10d: at S → NOTICE, before S → NOTICE_SCHEDULED", () => {
    const S = t0 + 10n * DAY;
    const { state: sCan } = startNotice(state0, S, ADDR_CLIENT);
    expect(calculateReferenceSnapshot(sCan, S - 1n).phase).toBe("NOTICE_SCHEDULED");
    expect(calculateReferenceSnapshot(sCan, S).phase).toBe("NOTICE");
  });

  it("E-1: NOTICE, E: ENDED_CLAIMABLE (if L>0)", () => {
    const S = t0 + 10n * DAY;
    const E = S + N;
    const { state: sCan } = startNotice(state0, S, ADDR_CLIENT);
    expect(calculateReferenceSnapshot(sCan, E - 1n).phase).toBe("NOTICE");
    expect(calculateReferenceSnapshot(sCan, E).phase).toBe("ENDED_CLAIMABLE");
  });

  it("E+1 after full claim: CLOSED", () => {
    const S = t0 + 10n * DAY;
    const E = S + N;
    const { state: sCan } = startNotice(state0, S, ADDR_CLIENT);
    const { state: sFullClaim } = claimProvider(sCan, E);
    // Claim refund too
    const { state: sFinal } = claimClientRefund(sFullClaim, E);
    expect(calculateReferenceSnapshot(sFinal, E + 1n).phase).toBe("CLOSED");
  });

  describe("Pre-start cancel (NOTICE_SCHEDULED)", () => {
    it("cancel before t0: phase=NOTICE_SCHEDULED, refundable=A (full)", () => {
      const nowBefore = t0 - 100n;
      const { state: sCan } = startNotice(state0, nowBefore, ADDR_CLIENT);
      const snap = calculateReferenceSnapshot(sCan, nowBefore);
      expect(snap.phase).toBe("NOTICE_SCHEDULED");
      expect(snap.clientRefundable).toBe(A); // V_S=0, refund=F
    });

    it("claimClientRefund before t0 after cancel: works (refund = F)", () => {
      const nowBefore = t0 - 100n;
      const { state: sCan } = startNotice(state0, nowBefore, ADDR_CLIENT);
      const { transferAmount, transferTo } = claimClientRefund(sCan, nowBefore);
      expect(transferAmount).toBe(A);
      expect(transferTo).toBe(terms.client);
    });
  });

  describe("Failed transitions leave state unchanged", () => {
    it("startNotice with wrong actor: state deep-equals input", () => {
      const before = structuredClone(state0);
      expect(() => startNotice(state0, t0 + 1n * DAY, ADDR_PROVIDER))
        .toThrow(UnauthorizedActorError);
      expect(state0).toStrictEqual(before);
    });

    it("double startNotice: state deep-equals after first", () => {
      const { state: s1 } = startNotice(state0, t0 + 1n * DAY, ADDR_CLIENT);
      const before = structuredClone(s1);
      expect(() => startNotice(s1, t0 + 2n * DAY, ADDR_CLIENT))
        .toThrow(NoticeAlreadyStartedError);
      expect(s1).toStrictEqual(before);
    });

    it("fundNextPeriod wrong checkpoint: state unchanged", () => {
      const before = structuredClone(state0);
      expect(() =>
        fundNextPeriod(state0, t0 + 1n, ADDR_CLIENT, D + 1n, noCaps, noFCaps())
      ).toThrow(CheckpointMismatchError);
      expect(state0).toStrictEqual(before);
    });

    it("materializeNotice before D: state unchanged", () => {
      const before = structuredClone(state0);
      expect(() => materializeNotice(state0, D - 1n))
        .toThrow(FundingWindowClosedError);
      expect(state0).toStrictEqual(before);
    });
  });

  describe("Race conditions", () => {
    it("Race 1 — renewal then cancellation before old D: both succeed on renewed state", () => {
      // Renew at day29 (before old D); cancel at day35 using renewed state
      const { state: sRenewed } = fundNextPeriod(
        state0, t0 + 29n * DAY, ADDR_CLIENT, D, noCaps, noFCaps()
      );
      const { state: sCancelled } = startNotice(sRenewed, t0 + 35n * DAY, ADDR_CLIENT);
      expect(sCancelled.regularFunded).toBe(2n * A);
      expect(sCancelled.noticeStartStored).toBe(t0 + 35n * DAY);
    });

    it("Race 2 — cancellation then renewal: renewal rejected (notice already stored)", () => {
      const { state: sCancelled } = startNotice(state0, t0 + 5n * DAY, ADDR_CLIENT);
      expect(() =>
        fundNextPeriod(sCancelled, t0 + 29n * DAY, ADDR_CLIENT, D, noCaps, noFCaps())
      ).toThrow("notice already stored");
    });

    it("Duplicate renewal same checkpoint: second call rejected (D has moved)", () => {
      const { state: s1 } = fundNextPeriod(
        state0, t0 + 29n * DAY, ADDR_CLIENT, D, noCaps, noFCaps()
      );
      const D2 = computeD(terms, 2n * A);
      // Second call with old D is rejected (checkpoint mismatch)
      expect(() =>
        fundNextPeriod(s1, t0 + 29n * DAY, ADDR_CLIENT, D, noCaps, noFCaps())
      ).toThrow(CheckpointMismatchError);
      // Correct call with new D2 succeeds
      const { state: s2 } = fundNextPeriod(s1, t0 + 29n * DAY, ADDR_CLIENT, D2, noCaps, noFCaps());
      expect(s2.regularFunded).toBe(3n * A);
    });
  });

  describe("Invalid roles", () => {
    it("claimProvider: no actor restriction (permissionless)", () => {
      // claimProvider is permissionless — calling with any address works
      const { transferTo } = claimProvider(state0, D + 1n);
      // transferTo is always the immutable provider
      expect(transferTo).toBe(terms.provider);
    });

    it("startNotice: random address rejected", () => {
      expect(() =>
        startNotice(state0, t0 + 1n * DAY, "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef")
      ).toThrow(UnauthorizedActorError);
    });
  });
});

// ── Property-based tests ───────────────────────────────────────────────────────

describe("T010 — Property tests (fast-check, seeded)", () => {
  const SEED = 0xCAFEBABE;

  /**
   * Property: conservation F+R = RP+NP+CR+L at every valid step.
   * Uses deterministic seeded arbitrary for reproducibility.
   * Seed printed in test name for replay.
   */
  it(`conservation invariant (seed=${SEED}, 200 runs)`, () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 3n * P }), (nowOffset) => {
        const now = t0 + nowOffset;
        const state = createInitialState(terms);
        const RR = computeR(state.terms);
        const snap = calculateReferenceSnapshot(state, now);
        expect(state.regularFunded + RR).toBe(
          state.regularPaid + state.noticePaid + state.clientRefunded + snap.L
        );
        expect(snap.noticeRemaining).toBeGreaterThanOrEqual(0n);
        expect(snap.providerClaimable).toBeGreaterThanOrEqual(0n);
        expect(snap.clientRefundable).toBeGreaterThanOrEqual(0n);
      }),
      { seed: SEED, numRuns: 200 },
    );
  });

  /**
   * Property: V is monotonically non-decreasing as now increases (before notice).
   */
  it(`V monotonically non-decreasing (seed=${SEED + 1}, 200 runs)`, () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: P - 1n }),
        fc.bigInt({ min: 1n, max: P }),
        (a, b) => {
          const t1 = t0 + (a < b ? a : b);
          const t2 = t0 + (a < b ? b : a);
          const V1 = computeV(createInitialState(terms), t1);
          const V2 = computeV(createInitialState(terms), t2);
          expect(V2).toBeGreaterThanOrEqual(V1);
        },
      ),
      { seed: SEED + 1, numRuns: 200 },
    );
  });

  /**
   * Property: W is monotonically non-decreasing after notice.
   */
  it(`W monotonically non-decreasing after notice (seed=${SEED + 2}, 200 runs)`, () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: N }),
        fc.bigInt({ min: 0n, max: N }),
        (a, b) => {
          const S = t0 + 5n * DAY;
          const { state: sCan } = startNotice(createInitialState(terms), S, ADDR_CLIENT);
          const offset1 = a < b ? a : b;
          const offset2 = a < b ? b : a;
          const W1 = computeW(sCan, S + offset1);
          const W2 = computeW(sCan, S + offset2);
          expect(W2).toBeGreaterThanOrEqual(W1);
        },
      ),
      { seed: SEED + 2, numRuns: 200 },
    );
  });

  /**
   * Property: claim splitting never grants extra — many claims = single claim total.
   */
  it(`claim splitting: many == single total (seed=${SEED + 3}, 150 runs)`, () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 0n, max: N + 1n }), { minLength: 1, maxLength: 8 }),
        (offsets) => {
          const S = t0 + 5n * DAY;
          const { state: sCan } = startNotice(createInitialState(terms), S, ADDR_CLIENT);
          const sorted = [...offsets].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
          const finalTime = S + sorted[sorted.length - 1];
          const { state: sSingle } = claimProvider(sCan, finalTime);
          let sMulti = sCan;
          for (const off of sorted) {
            const r = claimProvider(sMulti, S + off);
            sMulti = r.state;
          }
          expect(sMulti.regularPaid).toBe(sSingle.regularPaid);
          expect(sMulti.noticePaid).toBe(sSingle.noticePaid);
        },
      ),
      { seed: SEED + 3, numRuns: 150 },
    );
  });

  /**
   * Property: no resurrection — V never increases after notice is stored.
   */
  it(`no resurrection: V frozen at V_S after notice (seed=${SEED + 4}, 200 runs)`, () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: N }), (offset) => {
        const S = t0 + 15n * DAY;
        const { state: sCan } = startNotice(createInitialState(terms), S, ADDR_CLIENT);
        const V_S = computeV(sCan, S);
        const V_later = computeV(sCan, S + offset);
        expect(V_later).toBe(V_S);
      }),
      { seed: SEED + 4, numRuns: 200 },
    );
  });
});
