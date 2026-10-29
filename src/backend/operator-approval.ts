import {parseObject,stringValue} from './response-values';
import {AGREEMENT_ABI,FACTORY_ABI,parseTerms,type SerializedTerms} from '../../packages/sdk/src/index';
import {decodeFunctionData,erc20Abi,toHex,type Hex} from 'viem';
import {DurableAttemptClient,type DurableAttempt} from './durable-attempt';
import {injectedWallet,type InjectedProvider} from './injected-wallet';
export type RenewalContext=Readonly<{agreement:string;streamId:string;action:'approve-renewal'|'fund-renewal'|'start-notice'|'materialize-notice'|'claim-provider'|'claim-client-refund'}>;
export type ApprovalPins=Readonly<{chainId:string;token:string;factory:string;policyHash:string}>;
export type ApprovalJournal={requestId:string;account:string;chainId:string;attemptId?:string;stage:'reserved'|'unknown';hash?:string};
type StoragePort=Pick<Storage,'getItem'|'setItem'>;
type Locks={request<T>(name:string,fn:()=>Promise<T>):Promise<T>};
type Client=Pick<DurableAttemptClient,'reserve'|'claim'|'get'|'reconcile'|'cancel'>;
export type OperatorState={status:'idle'|'busy'|'review'|'locked'|'confirmed'|'cancelled'|'error';message:string;attempt?:DurableAttempt;key?:string};
const hash=/^0x[0-9a-f]{64}$/i,address=/^0x[0-9a-f]{40}$/i;
export function parseApprovalJournal(raw:string):ApprovalJournal {
 const j=parseObject(raw),account=stringValue(j.account),chainId=stringValue(j.chainId),requestId=stringValue(j.requestId),stage=j.stage;
 if(!address.test(account)||!/^[1-9][0-9]*$/.test(chainId)||!requestId||(stage!=='reserved'&&stage!=='unknown'))throw Error('Invalid journal');
 const attemptId=j.attemptId===undefined?undefined:stringValue(j.attemptId),candidate=j.hash===undefined?undefined:stringValue(j.hash);
 if(attemptId!==undefined&&!attemptId||candidate!==undefined&&!hash.test(candidate))throw Error('Invalid journal');
 return {account,chainId,requestId,stage,...(attemptId===undefined?{}:{attemptId}),...(candidate===undefined?{}:{hash:candidate})};
}
export class OperatorApprovalController{
 private state:OperatorState={status:'idle',message:'Connect and review the exact transaction.'};private listeners=new Set<()=>void>();private epoch=0;private expiry=0;private journal:ApprovalJournal|null=null;private unsubscribe:()=>void;
 readonly storageKey:string;
 constructor(private workspace:string,private draft:string,private pins:ApprovalPins,private provider:InjectedProvider,private storage:StoragePort,private locks:Locks,private api:Client=new DurableAttemptClient(undefined,'OPERATOR_CONFIGURED'),private creation?:{terms:SerializedTerms;version:number;docHash:string},private renewal?:RenewalContext){
  this.pins=Object.freeze({...pins});if(renewal)this.renewal=Object.freeze({...renewal,agreement:renewal.agreement.toLowerCase()});if(creation)this.creation=structuredClone(creation);this.storageKey=['noticevault:operator-approval:v1',pins.chainId,workspace,draft].join(':');
  try{const raw=storage.getItem(this.storageKey);if(raw){const j=parseApprovalJournal(raw);if(!j||!address.test(j.account)||j.chainId!==pins.chainId||!['reserved','unknown'].includes(j.stage)||typeof j.requestId!=='string')throw Error('Invalid journal');this.journal=j;this.state={status:'locked',message:'Saved attempt requires reconciliation. No automatic resubmission.'};}}catch{this.state={status:'locked',message:'Journal unavailable or corrupt; preserved. Submission blocked.'};}
  this.unsubscribe=injectedWallet(provider).onChange?.(()=>this.invalidate())??(()=>{});
 }
 snapshot=()=>this.state;subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 private set(s:OperatorState){this.state=Object.freeze(s);for(const fn of this.listeners)fn();}
 private save(j:ApprovalJournal){this.storage.setItem(this.storageKey,JSON.stringify(j));this.journal={...j};}
 invalidate(){this.epoch++;if(this.journal)this.set({status:'locked',message:'Context changed; reconcile the saved attempt.'});else this.set({status:'idle',message:'Context changed. Connect and review again.'});}
 dispose(){this.invalidate();this.unsubscribe();}
 private action(){return this.renewal?.action??(this.creation?'create-agreement':'approve-creation');}
 private resource(){return this.renewal?'agreement:'+this.renewal.agreement:'draft:'+this.draft;}
 private checkSettlement(r:DurableAttempt){
  const p=r.preparation,v=p.settlement,c=this.renewal!,names={'start-notice':'startNotice','materialize-notice':'materializeNotice','claim-provider':'claimProvider','claim-client-refund':'claimClientRefund'};
  if(!v||v.agreement.toLowerCase()!==c.agreement||v.streamId!==c.streamId||!/^0x[0-9a-f]{64}$/i.test(v.fingerprint)&&!/^[0-9a-f]{64}$/i.test(v.fingerprint))throw Error('Exact settlement association required');
  const t=parseTerms(v.terms),claim=c.action==='claim-provider'||c.action==='claim-client-refund',recipient=c.action==='claim-provider'?t.provider:t.client;
  const call=decodeFunctionData({abi:AGREEMENT_ABI,data:p.data as Hex});
  if(call.functionName!==names[c.action as keyof typeof names]||(call.args?.length??0)!==0||t.token.toLowerCase()!==this.pins.token.toLowerCase())throw Error('Exact settlement call required');
  const a=v.accounting;for(const k of ['regularFunded','regularPaid','noticePaid','clientRefunded','noticeReserve','liability','fundedThrough','observedAt'])if(!/^\d+$/.test(a[k]??''))throw Error('Exact accounting review required');
  if(BigInt(a.regularFunded)+BigInt(a.noticeReserve)-BigInt(a.regularPaid)-BigInt(a.noticePaid)-BigInt(a.clientRefunded)!==BigInt(a.liability))throw Error('Accounting conservation mismatch');
  if(claim){if(v.recipient?.toLowerCase()!==recipient.toLowerCase()||!/^\d+$/.test(v.amount)||BigInt(v.amount)<=0n||BigInt(v.amount)>BigInt(a.liability)||!p.business)throw Error('Positive immutable beneficiary payout required');}
  else if(v.recipient!==null||v.amount!=='0'||!p.notice||!v.noticeStart||!v.noticeEnd||BigInt(v.noticeEnd)!==BigInt(v.noticeStart)+t.noticeSeconds)throw Error('Exact notice timing required');
  if(c.action==='start-notice'&&(t.client.toLowerCase()!==r.account.toLowerCase()||v.callerRule!=='CLIENT_ONLY'))throw Error('Client-only notice required');
  if(c.action!=='start-notice'&&v.callerRule!=='PERMISSIONLESS_IMMUTABLE_BENEFICIARY')throw Error('Immutable beneficiary rule required');
  return r;
 }
 private confirmedMessage(r:DurableAttempt){const o=r.proof?.outcome;
  if(o&&o.kind==='NO_CHANGE')return 'Canonical no-change outcome confirmed. No payment occurred.';
  if(o&&o.kind==='TRANSFER'&&'recipient' in o&&'amount' in o)return 'Canonical payout confirmed: '+o.amount+' token base units to '+o.recipient+'.';
  if(this.action()==='start-notice'||this.action()==='materialize-notice')return 'Canonical notice state confirmed. This call made no payment.';
  return this.action()==='fund-renewal'?'Canonical next-period funding and transfer confirmed.':this.creation?'Canonical agreement creation and initial funding confirmed.':'Canonical allowance change confirmed. This approval did not fund an agreement.';
 }
 private checkRenewal(r:DurableAttempt){
  if(!['approve-renewal','fund-renewal'].includes(this.renewal!.action))return this.checkSettlement(r);
  const p=r.preparation,v=p.renewal,c=this.renewal!;
  if(!v||v.agreement.toLowerCase()!==c.agreement||v.streamId!==c.streamId||!/^0x[0-9a-f]{64}$/i.test(v.fingerprint)&&! /^[0-9a-f]{64}$/i.test(v.fingerprint))throw Error('Exact agreement association required');
  const t=parseTerms(v.terms),amount=String(t.amountPerPeriod);
  if(t.client.toLowerCase()!==r.account.toLowerCase()||t.token.toLowerCase()!==this.pins.token.toLowerCase()||v.amount!==amount||!/^\d+$/.test(v.regularFunded)||!/^\d+$/.test(v.expectedD)||BigInt(v.expectedD)!==t.startAt+(BigInt(v.regularFunded)/t.amountPerPeriod)*t.periodSeconds)throw Error('Exact renewal client, amount and funded-through required');
  if(c.action==='approve-renewal'){
   const call=decodeFunctionData({abi:erc20Abi,data:p.data as Hex});
   if(call.functionName!=='approve'||String(call.args[0]).toLowerCase()!==c.agreement||String(call.args[1])!==amount||p.approval?.spender.toLowerCase()!==c.agreement||p.approval.amount!==amount)throw Error('Exact agreement allowance required');
  }else{
   const call=decodeFunctionData({abi:AGREEMENT_ABI,data:p.data as Hex});
   if(call.functionName!=='fundNextPeriod'||String(call.args?.[0])!==v.expectedD||p.funding?.regularFunded!==v.regularFunded||p.funding.fundedThrough!==v.expectedD)throw Error('Exact next period funding required');
  }
  return r;
 }
 private check(r:DurableAttempt){const p=r.preparation;
  if(r.source!=='OPERATOR_CONFIGURED'||r.workspaceId!==this.workspace||r.resource!==this.resource()||r.action!==(this.action())||r.chainId!==this.pins.chainId||p.chainId!==r.chainId||p.actor.toLowerCase()!==r.account.toLowerCase()||p.policyHash!==this.pins.policyHash||p.target.toLowerCase()!==(this.renewal&&this.renewal.action!=='approve-renewal'?this.renewal.agreement:this.creation?this.pins.factory:this.pins.token).toLowerCase()||p.value!=='0'||!/^[0-9a-f]{64}$/i.test(r.binding))throw Error('Approval identity or policy mismatch');
  if(this.renewal)return this.checkRenewal(r);
    if(this.creation){
   const expected=parseTerms(this.creation.terms),call=decodeFunctionData({abi:FACTORY_ABI,data:p.data as Hex});
   if(call.functionName!=='createAgreement'||!call.args||p.creation?.draftVersion!==this.creation.version||p.creation?.docHash.toLowerCase()!==this.creation.docHash.toLowerCase())throw Error('Exact draft version required');
   const actual=call.args[0] as Record<string,unknown>;
   if(Object.entries(expected).some(([key,value])=>String(actual[key]).toLowerCase()!==String(value).toLowerCase())||expected.client.toLowerCase()!==r.account.toLowerCase()||expected.token.toLowerCase()!==this.pins.token.toLowerCase()||expected.termsDocumentHash.toLowerCase()!==this.creation.docHash.toLowerCase())throw Error('Creation terms differ from reviewed draft');
   return r;
  }
  if(!p.approval)throw Error('Exact approval required');
  const call=decodeFunctionData({abi:erc20Abi,data:p.data as Hex});
  if(call.functionName!=='approve'||String(call.args[0]).toLowerCase()!==this.pins.factory.toLowerCase()||String(call.args[0]).toLowerCase()!==p.approval.spender.toLowerCase()||String(call.args[1])!==p.approval.amount||BigInt(p.approval.amount)<=0n||BigInt(p.approval.amount)>=(1n<<256n)-1n)throw Error('Exact bounded approval required');
  return r;
 }
 async prepare(){if(!['idle','error'].includes(this.state.status)||this.journal)return;const epoch=++this.epoch;this.set({status:'busy',message:'Connecting wallet and reserving the exact transaction.'});
  try{await this.locks.request(this.storageKey,async()=>{
   if(this.storage.getItem(this.storageKey))throw Error('Another attempt exists; reload and reconcile.');
   const wallet=await injectedWallet(this.provider).connect();if(epoch!==this.epoch)return;
   if(String(wallet.chainId)!==this.pins.chainId)throw Error('Wrong wallet chain');
   this.save({requestId:crypto.randomUUID(),account:wallet.address,chainId:this.pins.chainId,stage:'reserved'});
   const r=this.check(await this.api.reserve(this.workspace,this.resource(),this.action(),this.journal!.requestId));
   if(r.account.toLowerCase()!==wallet.address.toLowerCase()||r.state!=='reserved')throw Error('Reservation is not owned or reviewable');
   this.save({...this.journal!,attemptId:r.id});if(epoch!==this.epoch){this.set({status:'locked',message:'Interrupted reservation saved. Reconcile or cancel.'});return;}
   this.expiry=Math.min(Date.now()+60000,r.preparation.issuedAt+60000);this.set({status:'review',message:(r.preparation.settlement?'Review the immutable beneficiary and accounting as of the observed block. Payouts and cancellation notice start/end are recomputed at transaction execution; these timestamps and amounts are estimates.':this.action()==='fund-renewal'?'Review the agreement, exact one-period transfer and funded-through deadline. Funding uses existing allowance.':this.creation?'Review the immutable terms, document and exact initial funding before creating the agreement.':'Review token, spender, exact base-unit amount and nonce. This approval does not create or fund an agreement.'),attempt:r,key:r.binding});
  });}catch(error){this.set({status:this.journal?'locked':'error',message:error instanceof Error?error.message:'Preparation unavailable'});}
 }
 async confirm(key:string){const r=this.state.attempt;if(this.state.status!=='review'||!r||key!==this.state.key||!this.journal)return;const epoch=this.epoch;this.set({status:'busy',message:'Checking current wallet and claiming the durable reservation.'});
  try{await this.locks.request(this.storageKey,async()=>{
   if(Date.now()>this.expiry||epoch!==this.epoch)throw Error('Review expired or cancelled');
   const disk=parseApprovalJournal(this.storage.getItem(this.storageKey)||'null');if(!disk||disk.requestId!==this.journal!.requestId||disk.stage!=='reserved')throw Error('Attempt already claimed or changed');
   const wallet=await injectedWallet(this.provider).context();if(wallet.address.toLowerCase()!==r.account.toLowerCase()||String(wallet.chainId)!==r.chainId||epoch!==this.epoch)throw Error('Wallet changed');
   this.save({...this.journal!,stage:'unknown'});
   const claimed=this.check(await this.api.claim(this.workspace,r.id));if(!claimed.claimed||claimed.state!=='unknown'||claimed.binding!==key)throw Error('Claim uncertain or different; reconciliation required');
   const current=await injectedWallet(this.provider).context();if(epoch!==this.epoch||Date.now()>this.expiry||current.address.toLowerCase()!==r.account.toLowerCase()||String(current.chainId)!==r.chainId)throw Error('Context changed after claim; locked');
   const p=r.preparation;const candidate=await this.provider.request({method:'eth_sendTransaction',params:[{from:r.account,to:p.target,data:p.data,value:'0x0',chainId:toHex(BigInt(r.chainId)),nonce:toHex(BigInt(p.networkNonce))}]});
   if(typeof candidate!=='string'||!hash.test(candidate))throw Error('Wallet response unknown');this.save({...this.journal!,hash:candidate});
   this.set({status:'locked',message:'Wallet returned a candidate hash. Canonical reconciliation is required.',attempt:r});
  });}catch(error){this.set({status:'locked',message:error instanceof Error?error.message:'Submission uncertain; reconcile.'});}
 }
 async restart(){
  if(!this.journal||this.state.status==='busy'||!this.state.attempt||!['confirmed','reverted','cancelled'].includes(this.state.attempt.state))return;
  const epoch=++this.epoch;this.set({status:'busy',message:'Rechecking terminal state before starting a new review.'});
  try{await this.locks.request(this.storageKey,async()=>{
   const j=this.journal!;const disk=parseApprovalJournal(this.storage.getItem(this.storageKey)||'null');
   if(!disk||disk.requestId!==j.requestId||disk.attemptId!==j.attemptId||!j.attemptId)throw Error('Saved attempt changed; reload and reconcile.');
   let r=this.check(await this.api.get(this.workspace,j.attemptId));
   if(r.state!=='cancelled')r=this.check(await this.api.reconcile(this.workspace,j.attemptId));
   if(!['confirmed','reverted','cancelled'].includes(r.state)||r.account.toLowerCase()!==j.account.toLowerCase()||epoch!==this.epoch)throw Error('Terminal state changed; attempt remains locked.');
   const historyKey=this.storageKey+':history:'+j.requestId,archive=JSON.stringify({journal:disk,attempt:r});
   const prior=this.storage.getItem(historyKey);if(prior&&prior!==archive)throw Error('Historical evidence changed; preserved for review.');
   this.storage.setItem(historyKey,archive);if(this.storage.getItem(historyKey)!==archive)throw Error('History persistence unavailable');
   this.storage.setItem(this.storageKey,'');if(this.storage.getItem(this.storageKey)!=='')throw Error('Active journal clear was not persisted');this.journal=null;this.set({status:'idle',message:'Terminal attempt archived. Connect and review a new request; the API still blocks repeat cycles.'});
  });}catch(error){this.set({status:'locked',message:error instanceof Error?error.message:'Rollover unavailable; preserved.'});}
 }
 async reconcile(cancel=false){if(!this.journal||this.state.status==='busy')return;this.set({status:'busy',message:cancel?'Cancelling an unclaimed reservation.':'Reading durable state and canonical outcome.'});
  try{await this.locks.request(this.storageKey,async()=>{
   const j=this.journal!;let r=this.check(j.attemptId?await this.api.get(this.workspace,j.attemptId):await this.api.reserve(this.workspace,this.resource(),this.action(),j.requestId));
   if(r.account.toLowerCase()!==j.account.toLowerCase())throw Error('Saved owner mismatch');this.save({...j,attemptId:r.id,stage:r.state==='reserved'?'reserved':'unknown'});
   r=this.check(cancel&&r.state==='reserved'?await this.api.cancel(this.workspace,r.id):await this.api.reconcile(this.workspace,r.id));
   this.set({status:r.state==='confirmed'?'confirmed':r.state==='cancelled'?'cancelled':'locked',message:r.state==='confirmed'?this.confirmedMessage(r):r.state==='cancelled'?'Reservation cancelled before wallet handoff.':'Attempt remains '+r.state+'. Submission stays blocked.',attempt:r});
  });}catch(error){this.set({status:'locked',message:error instanceof Error?error.message:'Reconciliation unavailable'});}
 }
}
