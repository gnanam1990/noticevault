import React, { createContext, useContext, useState, useSyncExternalStore, useCallback } from "react";
import type { DemoRole } from "./types.js";
import { createDemoController } from "./engine.js";
import type { DemoState } from "./engine.js";
import { project } from "./projector.js";
import { calculateReferenceSnapshot } from "@noticevault/domain";
import type { AgreementSnapshot } from "@noticevault/domain";
export { formatScenarioDate } from "./projector.js";
export type { DemoState, DemoCommand } from "./engine.js";
type Controller = ReturnType<typeof createDemoController>;
interface DemoContextValue { state: DemoState; dispatch: Controller["dispatch"]; executeCommand: Controller["executeCommand"]; proposeCommand: Controller["proposeCommand"]; exportRaw: Controller["exportRaw"]; selectedSnapshot: AgreementSnapshot | null; selectedProjection: ReturnType<typeof project> | null; }
const DemoContext=createContext<DemoContextValue|null>(null);
export function DemoProvider({children}:{children:React.ReactNode}) {
  const [controller]=useState(()=>createDemoController({getItem:key=>window.localStorage.getItem(key),setItem:(key,value)=>window.localStorage.setItem(key,value)}));
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot);
  const a=state.agreements.find(x=>x.id===state.selectedId);
  const selectedProjection=a?project(a.id,a.state,a.eventLog,state.clock):null;
  return <DemoContext.Provider value={{state,dispatch:controller.dispatch,executeCommand:controller.executeCommand,proposeCommand:controller.proposeCommand,exportRaw:controller.exportRaw,selectedProjection,selectedSnapshot:selectedProjection?.snapshot??null}}>{children}</DemoContext.Provider>;
}
export function useDemoStore(): DemoContextValue {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error("useDemoStore must be used within DemoProvider");
  return ctx;
}

// ── Action helpers ─────────────────────────────────────────────────────────────

export function useSetClock() {
  const { dispatch } = useDemoStore();
  return useCallback((clock: bigint) => dispatch({ type: "SET_CLOCK", clock }), [dispatch]);
}

export function useSetRole() {
  const { dispatch } = useDemoStore();
  return useCallback((role: DemoRole) => dispatch({ type: "SET_ROLE", role }), [dispatch]);
}

export function useNavigate() {
  const { dispatch } = useDemoStore();
  return {
    toView: useCallback((view: DemoState["view"]) => dispatch({ type: "SET_VIEW", view }), [dispatch]),
    toAgreement: useCallback((id: string) => dispatch({ type: "SELECT_AGREEMENT", id }), [dispatch]),
    back: useCallback(() => dispatch({ type: "SET_VIEW", view: "agreements" }), [dispatch]),
  };
}

export function useAgreementSnapshot(agreementId: string | null): AgreementSnapshot | null {
  const { state } = useDemoStore();
  return React.useMemo((): AgreementSnapshot | null => {
    if (!agreementId) return null;
    const a = state.agreements.find(ag => ag.id === agreementId);
    if (!a) return null;
    try {
      return calculateReferenceSnapshot(a.state, state.clock);
    } catch {
      return null;
    }
  }, [agreementId, state.agreements, state.clock]);
}

/** Reset the entire demo namespace. UI must confirm before calling. */
export function useResetDemo() {
  const { dispatch } = useDemoStore();
  return useCallback(() => {
    dispatch({ type: "RESET_DEMO" });
  }, [dispatch]);
}

