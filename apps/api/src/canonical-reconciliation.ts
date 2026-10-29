import type {AttemptPreparation,SyntheticAttemptAdapter,Reconciled} from './attempt-evidence.js';
import {isIssuedApprovalOutcome} from './approval-outcome.js';
import type {ApprovalOutcome} from './approval-outcome.js';
import {isIssuedNoticeOutcome} from './notice-outcome.js';
import type {NoticeOutcome} from './notice-outcome.js';
import {isIssuedFundingOutcome} from './funding-outcome.js';
import type {FundingOutcome} from './funding-outcome.js';
import {isIssuedBusinessOutcome} from './business-outcome.js';
import type {BusinessOutcome} from './business-outcome.js';
const hash=/^0x[0-9a-f]{64}$/i;
export async function reconcileCanonical(adapter:SyntheticAttemptAdapter,p:AttemptPreparation,knownHash?:string|null):Promise<Reconciled>{
 const rpc=adapter.rpc;if(await rpc.getChainId()!==BigInt(p.chainId))return {state:'conflicted'};
 const tx=await rpc.findTransaction(p);if(!tx)return {state:'unknown'};
 if(!hash.test(tx.hash)||tx.chainId!==BigInt(p.chainId)||tx.from.toLowerCase()!==p.actor||tx.to.toLowerCase()!==p.target.toLowerCase()||tx.nonce!==BigInt(p.networkNonce)||tx.input.toLowerCase()!==p.data.toLowerCase()||tx.value!==0n||(knownHash&&knownHash.toLowerCase()!==tx.hash.toLowerCase()))return {state:'conflicted'};
 const r=await rpc.getReceipt(tx.hash);if(!r)return {state:'submitted',hash:tx.hash};
 if(r.hash.toLowerCase()!==tx.hash.toLowerCase()||!['confirmed','reverted'].includes(r.status)||typeof r.blockNumber!=='bigint'||r.blockNumber<0n||!hash.test(r.blockHash))return {state:'conflicted',hash:tx.hash};
 for(let i=0;i<2;i++){const b=await rpc.getBlock(r.blockNumber);if(b.number!==r.blockNumber||b.hash.toLowerCase()!==r.blockHash.toLowerCase()||b.transactions.filter(h=>h.toLowerCase()===tx.hash.toLowerCase()).length!==1)return {state:'reorged',hash:tx.hash};}
 if(await rpc.getChainId()!==BigInt(p.chainId))return {state:'conflicted',hash:tx.hash};
 let outcome:ApprovalOutcome|NoticeOutcome|FundingOutcome|BusinessOutcome|undefined;
 if(r.status==='confirmed'&&['approve-creation','approve-renewal'].includes(p.action)){
  if(!p.approval||!adapter.verifyApproval)return {state:'unknown',hash:tx.hash};
  outcome=await adapter.verifyApproval(p,{hash:tx.hash,blockNumber:r.blockNumber,blockHash:r.blockHash});
  if(!isIssuedApprovalOutcome(outcome,p,{hash:tx.hash,blockNumber:r.blockNumber,blockHash:r.blockHash}))throw new Error('Unissued or mismatched approval outcome');
 }
 if(r.status==='confirmed'&&['start-notice','materialize-notice'].includes(p.action)){
  if(!p.notice||!adapter.verifyNotice)return {state:'unknown',hash:tx.hash};
  outcome=await adapter.verifyNotice(p,{hash:tx.hash,blockNumber:r.blockNumber,blockHash:r.blockHash});
  if(!isIssuedNoticeOutcome(outcome,p,{hash:tx.hash,blockNumber:r.blockNumber,blockHash:r.blockHash}))throw new Error('Unissued or mismatched notice outcome');
 }
 if(r.status==='confirmed'&&p.action==='fund-renewal'){
  if(!p.funding||!adapter.verifyFunding)return {state:'unknown',hash:tx.hash};
  outcome=await adapter.verifyFunding(p,{hash:tx.hash,blockNumber:r.blockNumber,blockHash:r.blockHash});
  if(!isIssuedFundingOutcome(outcome,p,{hash:tx.hash,blockNumber:r.blockNumber,blockHash:r.blockHash}))throw new Error('Unissued or mismatched funding outcome');
 }
 if(r.status==='confirmed'&&['create-agreement','claim-provider','claim-client-refund'].includes(p.action)){
  if(!p.business||!adapter.verifyBusiness)return {state:'unknown',hash:tx.hash};
  outcome=await adapter.verifyBusiness(p,{hash:tx.hash,blockNumber:r.blockNumber,blockHash:r.blockHash});
  if(!isIssuedBusinessOutcome(outcome,p,{hash:tx.hash,blockNumber:r.blockNumber,blockHash:r.blockHash}))throw new Error('Unissued or mismatched business outcome');
 }
 return {state:r.status as 'confirmed'|'reverted',hash:tx.hash,proof:{blockNumber:String(r.blockNumber),blockHash:r.blockHash,...(outcome?{outcome}:{})}};
}
