import {matchDurable,matchDurableIdentity} from './durable-review.js';
import type {DurableJournal,DurableReviewGateway} from './durable-review.js';
import type {TerminalProof} from './terminal-evidence.js';
import {decodeFunctionData,encodeFunctionData} from 'viem';
import {FACTORY_ABI,parseTerms} from '../../packages/sdk/src/index.js';
import type {SerializedTerms} from '../../packages/sdk/src/index.js';
import {computeR,safeAddUint256} from '../../packages/domain/src/index.js';
import {CreationPreparationClient} from './creation-preparation.js';
import type {CreationContext,UnsignedPreparation,CurrentWallet} from './creation-preparation.js';
import {DraftReviewClient} from './draft-review.js';
import type {SavedDraft} from './draft-review.js';
export type ReviewPacket={context:CreationContext;preparation:UnsignedPreparation;draft:SavedDraft;wallet:CurrentWallet};
export type CreationReview=Readonly<{source:'SYNTHETIC';key:string;account:string;chainId:string;target:string;value:'0';data:string;version:number;binding:string;terms:Readonly<Record<string,string>>;deposit:string;reserve:string;observedAt:number;blockNumber:string;blockHash:string}>;
const keys=['schemaVersion','client','provider','token','amountPerPeriod','periodSeconds','noticeSeconds','startAt','clientNonce','acceptanceDeadline','termsDocumentHash'] as const;
const hash=/^0x[0-9a-f]{64}$/i;
function requireValue(v:unknown,message:string):asserts v{if(!v)throw new Error(message);}
export function reviewCreation(packet:ReviewPacket):CreationReview{
 const {context:c,preparation:p,draft:d,wallet:w}=packet;const tx=p.transaction;
 requireValue(c.source==='SYNTHETIC'&&p.source==='SYNTHETIC','Only synthetic preparation is supported');
 requireValue(c.binding===p.binding&&hash.test(c.binding)&&c.workspaceId===d.workspace_id&&p.workspaceId===d.workspace_id&&c.draftId===d.id&&p.draftId===d.id&&c.version===d.version,'Draft or policy binding changed');
 requireValue(w.account.toLowerCase()===c.account.toLowerCase()&&w.chainId===c.chainId&&c.account.toLowerCase()===String(d.terms_json.client).toLowerCase(),'Wallet context changed');
 requireValue(tx.to.toLowerCase()===c.factory.toLowerCase()&&tx.chainId===c.chainId&&tx.value==='0','Unexpected transaction target, chain or native value');
 const terms=Object.freeze(Object.fromEntries(keys.map(k=>[k,String(d.terms_json[k])])));
 const parsed=parseTerms(terms as unknown as SerializedTerms);const decoded=decodeFunctionData({abi:FACTORY_ABI,data:tx.data as `0x${string}`});
 requireValue(decoded.functionName==='createAgreement'&&decoded.args?.length===2,'Unsupported calldata operation');
 const encodedTerms=decoded.args[0] as unknown as Record<string,unknown>;
 for(const k of keys){const value=terms[k];requireValue(typeof value==='string'&&String(encodedTerms[k]).toLowerCase()===value.toLowerCase(),'Calldata terms differ: '+k);}
 requireValue(encodeFunctionData({abi:FACTORY_ABI,functionName:'createAgreement',args:decoded.args}).toLowerCase()===tx.data.toLowerCase(),'Non-canonical calldata');
 requireValue(Number.isSafeInteger(p.observedAt)&&p.observedAt<=Date.now()+5000&&Date.now()-p.observedAt<=60000&&BigInt(Math.floor(Date.now()/1000))<parsed.acceptanceDeadline,'Preparation expired');
 const reserve=computeR(parsed),deposit=safeAddUint256(parsed.amountPerPeriod,reserve,"creation funding");
 const key=JSON.stringify([c.binding,c.version,d.doc_hash,terms,c.account.toLowerCase(),c.chainId,tx.to.toLowerCase(),tx.value,tx.data.toLowerCase()]);
 return Object.freeze({source:'SYNTHETIC',key,account:c.account,chainId:c.chainId,target:tx.to,value:'0',data:tx.data,version:c.version,binding:c.binding,terms,deposit:String(deposit),reserve:String(reserve),observedAt:p.observedAt,blockNumber:p.blockNumber,blockHash:p.blockHash});
}

