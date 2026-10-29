/** Browser-only synthetic controller. No wallet, network, database, or real payments. */
import { calculateReferenceSnapshot, computeD, createInitialState, startNotice, claimProvider, claimClientRefund, fundNextPeriod, UINT256_MAX } from "@noticevault/domain";
import type { TransitionResult } from "@noticevault/domain";
import type { DemoAgreement, DemoRole, DraftProgress, ActivityEntry, ActionKind } from "./types.js";
import { safeParse, safeStringify, STORAGE_KEYS, validateDemoAgreement, validateDraftProgress, validateActivityEntry } from "./storage.js";
import { buildSeedAgreements, G1_T0, G1_TERMS, DAY } from "./scenarios.js";
import { makeProjectedEvent, project } from "./projector.js";
export const ENVELOPE_KEY = "noticevault-demo-v2:state";
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; }
export interface Envelope { version: 2; source: "SIMULATION"; session: string; revision: number; agreements: DemoAgreement[]; clock: bigint; role: DemoRole; draft: DraftProgress | null; activity: ActivityEntry[]; applied: string[]; }
export interface DemoState extends Envelope { storageErrors: Record<string,string>; storageWriteErrors: Record<string,string>; selectedId: string | null; view: "overview" | "agreements" | "detail" | "new-draft" | "activity" | "readiness"; }
export interface DemoCommand { kind: ActionKind; agreementId: string; revision: number; commandId: string; session: string; clock: bigint; role: DemoRole; expectedD: bigint; }
export type Result = {ok:true} | {ok:false;reason:string};
export type DemoAction = {type:"SET_CLOCK";clock:bigint}|{type:"SET_ROLE";role:DemoRole}|{type:"SET_VIEW";view:DemoState["view"]}|{type:"SELECT_AGREEMENT";id:string|null}|{type:"ADD_AGREEMENT";agreement:DemoAgreement}|{type:"ADD_SCENARIO";scenario:"G1"|"G2"|"G3"}|{type:"SET_DRAFT";draft:DraftProgress|null}|{type:"CLEAR_ACTIVITY"}|{type:"RESET_DEMO"}|{type:"DISMISS_STORAGE_ERROR";key:string}|{type:"DISMISS_WRITE_ERROR";key:string}|{type:"ADD_STORAGE_WRITE_ERROR";key:string;error:string};
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function freeze<T>(value:T):T { if(value && typeof value === "object" && !Object.isFrozen(value)) { for(const v of Object.values(value)) freeze(v); Object.freeze(value); } return value; }
function fresh():Envelope { return {version:2,source:"SIMULATION",session:crypto.randomUUID(),revision:0,agreements:buildSeedAgreements(G1_T0),clock:G1_T0,role:"CLIENT",draft:null,activity:[],applied:[]}; }
export function validateEnvelope(value:unknown): asserts value is Envelope {
  check(value && typeof value === "object" && !Array.isArray(value),"Invalid envelope");
  const e=value as Envelope;
  check(e.version===2 && e.source==="SIMULATION" && typeof e.session==="string" && e.session.length>0,"Invalid envelope provenance/version");
  check(Number.isSafeInteger(e.revision) && e.revision>=0,"Invalid revision");
  check(typeof e.clock==="bigint" && e.clock>0n && e.clock<=253402300799n,"Clock outside supported UTC range");
  check(e.role==="CLIENT" || e.role==="PROVIDER","Invalid role");
  check(Array.isArray(e.agreements) && Array.isArray(e.activity) && Array.isArray(e.applied),"Invalid collections");
  check(e.applied.every(id=>typeof id==="string" && id.length>0) && new Set(e.applied).size===e.applied.length,"Invalid command IDs");
  const ids=new Set<string>();
  for(const [i,a] of e.agreements.entries()) {
    const error=validateDemoAgreement(a,i); check(!error,error ?? "Invalid agreement");
    check(!ids.has(a.id),"Duplicate agreement ID"); ids.add(a.id);
    check(a.createdAt<=e.clock,"Clock precedes agreement creation");
    const eventIds=new Set<string>(); let last=a.createdAt; let funded=a.state.terms.amountPerPeriod, paid=0n, refunded=0n;
    for(const event of a.eventLog) {
      check(!eventIds.has(event.id),"Duplicate event ID"); eventIds.add(event.id);
      check(event.scenarioTime>=last && event.scenarioTime<=e.clock,"Event outside applied timeline"); last=event.scenarioTime;
      if(event.kind==="PeriodFunded") funded+=event.deltaAmount;
      if(event.kind==="ProviderClaimed") paid+=event.deltaAmount;
      if(event.kind==="ClientRefunded") refunded+=event.deltaAmount;
    }
    check(funded===a.state.regularFunded && paid===a.state.regularPaid+a.state.noticePaid && refunded===a.state.clientRefunded,"Event ledger does not reconcile with accounting");
    check((a.state.noticeStartStored!==null)===a.eventLog.some(x=>x.kind==="NoticeStarted"),"Notice ledger does not reconcile");
    const snap=project(a.id,a.state,a.eventLog,e.clock).snapshot;
    check(a.state.regularPaid<=snap.V && a.state.noticePaid<=snap.W,"Paid earnings exceed accrual at clock");
  }
  if(e.draft!==null) { const error=validateDraftProgress(e.draft); check(!error,error ?? "Invalid draft"); }
  const activityIds=new Set<string>();
  for(const [i,event] of e.activity.entries()) { const error=validateActivityEntry(event,i); check(!error,error ?? "Invalid activity"); check(ids.has(event.agreementId) && !activityIds.has(event.id) && event.scenarioTime<=e.clock,"Invalid activity reference/time/ID"); activityIds.add(event.id); }
}
export function buildScenario(scenario:"G1"|"G2"|"G3", clock:bigint):DemoAgreement {
  const age=scenario==="G1"?15n:scenario==="G2"?40n:35n;
  const t0=clock-age*DAY;
  const terms={...G1_TERMS,startAt:t0,acceptanceDeadline:t0+300n};
  let a:DemoAgreement={id:crypto.randomUUID(),name:scenario+" — synthetic lifecycle fixture",state:createInitialState(terms),eventLog:[],createdAt:t0-600n};
  const apply=(r:TransitionResult,now:bigint)=>{ a={...a,state:r.state,eventLog:[...a.eventLog,...r.events.map(e=>makeProjectedEvent(a.id,e,now,a.state.regularFunded))]}; };
  if(scenario==="G3") apply(fundNextPeriod(a.state,t0+29n*DAY,terms.client,computeD(terms,a.state.regularFunded),{maxLiabilityPerAgreement:UINT256_MAX},{currentFactoryLiability:0n,maxTotalLiability:UINT256_MAX}),t0+29n*DAY);
  if(scenario!=="G2") apply(startNotice(a.state,clock,terms.client),clock);
  return a;
}
export function createDemoController(storage:StorageLike) {
  let raw:string|null=null;
  let data=fresh(); const errors:Record<string,string>={};
  try {
    raw=storage.getItem(ENVELOPE_KEY);
    if(raw!==null) {const parsed=safeParse<unknown>(raw);validateEnvelope(parsed);data=parsed;}
    else if(Object.values(STORAGE_KEYS).some(key=>storage.getItem(key)!==null)) throw new Error("Legacy demo data preserved. Export raw storage before explicitly starting a new v2 session.");
    else validateEnvelope(data);
  } catch(err) { errors[ENVELOPE_KEY]=String(err); data={...fresh(),agreements:[]}; }
  let state:DemoState=freeze({...data,storageErrors:errors,storageWriteErrors:{},selectedId:null,view:"overview"});
  const listeners=new Set<()=>void>();
  const emit=()=>{for(const fn of listeners)fn();};
  const fail=(err:unknown):Result=>{const reason=String(err);state=freeze({...state,storageWriteErrors:{command:reason}});emit();return {ok:false,reason};};
  const commit=(next:Envelope):Result=>{
    try {
      check(Object.keys(state.storageErrors).length===0,"Storage quarantined; export and explicitly reset before editing");
      check(storage.getItem(ENVELOPE_KEY)===raw,"Storage changed in another tab; reload before continuing");
      validateEnvelope(next); const serialized=safeStringify(next);
      storage.setItem(ENVELOPE_KEY,serialized); // Only persisted mutation; success precedes notification.
      raw=serialized;data=freeze(next);state=freeze({...state,...data,storageWriteErrors:{}});emit();return {ok:true};
    } catch(err) {return fail(err);}
  };
  const proposeCommand=(agreementId:string,kind:ActionKind):DemoCommand=>{
    const a=data.agreements.find(x=>x.id===agreementId);check(a,"Agreement not found");
    return freeze({agreementId,kind,session:data.session,revision:data.revision,commandId:crypto.randomUUID(),clock:data.clock,role:data.role,expectedD:computeD(a.state.terms,a.state.regularFunded)});
  };
  const executeCommand=(cmd:DemoCommand):Result=>{
    try {
      check(cmd && !data.applied.includes(cmd.commandId),"Command already applied");
      check(cmd.session===data.session && cmd.revision===data.revision && cmd.clock===data.clock && cmd.role===data.role,"Stale confirmation; review current state again");
      const a=data.agreements.find(x=>x.id===cmd.agreementId);check(a,"Agreement not found");
      check(cmd.expectedD===computeD(a.state.terms,a.state.regularFunded),"Stale funding checkpoint");
      check(["FUND_NEXT_PERIOD","START_NOTICE","CLAIM_PROVIDER","CLAIM_REFUND"].includes(cmd.kind),"Unknown command");
      check(data.role===(cmd.kind==="CLAIM_PROVIDER"?"PROVIDER":"CLIENT"),"Action not permitted for this role");
      let r:TransitionResult;
      switch(cmd.kind) {
        case "START_NOTICE":r=startNotice(a.state,data.clock,a.state.terms.client);break;
        case "CLAIM_PROVIDER":r=claimProvider(a.state,data.clock);break;
        case "CLAIM_REFUND":r=claimClientRefund(a.state,data.clock);break;
        case "FUND_NEXT_PERIOD":r=fundNextPeriod(a.state,data.clock,a.state.terms.client,cmd.expectedD,{maxLiabilityPerAgreement:UINT256_MAX},{maxTotalLiability:UINT256_MAX,currentFactoryLiability:data.agreements.reduce((sum,x)=>sum+calculateReferenceSnapshot(x.state,data.clock).L,0n)});break;
      }
      check(r.events.length>0,"No state change or amount available");
      const updated={...a,state:r.state,eventLog:[...a.eventLog,...r.events.map(e=>makeProjectedEvent(a.id,e,data.clock,a.state.regularFunded))]};
      const entry:ActivityEntry={id:cmd.commandId,agreementId:a.id,agreementName:a.name,action:cmd.kind,amount:r.transferAmount,actor:data.role,scenarioTime:data.clock};
      return commit({...data,revision:data.revision+1,agreements:data.agreements.map(x=>x.id===a.id?updated:x),activity:[entry,...data.activity],applied:[...data.applied,cmd.commandId]});
    } catch(err) {return fail(err);}
  };
  const exportRaw=()=>safeStringify(Object.fromEntries([ENVELOPE_KEY,...Object.values(STORAGE_KEYS)].map(key=>[key,storage.getItem(key)])));
  const dispatch=(action:DemoAction):Result=>{
    try {
      if(action.type==="SET_VIEW" || action.type==="SELECT_AGREEMENT") {state=freeze({...state,...(action.type==="SET_VIEW"?{view:action.view}:{selectedId:action.id,view:action.id?"detail" as const:state.view})});emit();return {ok:true};}
      if(action.type==="DISMISS_STORAGE_ERROR") return {ok:false,reason:"Quarantine cannot be dismissed"};
      if(action.type==="DISMISS_WRITE_ERROR") {state=freeze({...state,storageWriteErrors:{}});emit();return {ok:true};}
      if(action.type==="ADD_STORAGE_WRITE_ERROR") return fail(action.error);
      if(action.type==="RESET_DEMO") {
        // Explicit UI confirmation required. Archive every existing payload before replacing only v2.
        const archive=exportRaw();const next=fresh();validateEnvelope(next);const serialized=safeStringify(next);
        const before=storage.getItem(ENVELOPE_KEY);
        storage.setItem("noticevault-demo-v2:archive:"+crypto.randomUUID(),archive);
        check(storage.getItem(ENVELOPE_KEY)===before,"Storage changed during reset");storage.setItem(ENVELOPE_KEY,serialized);
        raw=serialized;data=freeze(next);state=freeze({...data,storageErrors:{},storageWriteErrors:{},selectedId:null,view:"overview"});emit();return {ok:true};
      }
      let next:Envelope={...data,revision:data.revision+1};
      switch(action.type) {
        case "SET_CLOCK":next={...next,clock:action.clock};break;
        case "SET_ROLE":next={...next,role:action.role};break;
        case "SET_DRAFT":check(data.role==="CLIENT","Client role required");next={...next,draft:action.draft};break;
        case "CLEAR_ACTIVITY":next={...next,activity:[]};break;
        case "ADD_SCENARIO":next={...next,agreements:[...data.agreements,buildScenario(action.scenario,data.clock)]};break;
        case "ADD_AGREEMENT":check(data.role==="CLIENT","Client role required");check(!data.agreements.some(a=>a.state.terms.client.toLowerCase()===action.agreement.state.terms.client.toLowerCase() && a.state.terms.clientNonce===action.agreement.state.terms.clientNonce),"Client nonce already used; review a new nonce");check(action.agreement.createdAt===data.clock && action.agreement.eventLog.length===0,"Invalid new agreement");next={...next,agreements:[...data.agreements,action.agreement],draft:null};break;
      }
      return commit(next);
    } catch(err) {return fail(err);}
  };
  return {getSnapshot:()=>state,subscribe:(fn:()=>void)=>{listeners.add(fn);return ()=>{listeners.delete(fn);};},dispatch,proposeCommand,executeCommand,exportRaw};
}
