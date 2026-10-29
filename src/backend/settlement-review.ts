import {encodeFunctionData} from 'viem';
import {prepareStartNotice,prepareMaterializeNotice,prepareClaimProvider,prepareClaimClientRefund,serializeTerms} from '../../packages/sdk/src/index.js';
import {syntheticAgreementObservation} from './renewal-review.js';
import type {SyntheticRenewalDependencies} from './renewal-review.js';
import type {SubmissionReview} from './transaction-review.js';
export type SettlementAction='start-notice'|'materialize-notice'|'claim-provider'|'claim-client-refund';
export type SettlementReview=SubmissionReview&Readonly<{action:SettlementAction;agreement:string;token:string;recipient:string|null;amount:string;callerRule:string;terms:Readonly<Record<string,string>>;blockNumber:string;blockHash:string;noticeReason:string;noticeStart:string|null;noticeEnd:string|null;effect:string}>;
function requireValue(v:unknown,message:string):asserts v{if(!v)throw new Error(message);}
function binding(v:unknown):string{return JSON.stringify(v,(_k:string,x:unknown)=>typeof x==='bigint'?String(x):x);}
export function syntheticSettlementLoader(action:SettlementAction,deps:SyntheticRenewalDependencies){
 requireValue(['start-notice','materialize-notice','claim-provider','claim-client-refund'].includes(action),'Unsupported settlement action');
 return async(signal:AbortSignal):Promise<SettlementReview>=>{
  const {c,current,evidence,terms,preview:p}=await syntheticAgreementObservation(deps,signal);
  const now=evidence.block.blockTimestamp;let recipient:string|null=null,amount=0n,S=p.S,E=p.E,reason=p.reason===1?'CLIENT_CANCELLED':p.reason===2?'MISSED_CHECKPOINT':'NONE',effect:string;
  let tx;
  if(action==='start-notice'){
   requireValue((BigInt(Math.floor(Date.now()/1000))>=p.D)===(now>=p.D),'Notice deadline crossed; refresh canonical evidence');
   tx=prepareStartNotice(c.agreement,c.policy,evidence,current.account,current);S=now>=p.D?p.D:now>terms.startAt?now:terms.startAt;E=S+terms.noticeSeconds;requireValue(E<(1n<<63n),'Notice end outside supported range');reason=now>=p.D?'MISSED_CHECKPOINT':'CLIENT_CANCELLED';
   effect='Stores notice and prevents further renewal. Before the funding deadline, cancellation starts at the later of execution time and agreement start; at or after the deadline, default notice starts at that deadline. Displayed notice times are the pinned-block preview. No payout occurs in this call.';
  }else if(action==='materialize-notice'){
   requireValue(!evidence.hasStoredNotice&&now>=p.D&&BigInt(Math.floor(Date.now()/1000))>=p.D,'No unstored default notice is ready');tx=prepareMaterializeNotice(c.agreement,c.policy,evidence,current);S=p.D;E=S+terms.noticeSeconds;reason='MISSED_CHECKPOINT';effect='Stores the already-derived missed-checkpoint notice at the funding deadline. This permissionless call does not pay anyone.';
  }else if(action==='claim-provider'){
   tx=prepareClaimProvider(c.agreement,c.policy,evidence,current);recipient=terms.provider;amount=p.providerClaimable;effect='Pays accrued regular and notice earnings to the immutable provider, never the caller-selected address. It may materialize default notice. The exact preview amount is for the displayed block; execution recomputes it, so it is not a fixed payout guarantee or amount cap.';
  }else{
   tx=prepareClaimClientRefund(c.agreement,c.policy,evidence,current);recipient=terms.client;amount=p.clientRefundable;effect='Pays unearned regular funding to the immutable client after stored or derived notice. It does not return the provider notice reserve. Execution recomputes the refundable amount; the displayed amount is the exact pinned-block preview, not a fixed payout guarantee.';
  }
  requireValue(p.providerClaimable>=0n&&p.clientRefundable>=0n&&p.providerClaimable+p.clientRefundable<=p.L,'Preview conservation mismatch');
  if(recipient)requireValue(amount>0n&&amount<=p.L&&evidence.tokenBalance!==undefined&&evidence.tokenBalance>=amount,'No positive payable amount with sufficient observed contract funds');
  const data=encodeFunctionData({abi:tx.abi,functionName:tx.functionName,args:tx.args});const serialized=Object.freeze({...serializeTerms(terms)});
  const key=binding({action,context:c,wallet:current,block:evidence.block.blockNumber,hash:evidence.block.blockHash,preview:p,to:tx.to,data,recipient,amount});
  const scopeKey=binding({action,agreement:c.agreement.toLowerCase(),terms:serialized,policy:c.policy});
  requireValue(evidence.regularPaid!==undefined&&evidence.noticePaid!==undefined&&evidence.clientRefunded!==undefined,'Accounting cycle evidence missing');const cycleKey=binding(action==='claim-provider'?[evidence.regularPaid,evidence.noticePaid]:action==='claim-client-refund'?[evidence.clientRefunded]:[evidence.hasStoredNotice,p.S,p.E]);
  return Object.freeze({source:'SYNTHETIC',key,scopeKey,cycleKey,account:current.account,chainId:String(current.chainId),target:tx.to,value:'0',data,action,agreement:c.agreement,token:terms.token,recipient,amount:String(amount),callerRule:action==='start-notice'?'Immutable client only':'Permissionless contract call; authenticated context is still required by this application',terms:serialized,blockNumber:String(evidence.block.blockNumber),blockHash:evidence.block.blockHash,noticeReason:reason,noticeStart:reason==='NONE'?null:String(S),noticeEnd:reason==='NONE'?null:String(E),effect});
 };
}
