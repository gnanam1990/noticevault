/**
 * NoticeVault Demo — Synthetic Event Projector (M05).
 *
 * Deterministic, pure, no I/O.
 * source: "SIMULATION" is immutable — never caller-supplied.
 * All financial calculations via @noticevault/domain only.
 */

import {
  calculateReferenceSnapshot,
  computeR,
  computeD,
} from "@noticevault/domain";
import type { AccountingState } from "@noticevault/domain";
import type { SyntheticProjection, ProjectedEvent } from "./types.js";

// ── Event ID ──────────────────────────────────────────────────────────────────

function makeEventId(agreementId: string, kind: string, time: bigint, amount: bigint): string {
  // Deterministic: no random. Same inputs → same ID.
  return `${agreementId}:${kind}:${time.toString(16)}:${amount.toString(16)}`;
}

// ── Projector ─────────────────────────────────────────────────────────────────

export interface ProjectionError extends Error { readonly kind: "ProjectionError" }

export function project(
  agreementId: string,
  state: AccountingState,
  eventLog: ProjectedEvent[],
  now: bigint,
): SyntheticProjection {
  // Validate ordering — events must be in non-decreasing scenarioTime order.
  for (let i = 1; i < eventLog.length; i++) {
    const prev = eventLog[i - 1];
    const curr = eventLog[i];
    if (prev === undefined || curr === undefined) continue;
    if (curr.scenarioTime < prev.scenarioTime) {
      const err = new Error(
        `Out-of-order event at index ${i}: ${curr.scenarioTime} < ${prev.scenarioTime}`,
      ) as ProjectionError & Error;
      (err as { kind: string }).kind = "ProjectionError";
      throw err;
    }
  }

  const seen = new Map<string, ProjectedEvent>();
  const deduped: ProjectedEvent[] = [];
  for (const e of eventLog) {
    if (!["NoticeStarted", "ProviderClaimed", "ClientRefunded", "PeriodFunded"].includes(e.kind) || e.deltaAmount < 0n || e.scenarioTime > now) throw new Error("Invalid or future event");
    const prior = seen.get(e.id);
    if (prior && (prior.kind !== e.kind || prior.scenarioTime !== e.scenarioTime || prior.deltaAmount !== e.deltaAmount || prior.actor !== e.actor || prior.description !== e.description)) throw new Error("Conflicting duplicate event ID");
    if (!prior) { seen.set(e.id, e); deduped.push(e); }
  }

  const snapshot = calculateReferenceSnapshot(state, now);

  return {
    source: "SIMULATION",
    generatedAt: now,
    agreementId,
    state,
    snapshot,
    eventLog: deduped,
  };
}

// ── Build a ProjectedEvent from a domain event ─────────────────────────────────

import type { NoticeVaultEvent } from "@noticevault/domain";

export function makeProjectedEvent(
  agreementId: string,
  domainEvent: NoticeVaultEvent,
  scenarioTime: bigint,
  prevRegularFunded?: bigint, // required for PeriodFunded to compute actual transfer delta
): ProjectedEvent {
  switch (domainEvent.kind) {
    case "NoticeStarted":
      return {
        id: makeEventId(agreementId, "NoticeStarted", scenarioTime, 0n),
        kind: "NoticeStarted",
        scenarioTime,
        deltaAmount: 0n,
        actor: domainEvent.reason === "CLIENT_CANCELLED" ? "CLIENT" : "SYSTEM",
        description: `Notice started (${domainEvent.reason === "CLIENT_CANCELLED" ? "client cancelled" : "missed checkpoint"})`,
      };
    case "ProviderClaimed": {
      const total = domainEvent.regularDelta + domainEvent.noticeDelta;
      return {
        id: makeEventId(agreementId, "ProviderClaimed", scenarioTime, total),
        kind: "ProviderClaimed",
        scenarioTime,
        deltaAmount: total,
        actor: "PROVIDER",
        description: `Provider claimed ${formatUsdc(total)} USDC (regular: ${formatUsdc(domainEvent.regularDelta)}, notice: ${formatUsdc(domainEvent.noticeDelta)})`,
      };
    }
    case "ClientRefunded":
      return {
        id: makeEventId(agreementId, "ClientRefunded", scenarioTime, domainEvent.amount),
        kind: "ClientRefunded",
        scenarioTime,
        deltaAmount: domainEvent.amount,
        actor: "CLIENT",
        description: `Client refund of ${formatUsdc(domainEvent.amount)} USDC`,
      };
    case "PeriodFunded": {
      if (prevRegularFunded === undefined || domainEvent.newF <= prevRegularFunded) throw new Error("PeriodFunded requires previous funding");
      const deltaA = domainEvent.newF - prevRegularFunded;
      return {
        id: makeEventId(agreementId, "PeriodFunded", scenarioTime, domainEvent.newF),
        kind: "PeriodFunded",
        scenarioTime,
        deltaAmount: deltaA,
        actor: "CLIENT",
        description: `Period funded — transferred ${formatUsdc(deltaA)} USDC; new cumulative funded ${formatUsdc(domainEvent.newF)} USDC; funded through ${formatScenarioDate(domainEvent.newD)}`,
      };
    }
  }
}

// ── USDC formatting (display only, not financial logic) ───────────────────────
// 6 decimals. Returns string. Never used in calculations.

export function formatUsdc(microUsdc: bigint): string {
  const abs = microUsdc < 0n ? -microUsdc : microUsdc;
  const whole = abs / 1_000_000n;
  const frac  = abs % 1_000_000n;
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "") || "00";
  const sign = microUsdc < 0n ? "-" : "";
  return `${sign}${whole.toLocaleString()}.${fracStr.padEnd(2, "0")}`;
}

export function formatUsdcShort(microUsdc: bigint): string {
  // Shows 2 decimal places only.
  const abs = microUsdc < 0n ? -microUsdc : microUsdc;
  const whole = abs / 1_000_000n;
  const frac2 = (abs % 1_000_000n) / 10_000n;
  const sign = microUsdc < 0n ? "-" : "";
  return `${sign}${whole.toLocaleString()}.${frac2.toString().padStart(2, "0")}`;
}

// ── Scenario clock display ────────────────────────────────────────────────────

export function formatScenarioDate(unixSeconds: bigint): string {
  const ms = Number(unixSeconds) * 1000;
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export function getInitialClock(terms: AccountingState["terms"]): bigint {
  // Default clock = t0 (start of the first demo agreement).
  return terms.startAt;
}

// ── R / D helpers (forwarded from domain for convenience) ─────────────────────

export { computeR, computeD };
export type { AccountingState };

