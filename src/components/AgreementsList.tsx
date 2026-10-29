import React, { useState, useMemo } from "react";
import { Search, X } from "lucide-react";
import { useDemoStore, useNavigate } from "../demo/DemoStore.js";
import { PhasePill } from "./PhasePill.js";
import { SimBadge } from "./SimBadge.js";
import { calculateReferenceSnapshot } from "@noticevault/domain";
import type { AgreementPhase } from "@noticevault/domain";
import { formatUsdcShort } from "../demo/projector.js";

const ALL_PHASES: AgreementPhase[] = [
  "SCHEDULED", "ACTIVE", "NOTICE_SCHEDULED", "NOTICE", "ENDED_CLAIMABLE", "CLOSED"
];

export function AgreementsList() {
  const { state } = useDemoStore();
  const { toAgreement, toView } = useNavigate();
  const [search, setSearch] = useState("");
  const [phaseFilter, setPhaseFilter] = useState<AgreementPhase | null>(null);

  const rows = useMemo(() => {
    return state.agreements.flatMap(a => {
      let snap = null;
      try { snap = calculateReferenceSnapshot(a.state, state.clock); } catch { return []; }
      return [{ a, snap }];
    }).filter(({ a, snap }) => {
      if (phaseFilter && snap.phase !== phaseFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          a.name.toLowerCase().includes(q) ||
          a.state.terms.client.toLowerCase().includes(q) ||
          a.state.terms.provider.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [state.agreements, state.clock, search, phaseFilter]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Agreements</h1>
          <p className="text-sm text-slate-500 mt-1">{state.agreements.length} total <SimBadge className="ml-1" /></p>
        </div>
        {state.role === "CLIENT" && (
          <button
            onClick={() => toView("new-draft")}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg"
          >
            + New draft
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search name or address…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 pr-8 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={12} />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ALL_PHASES.map(p => (
            <button
              key={p}
              onClick={() => setPhaseFilter(phaseFilter === p ? null : p)}
              className={`px-2.5 py-1 text-xs rounded-full border font-medium transition-colors ${
                phaseFilter === p
                  ? "bg-blue-600 border-blue-600 text-white"
                  : "border-slate-200 text-slate-600 hover:border-slate-300 bg-white"
              }`}
            >
              {p.replace("_", " ")}
            </button>
          ))}
          {(search || phaseFilter) && (
            <button
              onClick={() => { setSearch(""); setPhaseFilter(null); }}
              className="px-2.5 py-1 text-xs rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="text-slate-400 text-sm">No agreements match this filter.</div>
          <button
            onClick={() => { setSearch(""); setPhaseFilter(null); }}
            className="mt-3 text-blue-600 text-sm hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Phase</th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Accrued (V)</th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Claimable</th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Funded through (D)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ a, snap }, i) => (
                <tr
                  key={a.id}
                  onClick={() => toAgreement(a.id)}
                  className={`cursor-pointer hover:bg-blue-50 border-b border-slate-100 last:border-0 ${i % 2 === 0 ? "" : "bg-slate-50/50"}`}
                >
                  <td className="px-5 py-3.5">
                    <div className="font-medium text-slate-800">{a.name}</div>
                    <div className="text-xs text-slate-400 font-mono mt-0.5">
                      {a.state.terms.client.slice(0, 10)}…
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <PhasePill phase={snap.phase} />
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono tabular-nums text-slate-700">
                    ${formatUsdcShort(snap.V)}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono tabular-nums">
                    <span className={snap.providerClaimable > 0n ? "text-blue-700 font-semibold" : "text-slate-400"}>
                      ${formatUsdcShort(snap.providerClaimable)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono tabular-nums text-slate-500 text-xs">
                    {new Date(Number(snap.D) * 1000).toISOString().slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
