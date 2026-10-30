import {canonicalAttemptResource} from '../../packages/sdk/src/attempt-identity';
import {isDurableAttempt} from './durable-wire';
import {validBusinessOutcome} from './business-outcome.js';
import type {DurableBusinessOutcome} from './business-outcome.js';
export class DurableAttemptError extends Error{constructor(public readonly status:number){super(status===0?'Attempt response unavailable. Read durable state before taking any further action.':'Attempt request rejected ('+status+').');this.name='DurableAttemptError';}}
type Fetcher=(path:string,init?:RequestInit)=>Promise<Response>;
export type DurablePreparation=Readonly<{workspaceId:string;actor:string;chainId:string;resource:string;action:string;policyHash:string;cycleKey:string;networkNonce:string;target:string;data:string;value:'0';issuedAt:number;discoveryAnchor?:Readonly<{blockNumber:string;blockHash:string}>;settlement?:{agreement:string;streamId:string;fingerprint:string;terms:import('../../packages/sdk/src/index').SerializedTerms;recipient:string|null;amount:string;noticeStart:string|null;noticeEnd:string|null;noticeReason:string;callerRule:string;accounting:Record<string,string>};renewal?:{agreement:string;streamId:string;fingerprint:string;terms:import('../../packages/sdk/src/index').SerializedTerms;expectedD:string;regularFunded:string;amount:string};creation?:{draftVersion:number;docHash:string};business?:Readonly<{termsHash:string;agreementCodeHash:string;termsDigest?:string}>;funding?:Readonly<{termsHash:string;agreementCodeHash:string;regularFunded:string;fundedThrough:string}>;notice?:Readonly<{termsHash:string;agreementCodeHash:string;regularFunded:string;fundedThrough:string}>;approval?:Readonly<{spender:string;amount:string}>}>;
export type DurableApprovalOutcome=Readonly<{kind:'ALLOWANCE_CHANGED';owner:string;spender:string;approvedAmount:string;currentAllowance:string;allowanceBlockNumber:string;allowanceBlockHash:string}>;
export type DurableNoticeOutcome=Readonly<{kind:'STATE_CHANGED'|'NO_CHANGE';action:'start-notice'|'materialize-notice';agreement:string;client:string;provider:string;token:string;termsHash:string;regularFunded:string;fundedThrough:string;noticeStart:string;noticeEnd:string;reason:'CLIENT_CANCELLED'|'MISSED_CHECKPOINT'}>;
export type DurableFundingOutcome=Readonly<{kind:'STATE_CHANGED';action:'fund-renewal';agreement:string;client:string;token:string;termsHash:string;fundedAmount:string;periodSeconds:string;previousRegularFunded:string;newRegularFunded:string;previousFundedThrough:string;newFundedThrough:string;observedRegularFunded:string;observedLiability:string;observedBalance:string;observedAllowance:string}>;
export type DurableAttempt=Readonly<{source:'SYNTHETIC'|'OPERATOR_CONFIGURED';id:string;workspaceId:string;account:string;chainId:string;resource:string;action:string;binding:string;state:'reserved'|'unknown'|'submitted'|'confirmed'|'reverted'|'reorged'|'conflicted'|'cancelled';revision:number;hash:string|null;claimed?:boolean;discovery?:DurableDiscoveryProgress|null;preparation:DurablePreparation;proof?:Readonly<{blockNumber:string;blockHash:string;outcome?:DurableApprovalOutcome|DurableNoticeOutcome|DurableFundingOutcome|DurableBusinessOutcome}>|null}>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function id(v:string){if(!uuid.test(v))throw new DurableAttemptError(400);return encodeURIComponent(v.toLowerCase());}
/** No executor and no automatic retry. A lost claim response requires GET/reconciliation, never another execution. */
export class DurableAttemptClient{
 constructor(private fetcher:Fetcher=(p,i)=>fetch(p,i),private expectedSource:'SYNTHETIC'|'OPERATOR_CONFIGURED'='SYNTHETIC'){}
 private async request(ws:string,path:string,body?:unknown,signal?:AbortSignal):Promise<DurableAttempt>{
  id(ws);ws=ws.toLowerCase();
  let r:Response;try{r=await this.fetcher('/api/workspaces/'+id(ws)+'/attempts'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json','X-Requested-With':'XMLHttpRequest',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),...(signal?{signal}:{})});}catch(e){if(signal?.aborted)throw e;throw new DurableAttemptError(0);}
  if(!r.ok)throw new DurableAttemptError(r.status);if(!r.headers.get('content-type')?.includes('application/json'))throw new DurableAttemptError(502);
  let value:unknown;try{value=await r.json();}catch{throw new DurableAttemptError(502);}if(!isDurableAttempt(value))throw new DurableAttemptError(502);const v=value;
  if(!v||v.source!==this.expectedSource||v.workspaceId!==ws||!uuid.test(v.id)||!/^0x[0-9a-f]{40}$/i.test(v.account)||!/^[1-9][0-9]*$/.test(v.chainId)||!['reserved','unknown','submitted','confirmed','reverted','reorged','conflicted','cancelled'].includes(v.state)||!Number.isSafeInteger(v.revision)||v.revision<0||!/^[0-9a-f]{64}$/.test(v.binding)||(v.hash!==null&&!/^0x[0-9a-f]{64}$/i.test(v.hash)))throw new DurableAttemptError(502);if(v.state==='confirmed'&&['approve-creation','approve-renewal'].includes(v.action)){
   const p=v.proof,o=p?.outcome,a=v.preparation?.approval;const uint=(x:unknown)=>typeof x==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(x)&&BigInt(x)<(1n<<256n);
   if(!p||!o||!a||o.kind!=='ALLOWANCE_CHANGED'||typeof o.owner!=='string'||typeof o.spender!=='string'||typeof a.spender!=='string'||o.owner.toLowerCase()!==v.account.toLowerCase()||o.spender?.toLowerCase()!==a.spender?.toLowerCase()||o.approvedAmount!==a.amount||!uint(o.approvedAmount)||BigInt(o.approvedAmount)===0n||!uint(o.currentAllowance)||!uint(p.blockNumber)||!uint(o.allowanceBlockNumber)||BigInt(o.allowanceBlockNumber)<BigInt(p.blockNumber)||!/^0x[0-9a-f]{64}$/i.test(p.blockHash)||!/^0x[0-9a-f]{64}$/i.test(o.allowanceBlockHash))throw new DurableAttemptError(502);
  }
  if(v.state==='confirmed'&&['start-notice','materialize-notice'].includes(v.action)){
   const p=v.proof,o=p?.outcome,n=v.preparation?.notice;
   const address=(x:unknown)=>typeof x==='string'&&/^0x[0-9a-f]{40}$/i.test(x)&&BigInt(x)!==0n;
   const uint=(x:unknown)=>typeof x==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(x)&&BigInt(x)<(1n<<256n);
   if(!p||!o||!n||!['STATE_CHANGED','NO_CHANGE'].includes(o.kind)||o.kind==='ALLOWANCE_CHANGED'||!('noticeStart' in o)||(o.kind==='NO_CHANGE'&&v.action!=='materialize-notice')||o.action!==v.action||!address(o.agreement)||!address(o.client)||!address(o.provider)||!address(o.token)||o.agreement.toLowerCase()!==v.preparation.target.toLowerCase()||(v.action==='start-notice'&&o.client.toLowerCase()!==v.account.toLowerCase())||o.termsHash!==n.termsHash||!/^0x[0-9a-f]{64}$/i.test(o.termsHash)||o.regularFunded!==n.regularFunded||o.fundedThrough!==n.fundedThrough||!uint(o.regularFunded)||!uint(o.fundedThrough)||!uint(o.noticeStart)||!uint(o.noticeEnd)||BigInt(o.noticeEnd)<=BigInt(o.noticeStart)||BigInt(o.noticeEnd)>((1n<<63n)-1n)||!['CLIENT_CANCELLED','MISSED_CHECKPOINT'].includes(o.reason)||(o.reason==='MISSED_CHECKPOINT'&&o.noticeStart!==o.fundedThrough)||(o.reason==='CLIENT_CANCELLED'&&BigInt(o.noticeStart)>=BigInt(o.fundedThrough))||(v.action==='materialize-notice'&&o.kind==='STATE_CHANGED'&&o.reason!=='MISSED_CHECKPOINT')||!uint(p.blockNumber)||!/^0x[0-9a-f]{64}$/i.test(p.blockHash))throw new DurableAttemptError(502);
  }
  if(v.state==='confirmed'&&v.action==='fund-renewal'){
   const p=v.proof,o=p?.outcome,f=v.preparation?.funding;
   const address=(x:unknown)=>typeof x==='string'&&/^0x[0-9a-f]{40}$/i.test(x)&&BigInt(x)!==0n;
   const uint=(x:unknown)=>typeof x==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(x)&&BigInt(x)<(1n<<256n);
   if(!p||!o||!f||o.kind!=='STATE_CHANGED'||o.action!=='fund-renewal'||!address(o.agreement)||!address(o.client)||!address(o.token)||!address(v.preparation.target)||o.agreement.toLowerCase()!==v.preparation.target.toLowerCase()||o.client.toLowerCase()!==v.account.toLowerCase()||o.termsHash!==f.termsHash||!/^0x[0-9a-f]{64}$/i.test(o.termsHash)||o.previousRegularFunded!==f.regularFunded||o.previousFundedThrough!==f.fundedThrough||![o.fundedAmount,o.periodSeconds,o.previousRegularFunded,o.newRegularFunded,o.previousFundedThrough,o.newFundedThrough,o.observedRegularFunded,o.observedLiability,o.observedBalance,o.observedAllowance,p.blockNumber].every(uint)||BigInt(o.fundedAmount)===0n||BigInt(o.periodSeconds)===0n||BigInt(o.newRegularFunded)!==BigInt(o.previousRegularFunded)+BigInt(o.fundedAmount)||BigInt(o.newFundedThrough)!==BigInt(o.previousFundedThrough)+BigInt(o.periodSeconds)||BigInt(o.newFundedThrough)>((1n<<63n)-1n)||BigInt(o.observedRegularFunded)<BigInt(o.newRegularFunded)||BigInt(o.observedRegularFunded)%BigInt(o.fundedAmount)!==0n||BigInt(o.observedBalance)<BigInt(o.observedLiability)||!/^0x[0-9a-f]{64}$/i.test(p.blockHash))throw new DurableAttemptError(502);
  }
  if(v.state==='confirmed'&&['create-agreement','claim-provider','claim-client-refund'].includes(v.action)){
   if(!v.proof||!v.preparation?.business||!validBusinessOutcome(v.proof.outcome,{action:v.action,account:v.account,target:v.preparation.target,binding:v.preparation.business,blockNumber:v.proof.blockNumber,blockHash:v.proof.blockHash}))throw new DurableAttemptError(502);
  }
  validateDiscovery(v);return Object.freeze(v);
 }
 async reserve(ws:string,resource:string,action:string,requestId:string,signal?:AbortSignal){id(requestId);requestId=requestId.toLowerCase();resource=canonicalAttemptResource(resource);const r=await this.request(ws,'',{resource,action,requestId},signal);if(r.resource!==resource||r.action!==action)throw new DurableAttemptError(502);return r;}
 private async action(ws:string,attempt:string,operation:string,signal?:AbortSignal){id(attempt);attempt=attempt.toLowerCase();const r=await this.request(ws,'/'+id(attempt)+(operation?'/'+operation:''),operation?{}:undefined,signal);if(r.id!==attempt)throw new DurableAttemptError(502);return r;}
 get(ws:string,attempt:string,signal?:AbortSignal){return this.action(ws,attempt,'',signal);}
 async claim(ws:string,attempt:string,signal?:AbortSignal){const r=await this.action(ws,attempt,'claim',signal);if(r.claimed!==true||r.state!=='unknown')throw new DurableAttemptError(502);return r;}
 reconcile(ws:string,attempt:string,signal?:AbortSignal){return this.action(ws,attempt,'reconcile',signal);}
 cancel(ws:string,attempt:string,signal?:AbortSignal){return this.action(ws,attempt,'cancel',signal);}
}

/** Informational search progress; never authorizes another submission. */
export type DurableDiscoveryProgress=Readonly<{version:1;binding:string;policyHash:string;anchorBlock:string;anchorHash:string;nextBlock:string;checkpointBlock?:string;checkpointHash?:string;candidateHash?:string;revision:number;status:'searching'|'caught_up'|'found'|'reorged'|'conflicted'}>;
function validateDiscovery(v:DurableAttempt):void {
 const d=v.discovery;if(d===null||d===undefined)return;
 const fail=()=>{throw new DurableAttemptError(502);};
 const hash=(x:unknown)=>typeof x==='string'&&/^0x[0-9a-f]{64}$/.test(x);
 const uint=(x:unknown):x is string=>typeof x==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(x)&&BigInt(x)<(1n<<64n);
 const keys=['version','binding','policyHash','anchorBlock','anchorHash','nextBlock','checkpointBlock','checkpointHash','candidateHash','revision','status'];
 const a=v.preparation?.discoveryAnchor;
 if(typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!keys.includes(k))||!a||typeof a.blockHash!=='string'||d.version!==1||d.binding!==v.binding||!hash(d.policyHash)||d.policyHash!==v.preparation.policyHash||!uint(d.anchorBlock)||d.anchorBlock!==a.blockNumber||!hash(d.anchorHash)||d.anchorHash!==a.blockHash.toLowerCase()||!uint(d.nextBlock)||BigInt(d.nextBlock)<BigInt(d.anchorBlock)||!Number.isSafeInteger(d.revision)||d.revision<1||!['searching','caught_up','found','reorged','conflicted'].includes(d.status))return fail();
 if((d.checkpointBlock===undefined)!==(d.checkpointHash===undefined))return fail();
 if(d.checkpointBlock!==undefined){if(!uint(d.checkpointBlock)||!hash(d.checkpointHash)||BigInt(d.checkpointBlock)<BigInt(d.anchorBlock)||BigInt(d.checkpointBlock)+1n!==BigInt(d.nextBlock))return fail();}
 else if(d.nextBlock!==d.anchorBlock)return fail();
 if(d.candidateHash!==undefined&&(!hash(d.candidateHash)||d.checkpointBlock===undefined))return fail();
 if(d.status==='found'&&!d.candidateHash)return fail();
 Object.freeze(d);
}
