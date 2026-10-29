/** Explicit test-only server double; never a production fallback. */
import {ReviewLifecycleController,TransactionReviewController,reviewCreation} from './transaction-review.js';
import type {Attempt,AttemptStore,SubmissionReview,ReviewPacket,SyntheticExecutor,TxState} from './transaction-review.js';
import type {DurableAttempt} from './durable-attempt.js';
import type {DurableReviewGateway} from './durable-review.js';
import {requireTerminalProof} from './terminal-evidence.js';
import type {TerminalProof} from './terminal-evidence.js';
const W='00000000-0000-4000-8000-000000000001',P='0x'+'c'.repeat(64);
function backend<R extends SubmissionReview>(current:()=>R,store:AttemptStore,executor:SyntheticExecutor<R>|null,verify:((a:Attempt)=>Promise<TerminalProof>)|null):DurableReviewGateway{
 if(import.meta.env.MODE!=='test')throw new Error('Unit construction only');const terminal=new Map<string,Attempt>();const records=new Map<string,DurableAttempt>(),keys=new Map<string,string>();let n=0;
 const get=(_w:string,id:string)=>{const r=records.get(id);return r?Promise.resolve(r):Promise.reject(new Error('Missing durable attempt'));};
 return {source:'SYNTHETIC',workspaceId:W,resource:'unit:agreement',action:'unit-action',policyHash:P,client:{get,
 reserve:async(w,resource,action,key)=>{const prior=keys.get(key);if(prior)return get(w,prior);if([...records.values()].some(r=>['reserved','unknown','submitted'].includes(r.state)))throw new Error('Locked');for(const a of terminal.values())if(verify)requireTerminalProof(await verify(a),a);const r=current(),id=crypto.randomUUID();const value:DurableAttempt={source:'SYNTHETIC',id,workspaceId:w,account:r.account,chainId:r.chainId,resource,action,binding:String(++n).padStart(64,'0'),state:'reserved',revision:0,hash:null,preparation:{workspaceId:w,actor:r.account,chainId:r.chainId,resource,action,policyHash:P,cycleKey:r.cycleKey??'1',networkNonce:String(n),target:r.target,data:r.data,value:'0',issuedAt:Date.now()}};keys.set(key,id);records.set(id,value);return value;},
 claim:async(w,id)=>{const r=await get(w,id);if(r.state!=='reserved')throw new Error('Claim consumed');const next={...r,state:'unknown' as const,claimed:true,revision:r.revision+1};records.set(id,next);return next;},
 cancel:async(w,id)=>{const r=await get(w,id);if(r.state!=='reserved')throw new Error('Cannot cancel');const next={...r,state:'cancelled' as const,revision:r.revision+1};records.set(id,next);return next;},
 reconcile:async(w,id)=>{const r=await get(w,id);if(r.state==='reserved'||r.state==='cancelled')return r;const a=store.read();if(!a?.hash||!executor)return r;const receipt=await executor.receipt(a.hash,a.chainId);if(receipt.source!=='SYNTHETIC'||receipt.hash!==a.hash||receipt.chainId!==a.chainId||(!receipt.blockHash&&receipt.status!=='pending'))throw new Error('Server rejected fixture');if(verify&&receipt.status!=='pending'){const proposed={...a,status:receipt.status};requireTerminalProof(await verify(proposed),proposed);}if(['confirmed','reverted'].includes(r.state)&&receipt.status!=='pending'&&receipt.status!==r.state){const conflicted={...r,state:'conflicted' as const};records.set(id,conflicted);return conflicted;}if(receipt.status!=='pending')terminal.set(id,{...a,status:receipt.status});const next={...r,hash:receipt.hash,state:receipt.status==='pending'?'submitted' as const:receipt.status,revision:r.revision+1};records.set(id,next);return next;}
 }};
}
export class UnitLifecycleController<R extends SubmissionReview> extends ReviewLifecycleController<R>{constructor(load:(s:AbortSignal)=>Promise<R>,store:AttemptStore,executor:SyntheticExecutor<R>|null=null,changed:(s:TxState<R>)=>void=()=>{},verify:((a:Attempt)=>Promise<TerminalProof>)|null=null){let latest:R;const wrapped=async(s:AbortSignal)=>latest=await load(s);super(wrapped,store,executor,changed,null,backend(()=>latest,store,executor,verify));}}
export class UnitCreationController extends TransactionReviewController{constructor(load:(s:AbortSignal)=>Promise<ReviewPacket>,store:AttemptStore,executor:SyntheticExecutor|null=null,changed:(s:TxState)=>void=()=>{}){let latest:ReturnType<typeof reviewCreation>;const wrapped=async(s:AbortSignal)=>{const packet=await load(s);latest=reviewCreation(packet);return packet;};super(wrapped,store,executor,changed,backend(()=>latest,store,executor,null));}}

/** Complete only initial synthetic fixtures; read paths never repair malformed responses. */
export function completeWireFixture<T extends {workspaceId:string;account:string;chainId:string;resource:string;action:string;preparation:object}>(fixture:T){
 return {...fixture,preparation:{workspaceId:fixture.workspaceId,actor:fixture.account,chainId:fixture.chainId,resource:fixture.resource,action:fixture.action,policyHash:'b'.repeat(64),cycleKey:'synthetic-cycle',networkNonce:'0',target:fixture.account,data:'0x',value:'0' as const,issuedAt:0,...fixture.preparation}};
}
