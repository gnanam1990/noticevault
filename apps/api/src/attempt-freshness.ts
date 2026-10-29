import {keccak256,toHex} from 'viem';
import {parseTerms,serializeTerms} from '@noticevault/sdk';
import {computeV,computeW,computeR,computeD,assertConsistentState,type AccountingState} from '@noticevault/domain';
import {preparationBinding,validatePreparation,type AttemptPreparation,type SyntheticAttemptAdapter} from './attempt-evidence.js';
import {stringify} from './reviewed-artifacts.js';
const fail=()=>{throw Error('Reviewed execution context changed or expired');};
const uint=(s:string|undefined)=>{if(typeof s!=='string'||!/^(0|[1-9][0-9]*)$/.test(s))return fail();return BigInt(s);};
export function settlementCycleKey(p:AttemptPreparation):string {
 const s=p.settlement,b=p.business??p.notice;if(!s||!b)return fail();
 return keccak256(toHex(stringify({resource:p.resource,action:p.action,termsHash:b.termsHash,regularFunded:s.accounting.regularFunded,fundedThrough:s.accounting.fundedThrough,policyHash:p.policyHash,settlement:{agreement:s.agreement,streamId:s.streamId,fingerprint:s.fingerprint,terms:serializeTerms(parseTerms(s.terms)),recipient:s.recipient,amount:s.amount,noticeStart:s.noticeStart,noticeEnd:s.noticeEnd,noticeReason:s.noticeReason,callerRule:s.callerRule,accounting:{regularFunded:s.accounting.regularFunded,regularPaid:s.accounting.regularPaid,noticePaid:s.accounting.noticePaid,clientRefunded:s.accounting.clientRefunded,noticeReserve:s.accounting.noticeReserve,liability:s.accounting.liability,fundedThrough:s.accounting.fundedThrough,observedAt:s.accounting.observedAt}}})));
}
function settlementState(p:AttemptPreparation):AccountingState {
 const s=p.settlement;if(!s)return fail();const a=s.accounting,t=parseTerms(s.terms),reason=s.noticeReason;
 if(!['NONE','CLIENT_CANCELLED','MISSED_CHECKPOINT'].includes(reason))return fail();
 const state:AccountingState={terms:{...t,schemaVersion:1},regularFunded:uint(a.regularFunded),regularPaid:uint(a.regularPaid),noticePaid:uint(a.noticePaid),clientRefunded:uint(a.clientRefunded),noticeStartStored:s.noticeStart===null?null:uint(s.noticeStart),noticeReasonStored:reason==='CLIENT_CANCELLED'?reason:reason==='MISSED_CHECKPOINT'?reason:null};
 assertConsistentState(state);const R=computeR(state.terms);
 if(R!==uint(a.noticeReserve)||computeD(state.terms,state.regularFunded)!==uint(a.fundedThrough)||state.regularFunded+R-state.regularPaid-state.noticePaid-state.clientRefunded!==uint(a.liability))return fail();
 return state;
}
/** Fresh SDK checks stay mandatory. Only canonical passage of time may differ from the original review. */
export async function assertClaimFreshness(adapter:SyntheticAttemptAdapter,reserved:AttemptPreparation,fresh:AttemptPreparation):Promise<void>{
 const input={workspaceId:reserved.workspaceId,actor:reserved.actor,chainId:reserved.chainId,resource:reserved.resource,action:reserved.action};
 validatePreparation(reserved,input);validatePreparation(fresh,input);
 const normalized=structuredClone(fresh),a=reserved.discoveryAnchor,b=fresh.discoveryAnchor;
 if(Boolean(a)!==Boolean(b))return fail();
 if(a&&b){
  const oldN=uint(a.blockNumber),newN=uint(b.blockNumber);if(newN<oldN||(newN===oldN&&a.blockHash.toLowerCase()!==b.blockHash.toLowerCase()))return fail();
  const [oldBlock,newBlock]=await Promise.all([adapter.rpc.getBlock(oldN),adapter.rpc.getBlock(newN)]);
  if(oldBlock.number!==oldN||oldBlock.hash.toLowerCase()!==a.blockHash.toLowerCase()||newBlock.number!==newN||newBlock.hash.toLowerCase()!==b.blockHash.toLowerCase())return fail();
  normalized.discoveryAnchor=structuredClone(a);
 }
 const old=reserved.settlement,next=normalized.settlement;
 if(Boolean(old)!==Boolean(next))return fail();
 if(old&&next){
  if(settlementCycleKey(reserved)!==reserved.cycleKey||settlementCycleKey(fresh)!==fresh.cycleKey)return fail();
  const before=uint(old.accounting.observedAt),after=uint(next.accounting.observedAt);
  if(after<before||after-before>60n)return fail();
  if(reserved.action==='claim-provider'){
   const oldState=settlementState(reserved),newState=settlementState(fresh);
   const expected=(state:AccountingState,now:bigint)=>computeV(state,now)-state.regularPaid+computeW(state,now)-state.noticePaid;
   if(uint(old.amount)!==expected(oldState,before)||uint(next.amount)!==expected(newState,after)||uint(next.amount)<uint(old.amount)||uint(next.amount)>uint(old.accounting.liability))return fail();
   next.amount=old.amount;
  }
  if(reserved.action==='start-notice'&&old.noticeReason==='CLIENT_CANCELLED'){
   const t=parseTerms(old.terms),D=uint(old.accounting.fundedThrough);
   if(before>=D||after>=D||next.noticeReason!==old.noticeReason||uint(old.noticeStart??undefined)!==(before>t.startAt?before:t.startAt)||uint(next.noticeStart??undefined)!==(after>t.startAt?after:t.startAt)||uint(old.noticeEnd??undefined)!==uint(old.noticeStart??undefined)+t.noticeSeconds||uint(next.noticeEnd??undefined)!==uint(next.noticeStart??undefined)+t.noticeSeconds)return fail();
   next.noticeStart=old.noticeStart;next.noticeEnd=old.noticeEnd;
  }
  next.accounting.observedAt=String(before);
  normalized.cycleKey=settlementCycleKey(normalized);
 }
 if(preparationBinding(normalized)!==preparationBinding(reserved))return fail();
}