/** Authenticated same-origin adapters recheck session and draft after preparation. */
export function creationReviewLoader(workspaceId:string,draftId:string,readWallet:()=>Promise<CurrentWallet>,api=new DraftReviewClient(),prep=new CreationPreparationClient()){
 return async(signal:AbortSignal):Promise<ReviewPacket>=>{
  const me=await api.session(signal);const context=await prep.context(workspaceId,draftId,signal);const draft=await api.draft(workspaceId,draftId,signal);
  const preparation=await prep.prepare(context,readWallet,signal);const wallet=await readWallet();const latest=await api.draft(workspaceId,draftId,signal);const after=await api.session(signal);
  requireValue(!signal.aborted&&me.address.toLowerCase()===wallet.account.toLowerCase()&&me.chainId===wallet.chainId&&after.address.toLowerCase()===me.address.toLowerCase()&&after.chainId===me.chainId&&Date.parse(after.expiresAt)>Date.now(),'Session or wallet changed');
  requireValue(JSON.stringify(latest)===JSON.stringify(draft),'Draft changed during preparation');return {context,preparation,draft,wallet};
 };
}
export type TxStatus='idle'|'preparing'|'review'|'checking'|'submitting'|'rejected'|'unknown'|'submitted'|'confirmed'|'reverted'|'blocked'|'invalidated';
export type Attempt={source:'SYNTHETIC';key:string;status:'unknown'|'submitted'|'confirmed'|'reverted'|'rejected';hash?:string;chainId:string;request?:SubmissionReview;durable?:DurableJournal};
export interface AttemptStore{read():Attempt|null;write(value:Attempt):void}
export type SubmissionReview=Readonly<{source:'SYNTHETIC';key:string;account:string;chainId:string;target:string;value:'0';data:string;scopeKey?:string;cycleKey?:string}>;
export interface SyntheticExecutor<R extends SubmissionReview=CreationReview>{readonly source:'SYNTHETIC';submit(review:R):Promise<{source:'SYNTHETIC';hash:string}>;receipt(hash:string,chainId:string):Promise<{source:'SYNTHETIC';hash:string;chainId:string;status:'pending'|'confirmed'|'reverted';blockHash?:string}>}
export type TxState<R extends SubmissionReview=CreationReview>={status:TxStatus;message:string;review?:R;attempt?:Attempt};
/** No live wallet implementation exists here. Unknown attempts are durable and never retried. */
export class ReviewLifecycleController<R extends SubmissionReview>{
 private listeners=new Set<(s:TxState<R>)=>void>();private state:TxState<R>={status:'idle',message:'Production submission unavailable.'};private epoch=0;private active:AbortController|null=null;private busy=false;private rolloverFrom:Attempt|null=null;
 constructor(private load:(signal:AbortSignal)=>Promise<R>,private store:AttemptStore,private executor:SyntheticExecutor<R>|null=null,private changed:(s:TxState<R>)=>void=()=>{},_legacyVerifyTerminal:((a:Attempt)=>Promise<TerminalProof>)|null=null,private gateway:DurableReviewGateway|null=null){
  if(gateway)this.gateway=Object.freeze({...gateway});
  try{const a=store.read();if(a){requireValue(a.source==='SYNTHETIC'&&typeof a.key==='string'&&/^[1-9][0-9]*$/.test(a.chainId)&&['unknown','submitted','confirmed','reverted','rejected'].includes(a.status)&&(!a.hash||hash.test(a.hash)),'Corrupt attempt');if(a.status!=='rejected')this.state={status:a.status,attempt:Object.freeze({...a}),message:'Restored attempt. Uncertainty preserved; no automatic retry.'};}}catch{this.state={status:'unknown',message:'Storage unavailable or corrupt. Preserved; submission blocked.'};}
 }
 snapshot(){return this.state;}
 subscribe(fn:(s:TxState<R>)=>void){this.listeners.add(fn);return()=>{this.listeners.delete(fn);};}
 private set(s:TxState<R>){this.state=Object.freeze({...s,...(s.attempt?{attempt:Object.freeze({...s.attempt})}:{})});this.changed(this.state);for(const fn of this.listeners)fn(this.state);}
 private locked(){return ['unknown','submitted','confirmed','reverted','submitting'].includes(this.state.status);}
 invalidate(){this.epoch++;this.active?.abort();this.active=null;this.rolloverFrom=null;if(!this.locked())this.set({status:'invalidated',message:'Context changed or review cancelled. Prepare again.'});}
 private durable(a:Attempt){const g=this.gateway,d=a.durable;requireValue(g?.source==='SYNTHETIC'&&d&&a.request&&d.workspaceId===g.workspaceId&&d.resource===g.resource&&d.action===g.action&&d.policyHash===g.policyHash,'Legacy or mismatched attempt remains quarantined');return {g,d,review:a.request};}
 private save(a:Attempt){this.store.write(a);return a;}
 private async reservation(a:Attempt,forCancel=false){const {g,d,review}=this.durable(a);const r=d.id?await g.client.get(d.workspaceId,d.id):await g.client.reserve(d.workspaceId,d.resource,d.action,d.requestId);if(forCancel)matchDurableIdentity(r,review,g,d.binding);else matchDurable(r,review,g,d.binding);return r;}
 async prepare(){if(this.busy||this.locked())return;this.rolloverFrom=null;this.busy=true;const n=++this.epoch,abort=new AbortController();this.active=abort;this.set({status:'preparing',message:'Checking authenticated preparation…'});try{const review=await this.load(abort.signal);if(n===this.epoch&&!abort.signal.aborted)this.set({status:'review',review,message:'Synthetic unsigned review. Confirmation requires a durable server claim.'});}catch(e){if(n===this.epoch)this.set({status:'blocked',message:e instanceof Error?e.message:'Preparation unavailable'});}finally{this.busy=false;if(this.active===abort)this.active=null;}}
 async confirm(accepted:boolean){
  if(!accepted||this.busy||this.state.status!=='review'||!this.state.review)return;const reviewed=this.state.review,g=this.gateway;
  if(!this.executor||this.executor.source!=='SYNTHETIC'||g?.source!=='SYNTHETIC'){this.set({...this.state,status:'blocked',message:'Durable backend and synthetic executor required. No local-only fallback or wallet request.'});return;}
  this.busy=true;const n=this.epoch,abort=new AbortController();this.active=abort;let attempt:Attempt|null=null;
  this.set({...this.state,status:'checking',message:'Rechecking review, reserving and claiming atomically…'});
  try{const current=await this.load(abort.signal);if(n!==this.epoch||abort.signal.aborted)return;requireValue(current.key===reviewed.key,'Preparation changed. Review again.');
   const prior=this.store.read();requireValue(!prior||prior.status==='rejected'||(this.rolloverFrom&&JSON.stringify(prior)===JSON.stringify(this.rolloverFrom)),'Existing attempt requires reconciliation');
   attempt={source:'SYNTHETIC',key:current.key,chainId:current.chainId,status:'unknown',request:Object.freeze({...current}),durable:{requestId:crypto.randomUUID(),workspaceId:g.workspaceId,resource:g.resource,action:g.action,policyHash:g.policyHash,phase:'reserving'}};
   this.save(attempt);this.set({status:'checking',review:current,attempt,message:'Durable reservation pending; preserve request identity.'});
   const reserved=await g.client.reserve(g.workspaceId,g.resource,g.action,attempt.durable!.requestId);matchDurable(reserved,current,g);requireValue(reserved.state==='reserved','Durable attempt is not unclaimed');
   const stopped=this.store.read();if(n!==this.epoch&&stopped?.status==='rejected'&&stopped.durable?.requestId===attempt.durable!.requestId&&stopped.durable.phase==='resolved'){this.set({status:'rejected',attempt:stopped,message:'Server cancellation preserved; no claim or execution.'});return;}
   attempt={...attempt,durable:{...attempt.durable!,id:reserved.id,binding:reserved.binding,phase:'reserved'}};this.save(attempt);this.set({status:'checking',review:current,attempt,message:'Reserved. One-time server claim required.'});
   if(n!==this.epoch||abort.signal.aborted){this.set({status:'unknown',attempt,message:'Context changed before claim. Recover or cancel the reservation explicitly.'});return;}
   requireValue(this.store.read()?.durable?.requestId===attempt.durable!.requestId,'Local journal changed before claim');
   attempt={...attempt,durable:{...attempt.durable!,phase:'claiming'}};this.save(attempt);
   const claimed=await g.client.claim(g.workspaceId,reserved.id);matchDurable(claimed,current,g,reserved.binding);requireValue(claimed.claimed===true&&claimed.state==='unknown','Durable claim not granted');
   attempt={...attempt,durable:{...attempt.durable!,phase:'claimed'}};this.save(attempt);
   if(n!==this.epoch||abort.signal.aborted){this.set({status:'unknown',attempt,message:'Context changed after claim. No executor call; trusted reconciliation required.'});return;}
   this.set({status:'submitting',review:current,attempt,message:'One durable claim granted. Synthetic execution only; never repeat.'});
   const result=await this.executor.submit(current);requireValue(result.source==='SYNTHETIC'&&hash.test(result.hash),'Unknown executor response');attempt={...attempt,status:'submitted',hash:result.hash};
   try{this.save(attempt);}catch{this.set({status:'unknown',attempt,message:'Hash persistence failed. Server claim remains locked; do not resend.'});return;}
   this.set({status:'submitted',attempt,message:'Hash is a hint. Only trusted server reconciliation resolves this attempt.'});
  }catch(e){if(attempt)this.set({status:'unknown',attempt,message:'Reservation, claim or execution unresolved. Preserve identity and recover; never retry automatically.'});else if(n===this.epoch){const a=this.rolloverFrom;this.set(a?{status:a.status,attempt:a,message:'Revalidation failed; prior attempt preserved'}:{status:'invalidated',message:e instanceof Error?e.message:'Revalidation failed'});}}
  finally{this.busy=false;if(this.active===abort)this.active=null;}
 }
 canCancelReservation(){return !!this.gateway&&!!this.state.attempt?.durable&&['unknown','submitted','checking'].includes(this.state.status);}
 async cancel(){this.epoch++;this.active?.abort();this.rolloverFrom=null;const a=this.state.attempt;if(!a){this.invalidate();return;}if(!a.durable){this.set({...this.state,message:'Legacy uncertainty remains quarantined; cancellation cannot clear it.'});return;}
  try{const {g,review}=this.durable(a),r=await this.reservation(a,true),cancelled=await g.client.cancel(g.workspaceId,r.id);matchDurableIdentity(cancelled,review,g,r.binding);requireValue(cancelled.state==='cancelled','Cancellation not verified');const saved:Attempt={...a,status:'rejected',durable:{...a.durable,id:r.id,binding:r.binding,phase:'resolved'}};this.save(saved);this.set({status:'rejected',attempt:saved,message:'Server verified cancellation before claim. Fresh deliberate review allowed.'});}catch{this.set({status:'unknown',attempt:a,message:'Cancellation not verified. Claimed or uncertain attempts remain locked.'});}
 }
 async checkReceipt(){const a=this.state.attempt;if(this.busy||!a)return false;this.busy=true;try{const {g,review}=this.durable(a),known=await this.reservation(a),r=await g.client.reconcile(g.workspaceId,known.id);matchDurable(r,review,g,known.binding);requireValue(!a.hash||!r.hash||a.hash.toLowerCase()===r.hash.toLowerCase(),'Executor hash conflicts with canonical result');const status=r.state==='confirmed'||r.state==='reverted'?r.state:r.state==='cancelled'?'rejected':r.state==='submitted'?'submitted':'unknown';const saved:Attempt={...a,status,...(r.hash?{hash:r.hash}:{}),durable:{...a.durable!,id:r.id,binding:r.binding,phase:['confirmed','reverted','cancelled'].includes(r.state)?'resolved':r.state==='reserved'?'reserved':'claimed'}};this.save(saved);this.set({status,attempt:saved,message:r.state==='reserved'?'Reservation unclaimed. Cancel explicitly before fresh review.':'Trusted synthetic server reconciliation: '+r.state+'. No live outcome claimed.'});return true;}catch{this.set({...this.state,message:'Trusted reconciliation unavailable or inconsistent. Attempt preserved; do not resend.'});return false;}finally{this.busy=false;}}
 canReviewNextCycle(){return !!this.gateway&&!!this.state.attempt?.durable&&['confirmed','reverted'].includes(this.state.status);}
 async reviewNextCycle(){if(this.busy||!this.canReviewNextCycle())return;if(!await this.checkReceipt())return;const previous=this.state.attempt;if(!previous||!['confirmed','reverted'].includes(this.state.status))return;this.busy=true;const n=++this.epoch,abort=new AbortController();this.active=abort;
  try{const review=await this.load(abort.signal),old=previous.request;requireValue(old&&review.scopeKey&&review.scopeKey===old.scopeKey&&review.account.toLowerCase()===old.account.toLowerCase()&&review.chainId===old.chainId&&review.target.toLowerCase()===old.target.toLowerCase(),'Immutable cycle binding changed');requireValue(review.cycleKey&&(previous.status==='reverted'||review.cycleKey!==old.cycleKey),'Confirmed cycle has not advanced');requireValue(n===this.epoch&&!abort.signal.aborted&&JSON.stringify(this.store.read())===JSON.stringify(previous),'Attempt or context changed');this.rolloverFrom=previous;this.set({status:'review',review,attempt:previous,message:'Fresh cycle review. Server rechecks canonical history before another claim.'});}catch(e){if(n===this.epoch)this.set({status:previous.status,attempt:previous,message:e instanceof Error?e.message:'Rollover unavailable'});}finally{this.busy=false;if(this.active===abort)this.active=null;}}
}

/** Backward-compatible creation adapter over the shared lifecycle. */
export class TransactionReviewController extends ReviewLifecycleController<CreationReview>{
 constructor(load:(signal:AbortSignal)=>Promise<ReviewPacket>,store:AttemptStore,executor:SyntheticExecutor|null=null,changed:(s:TxState)=>void=()=>{},gateway:DurableReviewGateway|null=null){
  super(async signal=>reviewCreation(await load(signal)),store,executor,changed,null,gateway);
 }
}
