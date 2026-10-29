/**
 * @noticevault/domain — core financial state machine
 *
 * All money as bigint (micro-USDC / 6 decimals).
 * All time as bigint (Unix seconds).
 * Pure: no I/O, no chain calls, no crypto, no signing.
 *
 * Normative rules: specs/CORE-CONTRACT-M01.md
 */

import {
  AgreementTerms,
  AccountingState,
  AgreementCaps,
  FactoryCaps,
  AgreementPhase,
  AgreementSnapshot,
  NoticeReason,
  NoticeVaultEvent,
  TransitionResult,
  NoticeAlreadyStartedError,
  FundingWindowClosedError,
  UnauthorizedActorError,
  CheckpointMismatchError,
  AgreementCapExceededError,
  FactoryCapExceededError,
  MalformedStateError,
  ArithmeticError,
} from "./types.js";
import {
  mulDivFloor,
  mulDivCeil,
  bigMin,
  bigMax,
  clamp,
  safeAddUint256,
  assertUint256,
  assertInt64,
} from "./math.js";

// ── Immutable derived quantities ──────────────────────────────────────────────

/**
 * R = ceil(A * N / P)  — notice reserve, immutable from terms.
 */
export function computeR(terms: AgreementTerms): bigint {
  return mulDivCeil(terms.amountPerPeriod, terms.noticeSeconds, terms.periodSeconds);
}

/**
 * D = t0 + (F / A) * P  — funded-through timestamp.
 * F must be a positive multiple of A.
 */
export function computeD(terms: Pick<AgreementTerms,'amountPerPeriod'|'periodSeconds'|'startAt'>, F: bigint): bigint {
  const { amountPerPeriod: A, periodSeconds: P, startAt: t0 } = terms;
  if (A <= 0n) throw new ArithmeticError("computeD: amountPerPeriod must be > 0");
  if (F <= 0n || F % A !== 0n)
    throw new ArithmeticError(`computeD: F=${F} must be a positive multiple of A=${A}`);
  const periods = F / A;
  return t0 + periods * P;
}

// ── State consistency ─────────────────────────────────────────────────────────

export function assertConsistentState(state: AccountingState): void {
  const { terms, regularFunded: F, regularPaid: RP, noticePaid: NP, clientRefunded: CR,
    noticeStartStored, noticeReasonStored } = state;

  // Basic non-negativity
  if (F < 0n) throw new MalformedStateError("regularFunded < 0");
  if (RP < 0n) throw new MalformedStateError("regularPaid < 0");
  if (NP < 0n) throw new MalformedStateError("noticePaid < 0");
  if (CR < 0n) throw new MalformedStateError("clientRefunded < 0");

  // F must be a positive multiple of A
  if (F <= 0n || F % terms.amountPerPeriod !== 0n)
    throw new MalformedStateError(`regularFunded=${F} must be positive multiple of A=${terms.amountPerPeriod}`);

  const R = computeR(terms);

  // Paid cannot exceed earned limits
  if (RP > F) throw new MalformedStateError(`regularPaid ${RP} > regularFunded ${F}`);
  if (NP > R) throw new MalformedStateError(`noticePaid ${NP} > R ${R}`);

  // CR bounded: cannot exceed F - RP (ordinary residual)
  if (CR > F - RP) throw new MalformedStateError(`clientRefunded ${CR} > F-RP`);

  // Liability = F + R - RP - NP - CR >= 0
  const L = F + R - RP - NP - CR;
  if (L < 0n) throw new MalformedStateError(`liability L=${L} < 0`);

  // Notice fields must be both present or both absent
  if ((noticeStartStored === null) !== (noticeReasonStored === null))
    throw new MalformedStateError("noticeStartStored and noticeReasonStored must both be null or both present");

  // CR>0 requires a stored notice.
  // Under M01 transitions, claimClientRefund with a derived MISSED_CHECKPOINT notice always
  // produces clientRefundable=0 (V_S=F at D), so it never increments CR while leaving
  // noticeStartStored===null. A state with CR>0 and no stored notice is therefore malformed
  // and unreachable through valid M01 transitions.
  if (CR > 0n && noticeStartStored === null)
    throw new MalformedStateError(
      `clientRefunded=${CR} > 0 but noticeStartStored is null: refund requires a stored notice`,
    );

  // uint256 bounds
  assertUint256(F, "regularFunded");
  assertUint256(RP, "regularPaid");
  assertUint256(NP, "noticePaid");
  assertUint256(CR, "clientRefunded");
  assertUint256(L, "L");
}

// ── Notice resolution ─────────────────────────────────────────────────────────

export interface ResolvedNotice {
  readonly S: bigint;
  readonly reason: NoticeReason;
  readonly isStored: boolean; // true = was already in state; false = derived from overdue
}

