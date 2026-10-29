import {describe,it,expect} from "vitest";
import {createDemoController,ENVELOPE_KEY} from "./engine.js";
import type {StorageLike,Envelope} from "./engine.js";
import {safeStringify,safeParse,STORAGE_KEYS} from "./storage.js";
import {G1_T0,DAY,G_A} from "./scenarios.js";
import {calculateReferenceSnapshot} from "@noticevault/domain";
class MemoryStorage implements StorageLike {
  values=new Map<string,string>(); writes=0; fail=false; readFail=false;
  getItem(key:string){if(this.readFail)throw new Error("SecurityError");return this.values.get(key)??null;}
  setItem(key:string,value:string){if(this.fail)throw new Error("QuotaExceededError");this.writes++;this.values.set(key,value);}
}
const setup=()=>{const storage=new MemoryStorage();return {storage,c:createDemoController(storage)};};
describe("T042 production controller (fake storage only)",()=>{
  it("does not write during initialization; financial success commits one envelope before notification",()=>{
    const {c,storage}=setup();expect(storage.writes).toBe(0);let observed=false;
    c.subscribe(()=>{observed=storage.getItem(ENVELOPE_KEY)!==null;});
    expect(c.executeCommand(c.proposeCommand("demo-g1","FUND_NEXT_PERIOD"))).toEqual({ok:true});
    expect(storage.writes).toBe(1);expect(observed).toBe(true);
    const saved=safeParse<Envelope>(storage.getItem(ENVELOPE_KEY)!);expect(saved.agreements[0]?.state.regularFunded).toBe(2n*G_A);expect(saved.activity[0]?.amount).toBe(G_A);expect(saved.applied).toHaveLength(1);
  });
  it("write failure leaves accounting/activity/command IDs unchanged and permits retry",()=>{
    const {c,storage}=setup();const before=safeStringify(c.getSnapshot().agreements);const cmd=c.proposeCommand("demo-g1","FUND_NEXT_PERIOD");storage.fail=true;
    expect(c.executeCommand(cmd).ok).toBe(false);expect(safeStringify(c.getSnapshot().agreements)).toBe(before);expect(c.getSnapshot().activity).toEqual([]);expect(c.getSnapshot().applied).toEqual([]);expect(storage.writes).toBe(0);
    storage.fail=false;expect(c.executeCommand(cmd).ok).toBe(true);
  });
  it("persists idempotency across reload and rejects duplicate confirmation without write",()=>{
    const {c,storage}=setup();const cmd=c.proposeCommand("demo-g1","FUND_NEXT_PERIOD");expect(c.executeCommand(cmd).ok).toBe(true);const reload=createDemoController(storage);expect(reload.executeCommand(cmd).ok).toBe(false);expect(storage.writes).toBe(1);
  });
  it("two legitimate renewals at the same clock retain both transfer events",()=>{
    const {c}=setup();for(let i=0;i<2;i++)expect(c.executeCommand(c.proposeCommand("demo-g1","FUND_NEXT_PERIOD")).ok).toBe(true);
    const a=c.getSnapshot().agreements[0];expect(a.state.regularFunded).toBe(3n*G_A);expect(a.eventLog).toHaveLength(2);expect(new Set(a.eventLog.map(e=>e.id)).size).toBe(2);expect(a.eventLog.map(e=>e.deltaAmount)).toEqual([G_A,G_A]);
  });
  it.each(["clock","role","revision"])("rejects stale %s proposal",field=>{
    const {c}=setup();const cmd=c.proposeCommand("demo-g1","FUND_NEXT_PERIOD");
    if(field==="clock")c.dispatch({type:"SET_CLOCK",clock:G1_T0+DAY});
    if(field==="role")c.dispatch({type:"SET_ROLE",role:"PROVIDER"});
    if(field==="revision")c.dispatch({type:"SET_DRAFT",draft:{name:"interrupted",fields:{}}});
    expect(c.executeCommand(cmd).ok).toBe(false);expect(c.getSnapshot().agreements[0]?.state.regularFunded).toBe(G_A);
  });
  it("cancel/back/reload before confirm makes no financial change",()=>{
    const {c,storage}=setup();c.proposeCommand("demo-g1","START_NOTICE");c.dispatch({type:"SET_VIEW",view:"agreements"});const reload=createDemoController(storage);expect(storage.writes).toBe(0);expect(reload.getSnapshot().agreements[0]?.state.noticeStartStored).toBeNull();
  });
  it("provider cannot fund, cancel, refund or create a draft agreement",()=>{
    const {c}=setup();c.dispatch({type:"SET_ROLE",role:"PROVIDER"});for(const kind of ["FUND_NEXT_PERIOD","START_NOTICE","CLAIM_REFUND"] as const)expect(c.executeCommand(c.proposeCommand("demo-g1",kind)).ok).toBe(false);expect(c.dispatch({type:"ADD_AGREEMENT",agreement:{...c.getSnapshot().agreements[0],id:"new",createdAt:G1_T0}}).ok).toBe(false);
  });
  it("zero claims do not create financial events or writes",()=>{
    const {c,storage}=setup();c.dispatch({type:"SET_ROLE",role:"PROVIDER"});const count=storage.writes;expect(c.executeCommand(c.proposeCommand("demo-g1","CLAIM_PROVIDER")).ok).toBe(false);expect(storage.writes).toBe(count);expect(c.getSnapshot().activity).toEqual([]);
  });
  it("corrupt payload is quarantined through initialization and attempted edits",()=>{
    const storage=new MemoryStorage();storage.values.set(ENVELOPE_KEY,"{broken");const c=createDemoController(storage);expect(Object.keys(c.getSnapshot().storageErrors)).not.toHaveLength(0);expect(c.dispatch({type:"SET_CLOCK",clock:G1_T0+DAY}).ok).toBe(false);expect(storage.getItem(ENVELOPE_KEY)).toBe("{broken");expect(storage.writes).toBe(0);expect(c.exportRaw()).toContain("{broken");
  });
  it("preserves legacy bytes and requires explicit new-session decision",()=>{
    const storage=new MemoryStorage();storage.values.set(STORAGE_KEYS.KEY_AGREEMENTS,"old payload");const c=createDemoController(storage);expect(c.dispatch({type:"SET_ROLE",role:"PROVIDER"}).ok).toBe(false);expect(storage.writes).toBe(0);expect(c.dispatch({type:"RESET_DEMO"}).ok).toBe(true);expect(storage.getItem(STORAGE_KEYS.KEY_AGREEMENTS)).toBe("old payload");expect([...storage.values.keys()].some(k=>k.startsWith("noticevault-demo-v2:archive:"))).toBe(true);
  });
  it("failed archival reset preserves corrupt bytes",()=>{
    const storage=new MemoryStorage();storage.values.set(ENVELOPE_KEY,"broken");const c=createDemoController(storage);storage.fail=true;expect(c.dispatch({type:"RESET_DEMO"}).ok).toBe(false);expect(storage.getItem(ENVELOPE_KEY)).toBe("broken");
  });
  it("unavailable storage fails closed without successful state mutation",()=>{
    const storage=new MemoryStorage();storage.readFail=true;const c=createDemoController(storage);expect(c.dispatch({type:"SET_ROLE",role:"PROVIDER"}).ok).toBe(false);expect(storage.writes).toBe(0);
  });
  it("rejects stale external storage rather than overwriting another tab",()=>{
    const {c,storage}=setup();const cmd=c.proposeCommand("demo-g1","FUND_NEXT_PERIOD");storage.values.set(ENVELOPE_KEY,"externally changed");expect(c.executeCommand(cmd).ok).toBe(false);expect(storage.getItem(ENVELOPE_KEY)).toBe("externally changed");
  });
  it.each(["G1","G2","G3"] as const)("adds %s fixture at current clock with actual ledger and preserves old agreements",scenario=>{
    const {c,storage}=setup();const original=safeStringify(c.getSnapshot().agreements);expect(c.dispatch({type:"ADD_SCENARIO",scenario}).ok).toBe(true);const a=c.getSnapshot().agreements.slice(-1)[0];expect(safeStringify(c.getSnapshot().agreements.slice(0,3))).toBe(original);const snap=calculateReferenceSnapshot(a.state,c.getSnapshot().clock);
    if(scenario==="G1"){expect(snap.V).toBe(1500000000n);expect(snap.clientRefundable).toBe(1500000000n);expect(a.eventLog).toHaveLength(1);}
    if(scenario==="G2"){expect(snap.reason).toBe("MISSED_CHECKPOINT");expect(snap.W).toBe(1000000000n);}
    if(scenario==="G3"){expect(snap.V).toBe(3500000000n);expect(snap.clientRefundable).toBe(2500000000n);expect(a.eventLog.map(e=>e.kind)).toEqual(["PeriodFunded","NoticeStarted"]);}
    expect(a.state.regularFunded+snap.R).toBe(a.state.regularPaid+a.state.noticePaid+a.state.clientRefunded+snap.L);expect(createDemoController(storage).getSnapshot().storageErrors).toEqual({});
  });
  it.each([15n,60n])("valid notice with N=%s days reloads and settles using domain reserve",noticeDays=>{
    const {c,storage}=setup();const base=c.getSnapshot().agreements[0];const terms={...base.state.terms,startAt:G1_T0+600n,acceptanceDeadline:G1_T0+300n,noticeSeconds:noticeDays*DAY,clientNonce:100n};const a={...base,id:"ratio",state:{...base.state,terms},createdAt:G1_T0};expect(c.dispatch({type:"ADD_AGREEMENT",agreement:a}).ok).toBe(true);expect(c.executeCommand(c.proposeCommand("ratio","START_NOTICE")).ok).toBe(true);expect(c.dispatch({type:"SET_CLOCK",clock:terms.startAt+noticeDays*DAY}).ok).toBe(true);c.dispatch({type:"SET_ROLE",role:"PROVIDER"});expect(c.executeCommand(c.proposeCommand("ratio","CLAIM_PROVIDER")).ok).toBe(true);const reload=createDemoController(storage);expect(reload.getSnapshot().storageErrors).toEqual({});expect(reload.getSnapshot().agreements.slice(-1)[0]?.state.noticeReasonStored).toBe("CLIENT_CANCELLED");
  });
  it("refuses rewind before an applied financial event",()=>{const {c}=setup();c.dispatch({type:"SET_CLOCK",clock:G1_T0+15n*DAY});expect(c.executeCommand(c.proposeCommand("demo-g1","START_NOTICE")).ok).toBe(true);expect(c.dispatch({type:"SET_CLOCK",clock:G1_T0}).ok).toBe(false);expect(c.getSnapshot().clock).toBe(G1_T0+15n*DAY);});
  it("draft interruption preserves string fields; successful creation clears draft in same write",()=>{const {c,storage}=setup();c.dispatch({type:"SET_DRAFT",draft:{name:"bigint:123",fields:{client:"string:hello"}}});const reload=createDemoController(storage);expect(reload.getSnapshot().draft).toEqual(c.getSnapshot().draft);const base=reload.getSnapshot().agreements[0];const a={...base,id:"created",createdAt:G1_T0,state:{...base.state,terms:{...base.state.terms,startAt:G1_T0+600n,clientNonce:101n}}};const writes=storage.writes;expect(reload.dispatch({type:"ADD_AGREEMENT",agreement:a}).ok).toBe(true);expect(storage.writes).toBe(writes+1);expect(createDemoController(storage).getSnapshot().draft).toBeNull();});
  it.each(["role","reason","draft","event"])("quarantines invalid %s without overwrite",field=>{const {c,storage}=setup();c.executeCommand(c.proposeCommand("demo-g1","START_NOTICE"));const e=safeParse<Envelope>(storage.getItem(ENVELOPE_KEY)!);if(field==="role")Object.assign(e,{role:"ADMIN"});if(field==="reason")Object.assign(e.agreements[0].state,{noticeReasonStored:1});if(field==="draft")Object.assign(e,{draft:{name:"bad",fields:{client:4}}});if(field==="event")Object.assign(e.agreements[0].eventLog[0],{kind:"FakeSuccess"});const bad=safeStringify(e);storage.values.set(ENVELOPE_KEY,bad);const writes=storage.writes;const loaded=createDemoController(storage);expect(Object.keys(loaded.getSnapshot().storageErrors)).not.toHaveLength(0);expect(storage.writes).toBe(writes);expect(storage.getItem(ENVELOPE_KEY)).toBe(bad);});
  it("serialization preserves arbitrary tag-like strings and values above 2^53",()=>{const x={a:9007199254740993n,b:"bigint:123",c:"string:bigint:456"};expect(safeParse(safeStringify(x))).toEqual(x);});
});

