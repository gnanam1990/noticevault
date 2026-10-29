import React from "react";
import { Home, List, Plus, CheckSquare, Clock, Activity } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useDemoStore, useSetRole, useNavigate, formatScenarioDate } from "../demo/DemoStore.js";
import type { DemoState } from "../demo/DemoStore.js";

const NAV_ITEMS: { view: DemoState["view"]; label: string; icon: LucideIcon }[] = [
  { view: "overview",    label: "Overview",    icon: Home },
  { view: "agreements",  label: "Agreements",  icon: List },
  { view: "new-draft",   label: "Create agreement",   icon: Plus },
  { view: "activity",    label: "Activity",    icon: Activity },
  { view: "readiness",   label: "Readiness",   icon: CheckSquare },
];

export function Sidebar() {
  const { state } = useDemoStore();
  const setRole = useSetRole();
  const { toView } = useNavigate();

  return (
    <aside
      className="hidden md:flex flex-col w-60 shrink-0 h-screen sticky top-0 overflow-y-auto"
      style={{ background: "#12243c" }}
      aria-label="Main navigation"
    >
      {/* Logo */}
      <div className="px-6 py-4 border-b border-white/10">
        <span className="text-white font-bold text-lg tracking-tight">Demo workspace</span>
        <span className="block text-white/40 text-xs mt-0.5">Synthetic Demo</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(item => {
          const Icon = item.icon;
          const active = state.view === item.view;
          return (
            <button
              key={item.view}
              onClick={() => toView(item.view)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                active
                  ? "bg-white/15 text-white border-l-2 border-white"
                  : "text-white/70 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon size={16} className="shrink-0" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <details className="px-4 py-3 text-white/80"><summary className="text-sm">Advanced demo clock</summary>
      {/* Scenario clock */}
      <div className="px-4 py-3 border-t border-white/10">
        <div className="flex items-center gap-2 mb-1">
          <Clock size={12} className="text-white/40" />
          <span className="text-white/40 text-xs font-medium uppercase tracking-wider">Scenario clock</span>
        </div>
        <div className="font-mono text-white/70 text-xs leading-relaxed">
          {formatScenarioDate(state.clock)}
        </div>
        <ClockStepButtons />
      </div>

      </details>
      {/* Role switcher */}
      <div className="px-4 py-3 border-t border-white/10">
        <div className="text-white/40 text-xs font-medium uppercase tracking-wider mb-2">Role</div>
        <div className="flex rounded-lg overflow-hidden border border-white/20">
          {(["CLIENT", "PROVIDER"] as const).map(r => (
            <button
              key={r}
              onClick={() => setRole(r)}
              className={`flex-1 py-1.5 text-xs font-semibold transition-colors ${
                state.role === r
                  ? "bg-white text-blue-900"
                  : "text-white/60 hover:text-white hover:bg-white/10"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function ClockStepButtons() {
  const { state, dispatch } = useDemoStore();
  const step = (delta: bigint) => dispatch({ type: "SET_CLOCK", clock: state.clock + delta });
  const DAY = 86_400n;

  return (
    <div className="flex gap-1 mt-2">
      {([
        ["-1d", -DAY],
        ["+1d", DAY],
        ["+7d", 7n * DAY],
        ["+30d", 30n * DAY],
      ] as [string, bigint][]).map(([label, delta]) => (
        <button
          key={label}
          onClick={() => step(delta)}
          className="flex-1 py-0.5 text-[10px] font-mono rounded border border-white/20 text-white/60 hover:bg-white/10 hover:text-white transition-colors"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
