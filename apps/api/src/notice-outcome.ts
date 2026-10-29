/** Server-issued notice action outcomes. Read-only injected transports; no live registration. */
import {encodeFunctionData,encodeAbiParameters,parseAbiParameters,decodeEventLog,keccak256} from 'viem';
import type {Hex} from 'viem';
import {AGREEMENT_ABI} from '@noticevault/sdk';
import {assertConsistentState,computeD,computeR} from '@noticevault/domain';
import type {AgreementTerms} from '@noticevault/domain';
import type {AttemptPreparation} from './attempt-evidence.js';
import type {CanonicalExecution} from './approval-outcome.js';
export type NoticeBinding={termsHash:string;agreementCodeHash:string;regularFunded:string;fundedThrough:string};
export type NoticeOutcome=Readonly<{kind:'STATE_CHANGED'|'NO_CHANGE';action:'start-notice'|'materialize-notice';agreement:string;client:string;provider:string;token:string;termsHash:string;regularFunded:string;fundedThrough:string;noticeStart:string;noticeEnd:string;reason:'CLIENT_CANCELLED'|'MISSED_CHECKPOINT'}>;
export interface NoticeReader {
 getChainId():Promise<unknown>;
 getTransactionReceipt(args:{hash:Hex}):Promise<unknown>;
 getBytecode(args:{address:Hex;blockNumber:bigint}):Promise<unknown>;
 getBlock(args:{blockNumber:bigint;includeTransactions:false}):Promise<unknown>;
 readContract(args:{address:Hex;abi:typeof AGREEMENT_ABI;functionName:'terms'|'accounting'|'factory';blockNumber:bigint}):Promise<unknown>;
}
export type NoticePolicy=Readonly<{chainId:bigint;factory:string;token:string;policyHash:string}>;
const H=/^0x[0-9a-f]{64}$/i,A=/^0x[0-9a-f]{40}$/i,X=/^0x(?:[0-9a-f]{2})*$/i,MAX=(1n<<256n)-1n,I64=(1n<<63n)-1n;
const params=parseAbiParameters('uint32,address,address,address,uint256,uint64,uint64,uint64,uint256,uint64,bytes32');
const issued=new WeakMap<object,{key:string;at:number}>();
function fail():never{throw new Error('EVIDENCE_CONFLICT: notice outcome unavailable or inconsistent');}
function lower(v:unknown,re:RegExp):string{if(typeof v!=='string'||!re.test(v))return fail();return v.toLowerCase();}
function addr(v:unknown){const x=lower(v,A);if(BigInt(x)===0n)return fail();return x;}
function obj(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))return fail();return v as Record<string,unknown>;}
function u(v:unknown,max=MAX):bigint{if(typeof v!=='bigint'||v<0n||v>max)return fail();return v;}
function dec(v:unknown){if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(v))return fail();return u(BigInt(v));}
function index(v:unknown){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)return fail();return v;}
function tuple(v:unknown,n:number):unknown[]{if(!Array.isArray(v)||v.length!==n)return fail();return v;}
function digest(v:unknown):string{return JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x);}
function key(p:AttemptPreparation,r:CanonicalExecution){const {issuedAt,...stable}=p;void issuedAt;return digest([stable,r]);}
export function isIssuedNoticeOutcome(v:unknown,p:AttemptPreparation,r:CanonicalExecution):v is NoticeOutcome{if(!v||typeof v!=='object')return false;const x=issued.get(v);return !!x&&x.key===key(p,r)&&Date.now()>=x.at&&Date.now()-x.at<=60000;}
function block(v:unknown,r:CanonicalExecution){const b=obj(v);if(u(b.number)!==r.blockNumber||lower(b.hash,H)!==r.blockHash.toLowerCase()||!Array.isArray(b.transactions))return fail();const txs=b.transactions.map(x=>lower(x,H));if(new Set(txs).size!==txs.length)return fail();return {time:u(b.timestamp,I64),txs};}
function receipt(v:unknown,p:AttemptPreparation,r:CanonicalExecution){const a=obj(v);if(lower(a.transactionHash,H)!==r.hash.toLowerCase()||lower(a.blockHash,H)!==r.blockHash.toLowerCase()||u(a.blockNumber)!==r.blockNumber||addr(a.from)!==addr(p.actor)||addr(a.to)!==addr(p.target)||a.status!=='success'||!Array.isArray(a.logs)||a.logs.length>1)return fail();
 const ti=index(a.transactionIndex);if(a.logs.length===0){if(p.action!=='materialize-notice'||lower(a.logsBloom,/^0x[0-9a-f]{512}$/i)!=='0x'+'0'.repeat(512))return fail();return {start:null,reason:null,ti,digest:'[]'};}const l=obj(a.logs[0]);if(addr(l.address)!==addr(p.target)||l.removed!==false||lower(l.transactionHash,H)!==r.hash.toLowerCase()||lower(l.blockHash,H)!==r.blockHash.toLowerCase()||u(l.blockNumber)!==r.blockNumber||index(l.transactionIndex)!==ti||!Array.isArray(l.topics)||l.topics.length!==1)return fail();index(l.logIndex);
 const data=lower(l.data,X),topics=l.topics.map(x=>lower(x,H));const e=decodeEventLog({abi:AGREEMENT_ABI,eventName:'NoticeStarted',topics:topics as [Hex,...Hex[]],data:data as Hex,strict:true});
 const start=u(e.args.S,I64),reason=e.args.reason;if(![1,2].includes(reason)||encodeAbiParameters(parseAbiParameters('uint64,uint8'),[start,reason]).toLowerCase()!==data)return fail();return {start,reason,ti,digest:digest([topics,data,l.logIndex])};
}

