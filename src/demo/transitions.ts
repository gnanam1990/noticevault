/**
 * NoticeVault Demo — transition wrappers.
 *
 * Each function:
 * 1. Calls the domain function (throws on invalid transition — state unchanged).
 * 2. Wraps domain events into ProjectedEvents.
 * 3. Returns new DemoAgreement (immutable).
 * 4. All financial logic delegated to @noticevault/domain — no reimplementation.
 *
 * Caps: demo uses maxed-out caps (UINT256_MAX) since we're not testing factory limits here.
 */

import {
  startNotice,
  claimProvider,
  claimClientRefund,
  fundNextPeriod,
  UINT256_MAX,
} from "@noticevault/domain";
import type { DemoAgreement } from "./types.js";
import { makeProjectedEvent } from "./projector.js";
import { DEMO_CLIENT_ADDR, DEMO_PROVIDER_ADDR } from "./scenarios.js";

const NO_CAPS = {
  agreementCaps: { maxLiabilityPerAgreement: UINT256_MAX },
  factoryCaps:   { maxTotalLiability: UINT256_MAX, currentFactoryLiability: 0n },
};

// ── Start notice ──────────────────────────────────────────────────────────────

export function applyStartNotice(
  agreement: DemoAgreement,
  now: bigint,
  actor: string,
): DemoAgreement {
  // Throws NoticeAlreadyStartedError, UnauthorizedActorError — propagated to UI.
  const result = startNotice(agreement.state, now, actor);
  const newEvents = result.events.map(e => makeProjectedEvent(agreement.id, e, now));
  return {
    ...agreement,
    state: result.state,
    eventLog: [...agreement.eventLog, ...newEvents],
  };
}

// ── Claim provider ────────────────────────────────────────────────────────────

export function applyClaimProvider(
  agreement: DemoAgreement,
  now: bigint,
): DemoAgreement {
  const result = claimProvider(agreement.state, now);
  if (result.transferAmount === 0n) {
    // No claim — state unchanged. Return same reference.
    return agreement;
  }
  const newEvents = result.events.map(e => makeProjectedEvent(agreement.id, e, now));
  return {
    ...agreement,
    state: result.state,
    eventLog: [...agreement.eventLog, ...newEvents],
  };
}

// ── Claim client refund ───────────────────────────────────────────────────────

export function applyClaimClientRefund(
  agreement: DemoAgreement,
  now: bigint,
): DemoAgreement {
  const result = claimClientRefund(agreement.state, now);
  if (result.transferAmount === 0n) {
    return agreement;
  }
  const newEvents = result.events.map(e => makeProjectedEvent(agreement.id, e, now));
  return {
    ...agreement,
    state: result.state,
    eventLog: [...agreement.eventLog, ...newEvents],
  };
}

// ── Fund next period ──────────────────────────────────────────────────────────

export function applyFundNextPeriod(
  agreement: DemoAgreement,
  now: bigint,
  actor: string,
  expectedFundedThrough: bigint,
): DemoAgreement {
  // Throws CheckpointMismatchError, FundingWindowClosedError, etc. — propagated to UI.
  const prevRegularFunded = agreement.state.regularFunded;
  const result = fundNextPeriod(
    agreement.state,
    now,
    actor,
    expectedFundedThrough,
    NO_CAPS.agreementCaps,
    NO_CAPS.factoryCaps,
  );
  const newEvents = result.events.map(e =>
    makeProjectedEvent(agreement.id, e, now, prevRegularFunded),
  );
  return {
    ...agreement,
    state: result.state,
    eventLog: [...agreement.eventLog, ...newEvents],
  };
}

// ── Convenience re-exports ────────────────────────────────────────────────────

export { DEMO_CLIENT_ADDR, DEMO_PROVIDER_ADDR };
