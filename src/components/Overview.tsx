import React from "react";
import { TrendingUp, Shield, RefreshCw, AlertCircle } from "lucide-react";
import { useDemoStore, useNavigate, useResetDemo } from "../demo/DemoStore.js";
import { SimBadge } from "./SimBadge.js";
import { PhasePill } from "./PhasePill.js";
import { calculateReferenceSnapshot, computeR } from "@noticevault/domain";
import { formatUsdcShort, formatScenarioDate } from "../demo/projector.js";
import { CLOCK_PRESETS } from "../demo/scenarios.js";
import type { AgreementSnapshot } from "@noticevault/domain";

export function Overview() {
  const { state, dispatch } = useDemoStore();
  const { toView, toAgreement } = useNavigate();
  const resetDemo = useResetDemo();
  const { agreements, clock, role } = state;

  // Compute aggregate stats using domain.
  // Track malformed agreements separately so totals are never silently wrong.
  let totalL = 0n;
  let totalProviderClaimable = 0n;
  let totalClientRefundable = 0n;
  let totalNoticeReserveOutstanding = 0n; // sum of (R - NP) for all agreements in notice phase
  let activeCount = 0;
  const errors: string[] = [];

  for (const a of agreements) {
    try {
      const snap: AgreementSnapshot = calculateReferenceSnapshot(a.state, clock);
      totalL += snap.L;
      totalProviderClaimable += snap.providerClaimable;
      totalClientRefundable += snap.clientRefundable;
      // Notice reserve outstanding = R − NP (how much of the reserve is uncommitted)
      {
        const R = computeR(a.state.terms);
        const NP = a.state.noticePaid;
        totalNoticeReserveOutstanding += R > NP ? R - NP : 0n;
      }
      if (snap.phase === "ACTIVE" || snap.phase === "NOTICE" || snap.phase === "NOTICE_SCHEDULED") {
        activeCount++;
      }
    } catch (err) {
      errors.push(`Agreement "${a.name}" (${a.id}): ${String(err)}`);
    }
  }

  const snapshotErrors=errors;
  const handleLoadPreset=(scenario:"G1"|"G2"|"G3")=>dispatch({type:"ADD_SCENARIO",scenario});

  const handleResetDemo = () => {
    if (!confirm(
      "Archive the current demo payloads and start a new synthetic session? Existing v1 keys and other apps are preserved.",
    )) return;
    resetDemo();
  };

  const handleClockPreset = (time: bigint) => {
    // Guard against rewinding clock before the latest applied event.
    const latestEvent = agreements.flatMap(a => a.eventLog).reduce<bigint | null>(
      (max, e) => (max === null || e.scenarioTime > max ? e.scenarioTime : max),
      null,
    );
    if (latestEvent !== null && time < latestEvent) {
      alert(
        `Cannot set clock to ${formatScenarioDate(time)}.\n` +
        `Events have been applied at ${formatScenarioDate(latestEvent)} — rewinding would produce impossible state.\n` +
        `Set clock to ${formatScenarioDate(latestEvent)} or later.`,
      );
      return;
    }
    dispatch({ type: "SET_CLOCK", clock: time });
  };

  return (
    <div className="nv-page">
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="nv-eyebrow">YOUR AGREEMENTS AT A GLANCE</p><h1 className="nv-page-title">A clearer view of every agreement.</h1>
          <p className="nv-subtitle">Track payments, notice periods and what needs your attention.</p>
        </div>
        <button
          onClick={() => toView("new-draft")}
          className="nv-primary shrink-0"
        >
          Create demo agreement
        </button>
      </div>

      {/* Snapshot errors — malformed agreements with explicit error list */}
      {snapshotErrors.length > 0 && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-center gap-2 text-yellow-800 text-sm font-medium mb-1">
            <AlertCircle size={14} />
            {snapshotErrors.length} agreement{snapshotErrors.length > 1 ? "s" : ""} could not be projected — excluded from totals
          </div>
          <ul className="text-xs text-yellow-700 space-y-0.5 list-disc list-inside">
            {snapshotErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {/* Aggregate cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard
          label="Active agreements"
          value={String(activeCount)}
          sub={`${agreements.length} total`}
          icon={<List16 />}
        />
        <StatCard
          label={role === "PROVIDER" ? "Claimable earnings" : "Outstanding liability"}
          value={`$${formatUsdcShort(role === "PROVIDER" ? totalProviderClaimable : totalL)}`}
          sub={snapshotErrors.length > 0 ? "SIMULATION (partial)" : "SIMULATION"}
          icon={<TrendingUp size={16} className="text-blue-500" />}
          highlight="blue"
        />
        <StatCard
          label={role === "CLIENT" ? "Refundable" : "Notice reserves outstanding"}
          value={`$${formatUsdcShort(role === "CLIENT" ? totalClientRefundable : totalNoticeReserveOutstanding)}`}
          sub={snapshotErrors.length > 0 ? "SIMULATION (partial)" : "SIMULATION"}
          icon={<Shield size={16} className="text-yellow-500" />}
          highlight="gold"
        />
      </div>

      <div className="nv-next"><strong>Your next step</strong><p>{role === "PROVIDER" ? "Open an agreement to review its claimable earnings and notice status." : "Open an agreement to review its funding, notice period and available refund."} All actions in this view are simulated.</p></div>
      <details className="nv-advanced"><summary>Advanced demo tools · clock &amp; scenarios</summary><p>Scenario clock: {formatScenarioDate(clock)}</p><button onClick={handleResetDemo} className="nv-secondary my-4"><RefreshCw size={14}/> Reset demo</button>
      {/* Scenario clock presets */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">Clock presets</h2>
          <SimBadge />
        </div>
        <p className="text-sm text-slate-500 mb-3">
          Advance the scenario clock to a canonical time point.
          Cannot rewind past the latest applied event.
        </p>
        <div className="flex flex-wrap gap-2">
          {CLOCK_PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => handleClockPreset(p.time)}
              title={p.description}
              className="px-3 py-1.5 text-xs border border-slate-200 bg-slate-50 text-slate-700 rounded-lg hover:bg-slate-100"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Add scenario instance */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">Add scenario instance</h2>
          <SimBadge />
        </div>
        <p className="text-sm text-slate-500 mb-4">
          Add a new agreement seeded to a standard scenario, anchored at the current clock.
          Existing agreements are preserved.
        </p>
        <div className="flex flex-wrap gap-2">
          {(["G1", "G2", "G3"] as const).map(id => {
            const labels: Record<string, string> = {
              G1: "Add G1 — Cancel day 15",
              G2: "Add G2 — No renewal, day 40",
              G3: "Add G3 — Renew day 29, cancel day 35",
            };
            return (
              <button
                key={id}
                onClick={() => handleLoadPreset(id)}
                className="px-4 py-2 text-sm border border-blue-200 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 font-medium min-h-[44px]"
              >
                {labels[id]}
              </button>
            );
          })}
        </div>
      </div>

      </details>
      {/* Agreement list preview */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">Agreements</h2>
          <button
            onClick={() => toView("agreements")}
            className="text-sm text-blue-600 hover:underline"
          >
            View all
          </button>
        </div>
        <div className="divide-y divide-slate-100">
          {agreements.slice(0, 5).map(a => {
            let snap: AgreementSnapshot | null = null;
            let snapErr: string | null = null;
            try { snap = calculateReferenceSnapshot(a.state, clock); }
            catch (err) { snapErr = String(err); }
            return (
              <button
                key={a.id}
                onClick={() => toAgreement(a.id)}
                className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 text-left group"
              >
                <div>
                  <div className="text-sm font-medium text-slate-800 group-hover:text-blue-700">{a.name}</div>
                  <div className="text-xs text-slate-400 mt-0.5 font-mono">
                    {snapErr
                      ? <span className="text-red-500">Error: {snapErr.slice(0, 60)}</span>
                      : `USDC $${formatUsdcShort(a.state.terms.amountPerPeriod)}/period`
                    }
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {snap && <PhasePill phase={snap.phase} />}
                  <span className="text-slate-300">›</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label, value, sub, icon, highlight,
}: {
  label: string; value: string; sub: string; icon: React.ReactNode; highlight?: "blue" | "gold";
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      </div>
      <div className={`text-2xl font-bold tabular-nums font-mono ${highlight === "blue" ? "text-blue-700" : highlight === "gold" ? "text-yellow-700" : "text-slate-900"}`}>
        {value}
      </div>
      <div className="text-xs text-slate-400 mt-1">{sub}</div>
    </div>
  );
}

function List16() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="1.5" rx="0.75" fill="#94A3B8" />
      <rect x="2" y="7.25" width="12" height="1.5" rx="0.75" fill="#94A3B8" />
      <rect x="2" y="11.5" width="8" height="1.5" rx="0.75" fill="#94A3B8" />
    </svg>
  );
}