function snapshot(rawTerms:unknown,rawState:unknown,p:AttemptPreparation,policy:NoticePolicy,time:bigint,event:ReturnType<typeof receipt>){
 const t=tuple(rawTerms,11),a=tuple(rawState,9),binding=p.notice!;
 if(t[0]!==1)return fail();
 const terms:AgreementTerms={schemaVersion:1,client:addr(t[1]),provider:addr(t[2]),token:addr(t[3]),amountPerPeriod:u(t[4]),periodSeconds:u(t[5],I64),noticeSeconds:u(t[6],I64),startAt:u(t[7],I64),clientNonce:u(t[8]),acceptanceDeadline:u(t[9],I64),termsDocumentHash:lower(t[10],H)};
 if((p.action==='start-notice'&&terms.client!==addr(p.actor))||terms.token!==policy.token||terms.amountPerPeriod===0n||terms.periodSeconds===0n||terms.noticeSeconds===0n||terms.startAt===0n)return fail();
 const encoded=encodeAbiParameters(params,[1,terms.client as Hex,terms.provider as Hex,terms.token as Hex,terms.amountPerPeriod,terms.periodSeconds,terms.noticeSeconds,terms.startAt,terms.clientNonce,terms.acceptanceDeadline,terms.termsDocumentHash as Hex]);
 const termsHash=keccak256(encoded);if(termsHash!==lower(binding.termsHash,H))return fail();
 const F=u(a[0]),RP=u(a[1]),NP=u(a[2]),CR=u(a[3]),R=u(a[4]),S=u(a[6],I64),L=u(a[8]);if(a[5]!==true||![1,2].includes(a[7] as number)||(event.start!==null&&(a[7]!==event.reason||S!==event.start))||F!==dec(binding.regularFunded)||R!==computeR(terms)||F+R-RP-NP-CR!==L)return fail();
 const reason=a[7]===1?'CLIENT_CANCELLED':'MISSED_CHECKPOINT';
 const state={terms,regularFunded:F,regularPaid:RP,noticePaid:NP,clientRefunded:CR,noticeStartStored:S,noticeReasonStored:reason as 'CLIENT_CANCELLED'|'MISSED_CHECKPOINT'};assertConsistentState(state);
 const D=computeD(terms,F),expected=time>=D?D:time>terms.startAt?time:terms.startAt;
 if(D!==dec(binding.fundedThrough)||S+terms.noticeSeconds>I64)return fail();
 if(p.action==='start-notice'){if(event.start===null||S!==expected||event.reason!==(time>=D?2:1))return fail();}
 else if(event.start!==null){if(time<D||S!==D||event.reason!==2)return fail();}
 else {if(reason==='MISSED_CHECKPOINT'?(S!==D||time<D):(S<terms.startAt||S>=D||(S>time&&S!==terms.startAt)))return fail();}

 const outcome:NoticeOutcome={kind:event.start===null?'NO_CHANGE':'STATE_CHANGED',action:p.action as 'start-notice'|'materialize-notice',agreement:addr(p.target),client:terms.client,provider:terms.provider,token:terms.token,termsHash,regularFunded:String(F),fundedThrough:String(D),noticeStart:String(S),noticeEnd:String(S+terms.noticeSeconds),reason};
 return {outcome,stateDigest:digest([t,a])};
}
export function createNoticeOutcomeVerifier(source:NoticePolicy,readers:readonly[NoticeReader,NoticeReader]){
 const policy=Object.freeze({...source,factory:addr(source.factory),token:addr(source.token),policyHash:lower(source.policyHash,H)});
 if(typeof policy.chainId!=='bigint'||policy.chainId<=0n||readers.length!==2||!readers[0]||!readers[1]||readers[0]===readers[1])return fail();const sources=Object.freeze([...readers]);
 async function verify(input:AttemptPreparation,execution:CanonicalExecution):Promise<NoticeOutcome>{
 const p=Object.freeze({...input,...(input.notice?{notice:Object.freeze({...input.notice})}:{})}),r=Object.freeze({...execution});
 if(!['start-notice','materialize-notice'].includes(p.action)||p.chainId!==String(policy.chainId)||p.policyHash.toLowerCase()!==policy.policyHash||p.value!=='0'||!p.notice||p.data.toLowerCase()!==encodeFunctionData({abi:AGREEMENT_ABI,functionName:p.action==='start-notice'?'startNotice':'materializeNotice'}).toLowerCase())return fail();
 const target=addr(p.target) as Hex,codeHash=lower(p.notice.agreementCodeHash,H);lower(r.hash,H);lower(r.blockHash,H);u(r.blockNumber);
 const observations=await Promise.all(sources.map(async rpc=>{
  async function chain(){const id=await rpc.getChainId();if(typeof id!=='number'||!Number.isSafeInteger(id)||BigInt(id)!==policy.chainId)return fail();}
  async function read(){const code=lower(await rpc.getBytecode({address:target,blockNumber:r.blockNumber}),X);if(code==='0x'||keccak256(code as Hex)!==codeHash)return fail();
   const readContract=(functionName:'terms'|'accounting'|'factory')=>rpc.readContract({address:target,abi:AGREEMENT_ABI,functionName,blockNumber:r.blockNumber});
   const [terms,accounting,factory]=await Promise.all([readContract('terms'),readContract('accounting'),readContract('factory')]);if(addr(factory)!==policy.factory)return fail();return {terms,accounting};
  }
  await chain();const e=receipt(await rpc.getTransactionReceipt({hash:r.hash as Hex}),p,r),b=block(await rpc.getBlock({blockNumber:r.blockNumber,includeTransactions:false}),r);if(b.txs[e.ti]!==r.hash.toLowerCase())return fail();
  const s=await read(),result=snapshot(s.terms,s.accounting,p,policy,b.time,e);
  const again=await read(),checked=snapshot(again.terms,again.accounting,p,policy,b.time,e);if(checked.stateDigest!==result.stateDigest)return fail();
  const e2=receipt(await rpc.getTransactionReceipt({hash:r.hash as Hex}),p,r),b2=block(await rpc.getBlock({blockNumber:r.blockNumber,includeTransactions:false}),r);if(digest(e2)!==digest(e)||digest(b2)!==digest(b))return fail();await chain();return {...result,eventDigest:e.digest,time:String(b.time)};
 }));if(digest(observations[0])!==digest(observations[1]))return fail();
 const result=Object.freeze(observations[0]!.outcome);issued.set(result,{key:key(p,r),at:Date.now()});return result;
 }
 return async(p:AttemptPreparation,r:CanonicalExecution)=>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([verify(p,r),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('EVIDENCE_UNAVAILABLE: notice verification deadline exceeded')),5000);})]);}finally{if(timer!==undefined)clearTimeout(timer);}};
}
