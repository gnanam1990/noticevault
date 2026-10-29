/**
 * NoticeVault Demo — shared types.
 * All financial values are bigint. SIMULATION provenance is immutable.
 */

import type {
  AgreementTerms,
  AccountingState,
  AgreementSnapshot,
  NoticeVaultEvent,
  AgreementPhase,
} from "@noticevault/domain";

// ── Projected event ───────────────────────────────────────────────────────────

export type EventActor = "CLIENT" | "PROVIDER" | "SYSTEM";

export interface ProjectedEvent {
  readonly id: string;
  readonly kind: NoticeVaultEvent["kind"];
  readonly scenarioTime: bigint;
  readonly deltaAmount: bigint;
  readonly actor: EventActor;
  readonly description: string;
}

// ── Demo agreement ────────────────────────────────────────────────────────────

export interface DemoAgreement {
  readonly id: string;               // demo-local UUID
  readonly name: string;             // human label, e.g. "Protocol Services G1"
  readonly state: AccountingState;
  readonly eventLog: ProjectedEvent[];
  readonly createdAt: bigint;        // scenario clock at creation
}

// ── Synthetic projection ──────────────────────────────────────────────────────

export interface SyntheticProjection {
  readonly source: "SIMULATION";
  readonly generatedAt: bigint;
  readonly agreementId: string;
  readonly state: AccountingState;
  readonly snapshot: AgreementSnapshot;
  readonly eventLog: ProjectedEvent[];
}

// ── Demo role ────────────────────────────────────────────────────────────────

export type DemoRole = "CLIENT" | "PROVIDER";

// ── Pending action (for confirmation dialog) ──────────────────────────────────

export type ActionKind =
  | "FUND_NEXT_PERIOD"
  | "START_NOTICE"
  | "CLAIM_PROVIDER"
  | "CLAIM_REFUND";

export interface PendingAction {
  readonly agreementId: string;
  readonly kind: ActionKind;
  readonly amount: bigint;           // transfer amount (0 for START_NOTICE)
  readonly description: string;
  readonly consequences: string;
}

// ── Draft progress ────────────────────────────────────────────────────────────

export interface DraftProgress {
  readonly name: string;
  readonly fields: Partial<Record<keyof AgreementTerms, string>>; // raw string inputs
}

// ── Activity log entry ───────────────────────────────────────────────────────

export interface ActivityEntry {
  readonly id: string;
  readonly agreementId: string;
  readonly agreementName: string;
  readonly action: string;
  readonly amount: bigint;
  readonly actor: EventActor;
  readonly scenarioTime: bigint;
}

// ── Storage result ────────────────────────────────────────────────────────────

export type StorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; raw: string | null };

// ── Phase colors (Tailwind class names) ──────────────────────────────────────

export const PHASE_STYLES: Record<AgreementPhase, { bg: string; text: string; border: string; label: string }> = {
  SCHEDULED:        { bg: "bg-slate-100",  text: "text-slate-600",  border: "border-slate-200", label: "Scheduled" },
  ACTIVE:           { bg: "bg-blue-50",    text: "text-blue-700",   border: "border-blue-200",  label: "Active" },
  NOTICE_SCHEDULED: { bg: "bg-yellow-100", text: "text-yellow-700", border: "border-yellow-300", label: "Notice Scheduled" },
  NOTICE:           { bg: "bg-orange-100", text: "text-orange-700", border: "border-orange-300", label: "Notice" },
  ENDED_CLAIMABLE:  { bg: "bg-red-50",     text: "text-red-700",    border: "border-red-200",   label: "Ended — Claimable" },
  CLOSED:           { bg: "bg-green-50",   text: "text-green-700",  border: "border-green-200", label: "Closed" },
};
