import React from "react";
import { Home, List, Plus, Activity, CheckSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useDemoStore, useNavigate } from "../demo/DemoStore.js";
import type { DemoState } from "../demo/DemoStore.js";

const NAV: { view: DemoState["view"]; label: string; icon: LucideIcon }[] = [
  { view: "overview",    label: "Home",      icon: Home },
  { view: "agreements",  label: "Agreements", icon: List },
  { view: "new-draft",   label: "New",       icon: Plus },
  { view: "activity",    label: "Activity",  icon: Activity },
  { view: "readiness",   label: "Readiness", icon: CheckSquare },
];

export function MobileNav() {
  const { state } = useDemoStore();
  const { toView } = useNavigate();

  return (
    <nav
      className="nv-mobile-nav md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex z-10"
      aria-label="Mobile navigation"
    >
      {NAV.map(item => {
        const Icon = item.icon;
        const active = state.view === item.view || (state.view === "detail" && item.view === "agreements");
        return (
          <button
            key={item.view}
            onClick={() => toView(item.view)}
            className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${
              active ? "text-blue-600" : "text-slate-400 hover:text-slate-700"
            }`}
          >
            <Icon size={18} />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}


export function MobileControls() {
  const {state,dispatch}=useDemoStore();
  return <section className="md:hidden p-3 bg-white border-b border-slate-200 space-y-2" aria-label="Demo role and scenario time">
    <div className="flex items-center gap-2"><span className="text-xs text-slate-600">Demo role</span>{(["CLIENT","PROVIDER"] as const).map(role=><button type="button" key={role} aria-pressed={state.role===role} onClick={()=>dispatch({type:"SET_ROLE",role})} className={"min-h-11 px-3 rounded border text-xs font-semibold "+(state.role===role?"bg-blue-900 text-white":"bg-white text-slate-700")}>{role}</button>)}</div>
    <details><summary className="text-sm text-slate-600 py-2">Advanced demo clock</summary><div className="flex gap-2 items-center"><span className="text-xs text-slate-600">Scenario time</span>{([[-1n,"−1 day"],[1n,"+1 day"],[30n,"+30 days"]] as const).map(([days,label])=><button type="button" key={label} className="min-h-11 px-2 rounded border text-xs" onClick={()=>dispatch({type:"SET_CLOCK",clock:state.clock+days*86400n})}>{label}</button>)}</div>
    <p className="text-xs text-slate-600">{new Date(Number(state.clock)*1000).toISOString().replace("T"," ").slice(0,19)} UTC</p></details>
  </section>;
}