describe("T042 settlement boundaries",()=>{
  it("rejects renewal exactly at D and settles missed-checkpoint earnings once",()=>{
    const {c}=setup();expect(c.dispatch({type:"SET_CLOCK",clock:G1_T0+30n*DAY}).ok).toBe(true);
    expect(c.executeCommand(c.proposeCommand("demo-g1","FUND_NEXT_PERIOD")).ok).toBe(false);
    c.dispatch({type:"SET_CLOCK",clock:G1_T0+60n*DAY});c.dispatch({type:"SET_ROLE",role:"PROVIDER"});
    expect(c.executeCommand(c.proposeCommand("demo-g1","CLAIM_PROVIDER")).ok).toBe(true);
    expect(c.getSnapshot().agreements[0].state.regularPaid).toBe(G_A);expect(c.getSnapshot().agreements[0].state.noticePaid).toBe(G_A);
    const events=c.getSnapshot().agreements[0].eventLog.length;
    expect(c.executeCommand(c.proposeCommand("demo-g1","CLAIM_PROVIDER")).ok).toBe(false);expect(c.getSnapshot().agreements[0].eventLog).toHaveLength(events);
  });
  it.each(["G1","G3"] as const)("fully settles %s with conservation and reload",scenario=>{
    const {c,storage}=setup();c.dispatch({type:"ADD_SCENARIO",scenario});const id=c.getSnapshot().agreements.slice(-1)[0].id;
    c.dispatch({type:"SET_CLOCK",clock:G1_T0+30n*DAY});
    expect(c.executeCommand(c.proposeCommand(id,"CLAIM_REFUND")).ok).toBe(true);
    c.dispatch({type:"SET_ROLE",role:"PROVIDER"});expect(c.executeCommand(c.proposeCommand(id,"CLAIM_PROVIDER")).ok).toBe(true);
    const a=createDemoController(storage).getSnapshot().agreements.find(x=>x.id===id)!;
    const snap=calculateReferenceSnapshot(a.state,G1_T0+30n*DAY);expect(snap.phase).toBe("CLOSED");expect(snap.L).toBe(0n);
    expect(a.state.regularPaid+a.state.noticePaid).toBe(scenario==="G1"?4500000000n:6500000000n);
    expect(a.state.clientRefunded).toBe(scenario==="G1"?1500000000n:2500000000n);
  });
  it("rejects repeated draft acceptance even when a second click generates a new ID",()=>{
    const {c}=setup();const base=c.getSnapshot().agreements[0];const a={...base,id:"draft-first",createdAt:G1_T0,state:{...base.state,terms:{...base.state.terms,startAt:G1_T0+600n,clientNonce:200n}}};
    expect(c.dispatch({type:"ADD_AGREEMENT",agreement:a}).ok).toBe(true);
    expect(c.dispatch({type:"ADD_AGREEMENT",agreement:{...a,id:"draft-double-click"}}).ok).toBe(false);
    expect(c.getSnapshot().agreements).toHaveLength(4);
  });
  it("reset final-write failure retains original data after successful archival",()=>{
    class FailStateWrite extends MemoryStorage {override setItem(key:string,value:string){if(key===ENVELOPE_KEY)throw new Error("state write failed");super.setItem(key,value);}}
    const storage=new FailStateWrite();storage.values.set(ENVELOPE_KEY,"corrupt");const c=createDemoController(storage);
    expect(c.dispatch({type:"RESET_DEMO"}).ok).toBe(false);expect(storage.getItem(ENVELOPE_KEY)).toBe("corrupt");expect(c.getSnapshot().agreements).toEqual([]);
    expect([...storage.values.keys()].some(key=>key.startsWith("noticevault-demo-v2:archive:"))).toBe(true);
  });
});