/**
 * Resolve the effective notice start S at observation time `now`.
 * Returns null if no notice is in effect (active, not overdue).
 */
export function resolveNotice(
  state: Pick<AccountingState,'regularFunded'|'noticeStartStored'|'noticeReasonStored'>&{terms:Pick<AgreementTerms,'amountPerPeriod'|'periodSeconds'|'startAt'>},
  now: bigint,
): ResolvedNotice | null {
  const { terms, regularFunded: F, noticeStartStored, noticeReasonStored } = state;
  const D = computeD(terms, F);

  if (noticeStartStored !== null) {
    // Stored notice — immutable
    return { S: noticeStartStored, reason: noticeReasonStored!, isStored: true };
  }

  if (now >= D) {
    // Derived overdue notice
    return { S: D, reason: "MISSED_CHECKPOINT", isStored: false };
  }

  return null;
}

// ── Earned accrual ────────────────────────────────────────────────────────────

/**
 * V = floor(A * elapsed / P), capped at F.
 * elapsed = max(0, regularStop - t0)
 * regularStop = min(now, D, S if present)
 */
export function computeV(state: AccountingState, now: bigint): bigint {
  const { terms, regularFunded: F } = state;
  const { amountPerPeriod: A, periodSeconds: P, startAt: t0 } = terms;
  const D = computeD(terms, F);

  const notice = resolveNotice(state, now);
  // Regular stop: min(now, D, S if present)
  let stop = bigMin(now, D);
  if (notice !== null) stop = bigMin(stop, notice.S);

  const elapsed = bigMax(0n, stop - t0);
  const raw = mulDivFloor(A, elapsed, P);
  return bigMin(raw, F);
}

/**
 * W = notice vested amount.
 * With no notice: W = 0.
 * With notice S, E = S+N:
 *   W = floor(R * clamp(now-S, 0, N) / N)
 *   At/after E: W = R exactly.
 */
export function computeW(state: AccountingState, now: bigint): bigint {
  const notice = resolveNotice(state, now);
  if (notice === null) return 0n;

  const { S } = notice;
  const { noticeSeconds: N } = state.terms;
  const R = computeR(state.terms);

  const E = S + N;
  if (now >= E) return R; // fully vested
  const elapsed = clamp(now - S, 0n, N);
  return mulDivFloor(R, elapsed, N);
}

// ── Phase ─────────────────────────────────────────────────────────────────────

