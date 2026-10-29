import React, { useState } from "react";
import { useDemoStore } from "../demo/DemoStore.js";
import { SimBadge } from "./SimBadge.js";
import { formatUsdcShort } from "../demo/projector.js";

export function ActivityLog() {
  const { state, dispatch } = useDemoStore();
  const [clearConfirm, setClearConfirm] = useState(false);

  const handleClear = () => {
    if (!clearConfirm) { setClearConfirm(true); return; }
    dispatch({ type: "CLEAR_ACTIVITY" });
    setClearConfirm(false);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Activity log</h1>
          <p className="text-slate-500 text-sm mt-1">{state.activity.length} entries <SimBadge className="ml-1" /></p>
        </div>
        {state.activity.length > 0 && (
          <button
            onClick={handleClear}
            className={`px-3 py-1.5 text-xs border rounded-lg ${clearConfirm ? "border-red-400 bg-red-50 text-red-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
          >
            {clearConfirm ? "Click again to confirm clear" : "Clear log"}
          </button>
        )}
      </div>

      {state.activity.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 text-sm">
          No activity yet. Confirm actions on agreements to see them here.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Time</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Agreement</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Action</th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Amount</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Actor</th>
              </tr>
            </thead>
            <tbody>
              {state.activity.map((e, i) => (
                <tr key={e.id} className={`border-b border-slate-100 last:border-0 ${i % 2 === 0 ? "" : "bg-slate-50/50"}`}>
                  <td className="px-5 py-3 font-mono text-xs text-slate-400">
                    {new Date(Number(e.scenarioTime) * 1000).toISOString().slice(0, 10)}
                  </td>
                  <td className="px-4 py-3 text-slate-600 max-w-[200px] truncate">{e.agreementName}</td>
                  <td className="px-4 py-3 text-slate-700">{e.action}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {e.amount > 0n ? (
                      <span className="text-blue-700 font-semibold">${formatUsdcShort(e.amount)}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${e.actor === "CLIENT" ? "bg-blue-50 text-blue-700" : e.actor === "PROVIDER" ? "bg-yellow-50 text-yellow-700" : "bg-slate-100 text-slate-600"}`}>
                      {e.actor}
                    </span>
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
