import React, { useState, useCallback } from "react";
import { ArrowLeft, Download, Shield, TrendingUp, Clock } from "lucide-react";
import { useDemoStore, useNavigate } from "../demo/DemoStore.js";
import type { DemoCommand } from "../demo/DemoStore.js";
import { SimBadge } from "./SimBadge.js";
import { PhasePill } from "./PhasePill.js";
import { AmountRow } from "./AmountRow.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import type { DialogAction } from "./ConfirmDialog.js";
import { computeR, computeD } from "@noticevault/domain";
import { formatUsdcShort, formatScenarioDate } from "../demo/projector.js";
import { safeStringify } from "../demo/storage.js";

export function AgreementDetail() {
  const { state, selectedSnapshot: snap, executeCommand, proposeCommand } = useDemoStore();
  const { back } = useNavigate();
  const [pendingAction, setPendingAction] = useState<DialogAction | null>(null);
  const [pendingCmd, setPendingCmd] = useState<DemoCommand | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── ALL hooks must be called unconditionally (before any early return) ────────

  const handleConfirm = useCallback(() => {
    if (!pendingCmd) return;
    setConfirming(true);
    setError(null);
    try {
      const result = executeCommand(pendingCmd);
      if (!result.ok) {
        setError(result.reason);
      }
      setPendingAction(null);
      setPendingCmd(null);
    } finally {
      setConfirming(false);
    }
  }, [pendingCmd, executeCommand]);

  const handleCancel = useCallback(() => {
    setPendingAction(null);
    setPendingCmd(null);
    setError(null);
  }, []);

  // ── Now safe to do early return ───────────────────────────────────────────────

  const agreement = state.agreements.find(a => a.id === state.selectedId);

  if (!agreement || !snap) {
    return (
      <div className="p-6">
        <button onClick={back} className="flex items-center gap-2 text-slate-500 hover:text-slate-800 text-sm mb-4">
          <ArrowLeft size={14} /> Back
        </button>
        <div className="text-slate-400">Agreement not found or snapshot unavailable.</div>
        <ConfirmDialog action={pendingAction} onConfirm={handleConfirm} onCancel={handleCancel} confirming={confirming} />
      </div>
    );
  }

  const { terms } = agreement.state;
  const R = computeR(terms);
  const D = computeD(terms, agreement.state.regularFunded);

  // Derive actor addresses from the agreement terms (not hardcoded demo constants).
  const clientActor  = terms.client;
  const providerActor = terms.provider;

  // ── Action availability (derived from domain snapshot) ─────────────────────

  const canFundNextPeriod = state.role === "CLIENT"
    && snap.phase === "ACTIVE"
    && !snap.hasStoredNotice
    && snap.S === null;

  const canStartNotice = state.role === "CLIENT"
    && (snap.phase === "ACTIVE" || snap.phase === "SCHEDULED")
    && !snap.hasStoredNotice;

  const canClaimProvider = state.role === "PROVIDER"
    && snap.providerClaimable > 0n;

  const canClaimRefund = state.role === "CLIENT"
    && snap.clientRefundable > 0n;

  // ── Queue an action (stores command + transition fn, opens dialog) ─────────

  function queueAction(
    action: DialogAction,
    kind: DemoCommand["kind"],
  ) {
    setError(null);
    if (!agreement) return;
    try {
      const cmd=proposeCommand(agreement.id,kind);
      setPendingAction(action);setPendingCmd(cmd);
    } catch(err) {setError(String(err));}
  }

  const handleFundNextPeriod = () => {
    queueAction(
      {
        title: "Fund next period",
        amount: terms.amountPerPeriod,
        from: clientActor,
        to: "Agreement contract (escrow)",
        description: `Fund one more period (A = $${formatUsdcShort(terms.amountPerPeriod)} USDC). Extends funded-through deadline by one period.`,
        consequences: "SIMULATION: No real token transfer. Funded-through date will advance by one period.",
      },
      "FUND_NEXT_PERIOD",
    );
  };

  const handleStartNotice = () => {
    queueAction(
      {
        title: "Start cancellation notice",
        amount: 0n,
        from: clientActor,
        to: "—",
        description: "Begin the notice period. The notice reserve will vest over the notice period. No immediate transfer.",
        consequences: "SIMULATION: Regular accrual freezes. Client refund and provider notice accrual begin.",
      },
      "START_NOTICE",
    );
  };

  const handleClaimProvider = () => {
    queueAction(
      {
        title: "Claim provider earnings",
        amount: snap.providerClaimable,
        from: "Agreement contract",
        to: providerActor,
        description: `Claim $${formatUsdcShort(snap.providerClaimable)} USDC accrued earnings.`,
        consequences: "SIMULATION: RP and/or NP updated. Liability reduced.",
      },
      "CLAIM_PROVIDER",
    );
  };

  const handleClaimRefund = () => {
    queueAction(
      {
        title: "Claim client refund",
        amount: snap.clientRefundable,
        from: "Agreement contract",
        to: clientActor,
        description: `Claim $${formatUsdcShort(snap.clientRefundable)} USDC refund.`,
        consequences: "SIMULATION: CR updated. Remaining liability reduced.",
      },
      "CLAIM_REFUND",
    );
  };

  // ── Export (uses lossless safeStringify throughout) ────────────────────────

  const handleExport = () => {
    const exportData = {
      source: "SIMULATION" as const,
      exportedAt: new Date().toISOString(),
      scenarioTime: agreement.state.terms.startAt, // placeholder — real clock passed below
      agreementId: agreement.id,
      name: agreement.name,
      // All bigint fields serialized via safeStringify bigint: tagging.
      state: agreement.state,
      snapshot: snap,
      eventLog: agreement.eventLog,
    };
    // safeStringify handles all nested bigints in state, snapshot, and eventLog.
    const jsonStr = safeStringify({
      ...exportData,
      scenarioTime: state.clock,
    });
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `noticevault-sim-${agreement.id}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Conservation check (display only) ─────────────────────────────────────
  const { regularFunded: F, regularPaid: RP, noticePaid: NP, clientRefunded: CR } = agreement.state;
  const conservationLhs = F + R;
  const conservationRhs = RP + NP + CR + snap.L;
  const conservationOk = conservationLhs === conservationRhs;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <button onClick={back} className="flex items-center gap-2 text-slate-400 hover:text-slate-700 text-sm mb-2">
            <ArrowLeft size={14} /> Agreements
          </button>
          <h1 className="text-xl font-bold text-slate-900">{agreement.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <PhasePill phase={snap.phase} />
            <SimBadge />
          </div>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-3 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50"
        >
          <Download size={12} />
          Export evidence
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {/* Terms card */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <Shield size={15} className="text-slate-400" /> Agreement terms
          </h2>
          <div className="space-y-0">
            <TermRow label="Amount per period (A)" value={`$${formatUsdcShort(terms.amountPerPeriod)} USDC`} />
            <TermRow label="Period (P)" value={`${Number(terms.periodSeconds) / 86400} days`} />
            <TermRow label="Notice period (N)" value={`${Number(terms.noticeSeconds) / 86400} days`} />
            <TermRow label="Start (t0)" value={formatScenarioDate(terms.startAt)} />
            <TermRow label="Notice reserve (R, computed)" value={`$${formatUsdcShort(R)} USDC`} mono />
            <TermRow label="Funded-through (D, computed)" value={formatScenarioDate(D)} />
            <TermRow label="Client" value={terms.client} mono addr />
            <TermRow label="Provider" value={terms.provider} mono addr />
          </div>
        </div>

        {/* Accounting card */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <TrendingUp size={15} className="text-slate-400" /> Accounting breakdown
            <SimBadge />
          </h2>
          <AmountRow label="Total funded (F)" amount={F} />
          <AmountRow label="Regular paid (RP)" amount={RP} small />
          <AmountRow label="Notice paid (NP)" amount={NP} small />
          <AmountRow label="Client refunded (CR)" amount={CR} small />
          <div className="border-t border-slate-100 mt-2 pt-2">
            <AmountRow label="Outstanding liability (L)" amount={snap.L} highlight="blue" />
          </div>
          <div className={`text-xs mt-2 px-2 py-1 rounded flex items-center gap-1.5 ${conservationOk ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            <span>{conservationOk ? "✓" : "✗"}</span>
            <span>
              Conservation: F+R = RP+NP+CR+L{" "}
              {conservationOk ? "(verified)" : `(FAIL: diff=${conservationLhs - conservationRhs})`}
            </span>
          </div>
          <div className="border-t border-slate-100 mt-3 pt-3 space-y-0">
            <AmountRow label="Accrued regular (V)" amount={snap.V} highlight="blue" />
            <AmountRow label="Notice vested (W)" amount={snap.W} highlight="gold" small />
            <AmountRow label="Provider claimable" amount={snap.providerClaimable} highlight={snap.providerClaimable > 0n ? "blue" : "none"} />
            <AmountRow label="Client refundable" amount={snap.clientRefundable} highlight={snap.clientRefundable > 0n ? "green" : "none"} />
            <AmountRow label="Notice remaining (R−NP)" amount={snap.noticeRemaining} small />
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-5">
        <h2 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <Clock size={15} className="text-slate-400" /> Timeline
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <TimeEntry label="Start (t0)" value={formatScenarioDate(terms.startAt)} />
          <TimeEntry label="Funded-through (D)" value={formatScenarioDate(D)} />
          {snap.S !== null && <TimeEntry label="Notice start (S)" value={formatScenarioDate(snap.S)} />}
          {snap.E !== null && <TimeEntry label="Notice end (E)" value={formatScenarioDate(snap.E)} />}
        </div>
      </div>

      {/* Actions */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-5">
        <h2 className="font-semibold text-slate-800 mb-4">Actions</h2>
        <div className="flex flex-wrap gap-3">
          {canFundNextPeriod && (
            <ActionButton
              label="Fund next period"
              sub={`+$${formatUsdcShort(terms.amountPerPeriod)}`}
              onClick={handleFundNextPeriod}
              variant="primary"
            />
          )}
          {canStartNotice && (
            <ActionButton
              label="Start cancellation notice"
              sub="Freeze regular accrual"
              onClick={handleStartNotice}
              variant="warning"
            />
          )}
          {canClaimProvider && (
            <ActionButton
              label="Claim provider earnings"
              sub={`$${formatUsdcShort(snap.providerClaimable)}`}
              onClick={handleClaimProvider}
              variant="primary"
            />
          )}
          {canClaimRefund && (
            <ActionButton
              label="Claim refund"
              sub={`$${formatUsdcShort(snap.clientRefundable)}`}
              onClick={handleClaimRefund}
              variant="success"
            />
          )}
          {!canFundNextPeriod && !canStartNotice && !canClaimProvider && !canClaimRefund && (
            <p className="text-sm text-slate-400">
              No actions available for the {state.role.toLowerCase()} role at the current scenario clock.
            </p>
          )}
        </div>
      </div>

      {/* Event log */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h2 className="font-semibold text-slate-800 mb-4">
          Event log <SimBadge className="ml-1" />
        </h2>
        {agreement.eventLog.length === 0 ? (
          <p className="text-sm text-slate-400">No events yet.</p>
        ) : (
          <div className="space-y-0">
            {[...agreement.eventLog].reverse().map(e => (
              <div key={e.id} className="flex items-start gap-3 text-sm py-2 border-b border-slate-50 last:border-0">
                <span className="font-mono text-xs text-slate-400 shrink-0 mt-0.5">
                  {new Date(Number(e.scenarioTime) * 1000).toISOString().slice(0, 10)}
                </span>
                <span className="flex-1 text-slate-700">{e.description}</span>
                {e.deltaAmount > 0n && (
                  <span className="font-mono tabular-nums text-blue-700 text-xs shrink-0">
                    ${formatUsdcShort(e.deltaAmount)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        action={pendingAction}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        confirming={confirming}
      />
    </div>
  );
}

function TermRow({ label, value, mono = false, addr = false }: {
  label: string; value: string; mono?: boolean; addr?: boolean;
}) {
  return (
    <div className="flex justify-between items-baseline py-1.5 border-b border-slate-50 last:border-0 gap-4">
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      <span className={`text-sm text-slate-700 text-right ${mono ? "font-mono" : ""} ${addr ? "text-xs truncate max-w-[180px]" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function TimeEntry({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className="text-xs font-mono text-slate-700">{value}</div>
    </div>
  );
}

function ActionButton({
  label, sub, onClick, variant,
}: {
  label: string; sub: string; onClick: () => void; variant: "primary" | "warning" | "success";
}) {
  const cls = {
    primary: "bg-blue-600 hover:bg-blue-700 text-white",
    warning: "bg-yellow-500 hover:bg-yellow-600 text-white",
    success: "bg-green-600 hover:bg-green-700 text-white",
  }[variant];
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 rounded-lg text-sm font-medium ${cls} min-h-[44px] flex flex-col items-start`}
    >
      <span>{label}</span>
      <span className="text-xs opacity-80 mt-0.5">{sub}</span>
    </button>
  );
}