export function computePhase(state: AccountingState, now: bigint): AgreementPhase {
  const { terms, regularFunded: F, regularPaid: RP, noticePaid: NP, clientRefunded: CR } = state;
  const R = computeR(terms);
  const notice = resolveNotice(state, now);
  const L = F + R - RP - NP - CR;

  if (notice === null) {
    if (now < terms.startAt) return "SCHEDULED";
    return "ACTIVE";
  }

  const { S } = notice;
  const E = S + terms.noticeSeconds;

  if (now < S) return "NOTICE_SCHEDULED";
  if (now < E) return "NOTICE";
  if (L > 0n) return "ENDED_CLAIMABLE";
  return "CLOSED";
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

export function calculateReferenceSnapshot(
  state: AccountingState,
  now: bigint,
  actualBalance?: bigint,
): AgreementSnapshot {
  assertConsistentState(state);
  const { terms, regularFunded: F, regularPaid: RP, noticePaid: NP, clientRefunded: CR } = state;
  const R = computeR(terms);
  const D = computeD(terms, F);
  const notice = resolveNotice(state, now);
  const S = notice?.S ?? null;
  const E = S !== null ? S + terms.noticeSeconds : null;
  const reason = notice?.reason ?? null;
  const hasStoredNotice = state.noticeStartStored !== null;

  const V = computeV(state, now);
  const W = computeW(state, now);
  const L = F + R - RP - NP - CR;

  // Provider claimable: (V - RP) + (W - NP), both non-negative
  const regularClaimable = V - RP; // V >= RP by invariant
  const noticeClaimable = W - NP;  // W >= NP by invariant
  const providerClaimable = regularClaimable + noticeClaimable;

  // Client refundable: F - V_S - CR (where V_S = V at the time of S)
  // After stored OR derived notice: freeze V_S = floor(A * max(0, min(S,D) - t0) / P)
  let clientRefundable = 0n;
  if (notice !== null) {
    const { S: noticeS } = notice;
    const { amountPerPeriod: A, periodSeconds: P, startAt: t0 } = terms;
    const frozenStop = bigMax(0n, bigMin(noticeS, D) - t0);
    const V_S = bigMin(mulDivFloor(A, frozenStop, P), F);
    // clientRefundable = F - V_S - CR, clamped to 0 from below (shouldn't go negative by invariants)
    const raw = F - V_S - CR;
    clientRefundable = raw > 0n ? raw : 0n;
  }

  const phase = computePhase(state, now);
  const noticeRemaining = R - NP;

  const snap: AgreementSnapshot = {
    source: "SIMULATION",
    schemaVersion: 1,
    observationTimestamp: now,
    phase,
    R,
    D,
    hasStoredNotice,
    S,
    E,
    reason,
    V,
    W,
    RP,
    NP,
    providerClaimable,
    clientRefundable,
    L,
    noticeRemaining,
    ...(actualBalance !== undefined ? { actualBalance } : {}),
  };
  return snap;
}

// ── Initial state ─────────────────────────────────────────────────────────────

/**
 * Create the initial AccountingState after first funding (F = A, R ring-fenced).
 * The total initial inflow is A + R.
 */
export function createInitialState(terms: AgreementTerms): AccountingState {
  return {
    terms,
    regularFunded: terms.amountPerPeriod,
    regularPaid: 0n,
    noticePaid: 0n,
    clientRefunded: 0n,
    noticeStartStored: null,
    noticeReasonStored: null,
  };
}

// ── Transitions ───────────────────────────────────────────────────────────────

/**
 * startNotice(state, now, actor): client-only.
 * - Already stored → NoticeAlreadyStartedError (state unchanged).
 * - No stored notice AND now >= D → store S=D / MISSED_CHECKPOINT.
 * - Otherwise → S = max(now, t0) / CLIENT_CANCELLED.
 * Returns new immutable state + events.
 */
export function startNotice(
  state: AccountingState,
  now: bigint,
  actor: string,
): TransitionResult {
  if (actor.toLowerCase() !== state.terms.client.toLowerCase())
    throw new UnauthorizedActorError(`startNotice: only client may call; actor=${actor}`);

  if (state.noticeStartStored !== null)
    throw new NoticeAlreadyStartedError("notice already stored");

  const { terms, regularFunded: F } = state;
  const D = computeD(terms, F);

  let S: bigint;
  let reason: NoticeReason;

  if (now >= D) {
    // Overdue — store derived values
    S = D;
    reason = "MISSED_CHECKPOINT";
  } else {
    // Active cancellation
    S = bigMax(now, terms.startAt);
    reason = "CLIENT_CANCELLED";
  }

  const newState: AccountingState = {
    ...state,
    noticeStartStored: S,
    noticeReasonStored: reason,
  };

  const event: NoticeVaultEvent = { kind: "NoticeStarted", S, reason };
  return { state: newState, events: [event], transferAmount: 0n, transferTo: null };
}

/**
 * materializeNotice: permissionless.
 * - Stored → return existing S, no new event.
 * - Derived (now >= D) → store S=D, emit event.
 * - Neither → FundingWindowClosedError.
 */
export function materializeNotice(
  state: AccountingState,
  now: bigint,
): TransitionResult {
  if (state.noticeStartStored !== null) {
    // Already stored — idempotent, no event
    return { state, events: [], transferAmount: 0n, transferTo: null };
  }

  const D = computeD(state.terms, state.regularFunded);
  if (now < D) {
    throw new FundingWindowClosedError(
      `cannot materialize notice: now=${now} < D=${D} and no stored notice`,
    );
  }

  // Derived overdue
  const S = D;
  const reason: NoticeReason = "MISSED_CHECKPOINT";
  const newState: AccountingState = {
    ...state,
    noticeStartStored: S,
    noticeReasonStored: reason,
  };
  const event: NoticeVaultEvent = { kind: "NoticeStarted", S, reason };
  return { state: newState, events: [event], transferAmount: 0n, transferTo: null };
}

/**
 * claimProvider: permissionless; destination is always the immutable provider address.
 * Materializes derived notice if needed (single event).
 * Zero claimable → no events, no state change.
 */
export function claimProvider(
  state: AccountingState,
  now: bigint,
): TransitionResult {
  assertConsistentState(state);

  // Materialize derived notice if applicable (may emit NoticeStarted event)
  let currentState = state;
  const matEvents: NoticeVaultEvent[] = [];
  if (state.noticeStartStored === null) {
    const D = computeD(state.terms, state.regularFunded);
    if (now >= D) {
      const mat = materializeNotice(state, now);
      currentState = mat.state;
      matEvents.push(...mat.events);
    }
  }

  const V = computeV(currentState, now);
  const W = computeW(currentState, now);

  const regularDelta = V - currentState.regularPaid;
  const noticeDelta = W - currentState.noticePaid;
  const total = regularDelta + noticeDelta;

  if (total === 0n) {
    // No payment — no events, return original state unchanged (with any materialization)
    if (matEvents.length === 0) return { state, events: [], transferAmount: 0n, transferTo: null };
    return { state: currentState, events: matEvents, transferAmount: 0n, transferTo: null };
  }

  const newState: AccountingState = {
    ...currentState,
    regularPaid: currentState.regularPaid + regularDelta,
    noticePaid: currentState.noticePaid + noticeDelta,
  };

  assertConsistentState(newState);

  const events: NoticeVaultEvent[] = [
    ...matEvents,
    { kind: "ProviderClaimed", regularDelta, noticeDelta },
  ];

  return {
    state: newState,
    events,
    transferAmount: total,
    transferTo: state.terms.provider,
  };
}

/**
 * claimClientRefund: permissionless; destination is always the immutable client address.
 * Valid only when a notice (stored OR derived) exists.
 * Refund = F - V_S - CR (already-computed clientRefundable in snapshot).
 * Zero refund → no events, no state change.
 */
export function claimClientRefund(
  state: AccountingState,
  now: bigint,
): TransitionResult {
  assertConsistentState(state);

  const notice = resolveNotice(state, now);
  if (notice === null) {
    // No notice yet — refund = 0, no event
    return { state, events: [], transferAmount: 0n, transferTo: null };
  }

  const snap = calculateReferenceSnapshot(state, now);
  const amount = snap.clientRefundable;

  if (amount === 0n) {
    return { state, events: [], transferAmount: 0n, transferTo: null };
  }

  const newState: AccountingState = {
    ...state,
    clientRefunded: state.clientRefunded + amount,
  };

  assertConsistentState(newState);

  const event: NoticeVaultEvent = { kind: "ClientRefunded", amount };
  return {
    state: newState,
    events: [event],
    transferAmount: amount,
    transferTo: state.terms.client,
  };
}

/**
 * fundNextPeriod: client-only.
 * Conditions:
 * - No stored or derived notice (now < D strictly, no overdue).
 * - now < D strictly (at D equality: too late, no grace).
 * - expectedFundedThrough === D (checkpoint match).
 * - Exact A new regular funding.
 * - Overflow, cap checks pass.
 */
export function fundNextPeriod(
  state: AccountingState,
  now: bigint,
  actor: string,
  expectedFundedThrough: bigint,
  agreementCaps: AgreementCaps,
  factoryCaps: FactoryCaps,
): TransitionResult {
  assertConsistentState(state);

  if (actor.toLowerCase() !== state.terms.client.toLowerCase())
    throw new UnauthorizedActorError(`fundNextPeriod: only client may call; actor=${actor}`);

  // Check for stored notice
  if (state.noticeStartStored !== null)
    throw new NoticeAlreadyStartedError("fundNextPeriod: notice already stored");

  const { terms, regularFunded: F } = state;
  const { amountPerPeriod: A } = terms;
  const D = computeD(terms, F);

  // Check for derived notice (overdue)
  if (now >= D)
    throw new FundingWindowClosedError(
      `fundNextPeriod: now=${now} >= D=${D}; funding window closed`,
    );

  // Checkpoint match
  if (expectedFundedThrough !== D)
    throw new CheckpointMismatchError(
      `fundNextPeriod: expectedFundedThrough=${expectedFundedThrough} !== D=${D}`,
    );

  // Compute new F and D — check for overflow
  const newF = safeAddUint256(F, A, "fundNextPeriod: F+A");
  if (newF % A !== 0n)
    throw new ArithmeticError("fundNextPeriod: newF not a multiple of A (invariant)");

  const newD = computeD(terms, newF);
  assertInt64(newD, "fundNextPeriod: newD");
  assertInt64(newD + terms.noticeSeconds, "fundNextPeriod: newD+N");

  // Cap checks: outstanding liability = current L + A (new period funding increases by A)
  const R = computeR(terms);
  const currentL = F + R - state.regularPaid - state.noticePaid - state.clientRefunded;
  const newL = currentL + A;

  if (newL > agreementCaps.maxLiabilityPerAgreement)
    throw new AgreementCapExceededError(
      `fundNextPeriod: newL=${newL} > agreementCap=${agreementCaps.maxLiabilityPerAgreement}`,
    );

  const newFactoryL = factoryCaps.currentFactoryLiability + A;
  if (newFactoryL > factoryCaps.maxTotalLiability)
    throw new FactoryCapExceededError(
      `fundNextPeriod: newFactoryL=${newFactoryL} > factoryCap=${factoryCaps.maxTotalLiability}`,
    );

  const newState: AccountingState = { ...state, regularFunded: newF };
  assertConsistentState(newState);

  const event: NoticeVaultEvent = { kind: "PeriodFunded", newF, newD };
  return {
    state: newState,
    events: [event],
    transferAmount: A,
    transferTo: null, // inbound, not outbound
  };
}
