/**
 * NoticeVault Demo — seed scenarios.
 *
 * G1, G2, G3 from CORE-CONTRACT-M01.md (corrected G3 derivation).
 * All values bigint. No floats. No financial logic here — only initial state setup.
 * createInitialState from domain creates the first AccountingState.
 *
 * [TEST DATA] — these addresses are synthetic demo-only fixtures.
 * arc-studio-allow-onchain-literal
 */

import { createInitialState, computeR, computeD } from "@noticevault/domain";
import type { AgreementTerms, AccountingState, TokenContext } from "@noticevault/domain";
import type { DemoAgreement } from "./types.js";

// ── Demo constants ─────────────────────────────────────────────────────────────

export const DAY = 86_400n;
export const HOUR = 3_600n;

// [TEST DATA] Synthetic demo addresses — not real wallets or deployed contracts.
export const DEMO_CLIENT_ADDR  = "0xC11e411111111111111111111111111111111111";
export const DEMO_PROVIDER_ADDR = "0xP707070707070707070707070707070707070707".replace("P", "A");
export const DEMO_TOKEN_ADDR   = "0x3600000000000000000000000000000000000000"; // Arc Testnet USDC placeholder

export const DEMO_TOKEN_CTX: TokenContext = {
  allowlistedTokens: new Set([DEMO_TOKEN_ADDR.toLowerCase()]),
  decimals: 6,
};

// ── t0 baseline ───────────────────────────────────────────────────────────────
// All demo scenarios anchor to a synthetic t0 in the past.
// Using 2026-01-01 00:00:00 UTC as demo epoch.
const DEMO_EPOCH: bigint = 1_767_225_600n; // 2026-01-01T00:00:00Z

// G1/G2/G3 all use: A=3_000_000_000, P=N=30 days.
export const G_A = 3_000_000_000n; // micro-USDC per period
export const G_P = 30n * DAY;      // 30 days
export const G_N = 30n * DAY;      // 30 days notice
export const G_T0 = DEMO_EPOCH;    // start

function gTerms(overrides: Partial<AgreementTerms> = {}): AgreementTerms {
  return {
    schemaVersion: 1,
    client:  DEMO_CLIENT_ADDR,
    provider: DEMO_PROVIDER_ADDR,
    token: DEMO_TOKEN_ADDR,
    amountPerPeriod: G_A,
    periodSeconds:   G_P,
    noticeSeconds:   G_N,
    startAt:         G_T0,
    clientNonce:     0n,
    acceptanceDeadline: DEMO_EPOCH + 300n, // already past in scenario time — valid for demo
    termsDocumentHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    ...overrides,
  };
}

// ── G1 — cancel at day 15 ─────────────────────────────────────────────────────

export const G1_TERMS = gTerms({ clientNonce: 1n });
export const G1_T0    = G_T0;
export const G1_D     = G1_T0 + G_P; // day 30
export const G1_CANCEL_TIME = G1_T0 + 15n * DAY;

export function buildG1State(): AccountingState {
  // Initial: funded F=A (one period)
  return createInitialState(G1_TERMS);
}

// ── G2 — no renewal, observe day 40 ──────────────────────────────────────────

export const G2_TERMS = gTerms({ clientNonce: 2n });
export const G2_T0    = G_T0;
export const G2_D     = G2_T0 + G_P; // day 30

export function buildG2State(): AccountingState {
  return createInitialState(G2_TERMS);
}

// ── G3 — renew day 29, cancel day 35 ─────────────────────────────────────────
// After renewal: F=6e9, D=day60. Cancel at day35: V_S=3_500_000_000, refund=2_500_000_000.

export const G3_TERMS = gTerms({ clientNonce: 3n });
export const G3_T0    = G_T0;
export const G3_D1    = G3_T0 + G_P;      // day 30 (first funded-through)
export const G3_D2    = G3_T0 + 2n * G_P; // day 60 (after renewal)
export const G3_RENEWAL_TIME = G3_T0 + 29n * DAY;
export const G3_CANCEL_TIME  = G3_T0 + 35n * DAY;

export function buildG3State(): AccountingState {
  return createInitialState(G3_TERMS);
}

// ── Scenario clock presets ─────────────────────────────────────────────────────

export interface ClockPreset {
  readonly id: string;
  readonly label: string;
  readonly scenarioId: "G1" | "G2" | "G3";
  readonly time: bigint;
  readonly description: string;
}

export const CLOCK_PRESETS: ClockPreset[] = [
  { id: "g1-t0",    scenarioId: "G1", time: G1_T0,                       label: "G1: Start (t0)",          description: "Agreement just started" },
  { id: "g1-d15",   scenarioId: "G1", time: G1_T0 + 15n * DAY,           label: "G1: Day 15",              description: "Midway through first period" },
  { id: "g1-d30",   scenarioId: "G1", time: G1_T0 + 30n * DAY,           label: "G1: Day 30 (D)",          description: "Funded-through deadline" },
  { id: "g1-d45",   scenarioId: "G1", time: G1_T0 + 45n * DAY,           label: "G1: Day 45 (E)",          description: "Notice fully vested" },
  { id: "g2-d29",   scenarioId: "G2", time: G2_T0 + 29n * DAY,           label: "G2: Day 29",              description: "Last day to renew" },
  { id: "g2-d40",   scenarioId: "G2", time: G2_T0 + 40n * DAY,           label: "G2: Day 40",              description: "Overdue (missed checkpoint)" },
  { id: "g2-d60",   scenarioId: "G2", time: G2_T0 + 60n * DAY,           label: "G2: Day 60 (E)",          description: "Notice fully vested" },
  { id: "g3-d29",   scenarioId: "G3", time: G3_RENEWAL_TIME,              label: "G3: Day 29 (renew)",      description: "Renewal opportunity" },
  { id: "g3-d35",   scenarioId: "G3", time: G3_CANCEL_TIME,               label: "G3: Day 35 (cancel)",     description: "Cancel 5 days into second period" },
  { id: "g3-d65",   scenarioId: "G3", time: G3_T0 + 65n * DAY,           label: "G3: Day 65 (E)",          description: "Notice fully vested after renewal+cancel" },
];

// ── Initial demo agreements (seeded on first load) ────────────────────────────

export function buildSeedAgreements(_now: bigint): DemoAgreement[] {
  return [
    {
      id: "demo-g1",
      name: "Protocol Services — G1 (cancel day 15)",
      state: buildG1State(),
      eventLog: [],
      createdAt: G_T0 - 600n,
    },
    {
      id: "demo-g2",
      name: "Infrastructure Retainer — G2 (no renewal)",
      state: buildG2State(),
      eventLog: [],
      createdAt: G_T0 - 600n,
    },
    {
      id: "demo-g3",
      name: "Development Sprint — G3 (renew, then cancel)",
      state: buildG3State(),
      eventLog: [],
      createdAt: G_T0 - 600n,
    },
  ];
}

// ── R (notice reserve) helper ─────────────────────────────────────────────────

export function computeNoticeReserve(terms: AgreementTerms): bigint {
  return computeR(terms);
}

export function computeFundedThrough(terms: AgreementTerms, F: bigint): bigint {
  return computeD(terms, F);
}

