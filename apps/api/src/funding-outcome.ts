/** Read-only renewal outcome issuance. No endpoint, signer, executor or live registration. */
import {decodeEventLog,encodeEventTopics,encodeFunctionData,encodeAbiParameters,parseAbiParameters,erc20Abi,keccak256} from 'viem';
import type {Abi,Hex} from 'viem';
import {AGREEMENT_ABI,FACTORY_ABI} from '@noticevault/sdk';
import {assertConsistentState,computeD,computeR,computeV,computeW} from '@noticevault/domain';
import type {AgreementTerms} from '@noticevault/domain';
import type {NoticeBinding} from './notice-outcome.js';
import type {AttemptPreparation} from './attempt-evidence.js';
import type {CanonicalExecution} from './approval-outcome.js';
export type FundingBinding=NoticeBinding;
export type FundingOutcome=Readonly<{kind:'STATE_CHANGED';action:'fund-renewal';agreement:string;client:string;token:string;termsHash:string;fundedAmount:string;periodSeconds:string;previousRegularFunded:string;newRegularFunded:string;previousFundedThrough:string;newFundedThrough:string;observedRegularFunded:string;observedLiability:string;observedBalance:string;observedAllowance:string}>;
export interface FundingReader {
 getChainId():Promise<unknown>;
 getTransactionReceipt(args:{hash:Hex}):Promise<unknown>;
 getBytecode(args:{address:Hex;blockNumber:bigint}):Promise<unknown>;
 getBlock(args:{blockNumber:bigint;includeTransactions:false}):Promise<unknown>;
 readContract(args:{address:Hex;abi:Abi;functionName:string;args?:readonly unknown[];blockNumber:bigint}):Promise<unknown>;
}
export type FundingPolicy=Readonly<{chainId:bigint;factory:string;token:string;factoryCodeHash:string;tokenCodeHash:string;policyHash:string}>;
const H=/^0x[0-9a-f]{64}$/i,A=/^0x[0-9a-f]{40}$/i,X=/^0x(?:[0-9a-f]{2})*$/i,MAX=(1n<<256n)-1n,I64=(1n<<63n)-1n;
const termsParams=parseAbiParameters('uint32,address,address,address,uint256,uint64,uint64,uint64,uint256,uint64,bytes32');
const issued=new WeakMap<object,{key:string;at:number}>();
function fail():never{throw new Error('EVIDENCE_CONFLICT: funding outcome unavailable or inconsistent');}
function lower(v:unknown,re:RegExp):string{if(typeof v!=='string'||!re.test(v))return fail();return v.toLowerCase();}
function addr(v:unknown){const x=lower(v,A);if(BigInt(x)===0n)return fail();return x;}
function obj(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))return fail();return v as Record<string,unknown>;}
function u(v:unknown,max=MAX):bigint{if(typeof v!=='bigint'||v<0n||v>max)return fail();return v;}
function dec(v:unknown){if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(v))return fail();return u(BigInt(v));}
function idx(v:unknown){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)return fail();return v;}
function tuple(v:unknown,n:number):unknown[]{if(!Array.isArray(v)||v.length!==n)return fail();return v;}
function digest(v:unknown){return JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x);}
function key(p:AttemptPreparation,r:CanonicalExecution){const {issuedAt,...stable}=p;void issuedAt;return digest([stable,r]);}
export function isIssuedFundingOutcome(v:unknown,p:AttemptPreparation,r:CanonicalExecution):v is FundingOutcome{if(!v||typeof v!=='object')return false;const x=issued.get(v);return !!x&&x.key===key(p,r)&&Date.now()>=x.at&&Date.now()-x.at<=60000;}
function block(v:unknown,r:CanonicalExecution){const b=obj(v);if(u(b.number)!==r.blockNumber||lower(b.hash,H)!==r.blockHash.toLowerCase()||!Array.isArray(b.transactions))return fail();const txs=b.transactions.map(x=>lower(x,H));if(new Set(txs).size!==txs.length)return fail();return {time:u(b.timestamp,I64),txs};}
function readTerms(raw:unknown,p:AttemptPreparation,policy:FundingPolicy){
 const t=tuple(raw,11);if(t[0]!==1)return fail();
 const terms:AgreementTerms={schemaVersion:1,client:addr(t[1]),provider:addr(t[2]),token:addr(t[3]),amountPerPeriod:u(t[4]),periodSeconds:u(t[5],I64),noticeSeconds:u(t[6],I64),startAt:u(t[7],I64),clientNonce:u(t[8]),acceptanceDeadline:u(t[9],I64),termsDocumentHash:lower(t[10],H)};
 if(terms.client!==addr(p.actor)||terms.token!==policy.token||terms.amountPerPeriod===0n||terms.periodSeconds===0n||terms.noticeSeconds===0n||terms.startAt===0n)return fail();
 const encoded=encodeAbiParameters(termsParams,[1,terms.client as Hex,terms.provider as Hex,terms.token as Hex,terms.amountPerPeriod,terms.periodSeconds,terms.noticeSeconds,terms.startAt,terms.clientNonce,terms.acceptanceDeadline,terms.termsDocumentHash as Hex]);
 if(keccak256(encoded)!==lower(p.funding!.termsHash,H))return fail();return terms;
}

function receipt(raw:unknown,p:AttemptPreparation,r:CanonicalExecution,policy:FundingPolicy,terms:AgreementTerms,time:bigint){
 const v=obj(raw),ti=idx(v.transactionIndex),oldF=dec(p.funding!.regularFunded),oldD=computeD(terms,oldF),amount=terms.amountPerPeriod,newF=u(oldF+amount),newD=computeD(terms,newF),R=computeR(terms);u(newF+R);
 if(oldF===0n||oldF%amount!==0n||oldD!==dec(p.funding!.fundedThrough)||time>=oldD||newD+terms.noticeSeconds>I64||p.data.toLowerCase()!==encodeFunctionData({abi:AGREEMENT_ABI,functionName:'fundNextPeriod',args:[oldD]}).toLowerCase())return fail();
 if(lower(v.transactionHash,H)!==r.hash.toLowerCase()||lower(v.blockHash,H)!==r.blockHash.toLowerCase()||u(v.blockNumber)!==r.blockNumber||addr(v.from)!==terms.client||addr(v.to)!==addr(p.target)||v.status!=='success'||!Array.isArray(v.logs)||v.logs.length<3||v.logs.length>4)return fail();
 let last=-1,capacity=-1,transfer=-1,funded=-1,approval=-1;
 const normalized=v.logs.map(rawLog=>{const l=obj(rawLog),i=idx(l.logIndex);if(i<=last||l.removed!==false||lower(l.transactionHash,H)!==r.hash.toLowerCase()||lower(l.blockHash,H)!==r.blockHash.toLowerCase()||u(l.blockNumber)!==r.blockNumber||idx(l.transactionIndex)!==ti||!Array.isArray(l.topics))return fail();last=i;
 const emitter=addr(l.address),topics=l.topics.map(x=>lower(x,H)) as [Hex,...Hex[]],data=lower(l.data,X) as Hex;
 if(emitter===policy.factory){
  if(capacity>=0)return fail();const e=decodeEventLog({abi:FACTORY_ABI,eventName:'CapacityChanged',topics,data,strict:true}),a=e.args;
  if(addr(a.agreement)!==addr(p.target)||a.delta!==amount||u(a.newAgreementL)<amount+R||a.newAgreementL>newF+R||u(a.newFactoryL)<a.newAgreementL||digest(topics)!==digest(encodeEventTopics({abi:FACTORY_ABI,eventName:'CapacityChanged',args:{agreement:p.target as Hex}}))||data!==encodeAbiParameters(parseAbiParameters('int256,uint256,uint256'),[amount,a.newAgreementL,a.newFactoryL]).toLowerCase())return fail();capacity=i;
 }else if(emitter===addr(p.target)){
  if(funded>=0)return fail();const e=decodeEventLog({abi:AGREEMENT_ABI,eventName:'RegularFunded',topics,data,strict:true});if(e.args.newF!==newF||e.args.newD!==newD||e.args.amount!==amount||digest(topics)!==digest(encodeEventTopics({abi:AGREEMENT_ABI,eventName:'RegularFunded'}))||data!==encodeAbiParameters(parseAbiParameters('uint256,uint64,uint256'),[newF,newD,amount]).toLowerCase())return fail();funded=i;
 }else if(emitter===policy.token){
  const e=decodeEventLog({abi:erc20Abi,topics,data,strict:true});
  if(e.eventName==='Transfer'){
   if(transfer>=0||addr(e.args.from)!==terms.client||addr(e.args.to)!==addr(p.target)||e.args.value!==amount||digest(topics)!==digest(encodeEventTopics({abi:erc20Abi,eventName:'Transfer',args:{from:terms.client as Hex,to:p.target as Hex}}))||data!==encodeAbiParameters(parseAbiParameters('uint256'),[amount]).toLowerCase())return fail();transfer=i;
  }else if(e.eventName==='Approval'){
   if(approval>=0||addr(e.args.owner)!==terms.client||addr(e.args.spender)!==addr(p.target)||digest(topics)!==digest(encodeEventTopics({abi:erc20Abi,eventName:'Approval',args:{owner:terms.client as Hex,spender:p.target as Hex}}))||data!==encodeAbiParameters(parseAbiParameters('uint256'),[u(e.args.value)]).toLowerCase())return fail();approval=i;
  }else return fail();
 }else return fail();
 return [emitter,topics,data,i];
 });
 if(capacity<0||transfer<=capacity||funded<=transfer||(approval>=0&&(approval<=capacity||approval>=funded)))return fail();
 return {ti,digest:digest(normalized),amount,oldF,oldD,newF,newD};
}
function accounting(raw:unknown,terms:AgreementTerms,time:bigint,newF:bigint){
 const a=tuple(raw,9),F=u(a[0]),RP=u(a[1]),NP=u(a[2]),CR=u(a[3]),R=u(a[4]),S=u(a[6],I64),L=u(a[8]);
 if(typeof a[5]!=='boolean'||typeof a[7]!=='number'||![0,1,2].includes(a[7])||F<newF||R!==computeR(terms)||u(F+R)-RP-NP-CR!==L)return fail();
 if(a[5]?(a[7]!==1||S!==(time>terms.startAt?time:terms.startAt)):(S!==0n||a[7]!==0))return fail();
 const state={terms,regularFunded:F,regularPaid:RP,noticePaid:NP,clientRefunded:CR,noticeStartStored:a[5]?S:null,noticeReasonStored:a[5]?'CLIENT_CANCELLED' as const:null};
 assertConsistentState(state);if(RP>computeV(state,time)||NP>computeW(state,time))return fail();return {F,L};
}

export function createFundingOutcomeVerifier(source:FundingPolicy,readers:readonly[FundingReader,FundingReader]){
 const policy=Object.freeze({...source,factory:addr(source.factory),token:addr(source.token),policyHash:lower(source.policyHash,H),factoryCodeHash:lower(source.factoryCodeHash,H),tokenCodeHash:lower(source.tokenCodeHash,H)});
 if(typeof policy.chainId!=='bigint'||policy.chainId<=0n||readers.length!==2||!readers[0]||!readers[1]||readers[0]===readers[1])return fail();const sources=Object.freeze([...readers]);
 async function verify(input:AttemptPreparation,execution:CanonicalExecution):Promise<FundingOutcome>{
  const p=Object.freeze({...input,...(input.funding?{funding:Object.freeze({...input.funding})}:{})}),r=Object.freeze({...execution});
  if(p.action!=='fund-renewal'||p.chainId!==String(policy.chainId)||p.policyHash.toLowerCase()!==policy.policyHash||p.value!=='0'||!p.funding)return fail();
  const target=addr(p.target) as Hex,agreementCodeHash=lower(p.funding.agreementCodeHash,H);lower(r.hash,H);lower(r.blockHash,H);u(r.blockNumber);
  const observe=async(rpc:FundingReader)=>{
   async function chain(){const id=await rpc.getChainId();if(typeof id!=='number'||!Number.isSafeInteger(id)||BigInt(id)!==policy.chainId)return fail();}
   await chain();const b=block(await rpc.getBlock({blockNumber:r.blockNumber,includeTransactions:false}),r);
   await Promise.all(([ [target,agreementCodeHash],[policy.factory,policy.factoryCodeHash],[policy.token,policy.tokenCodeHash] ] as const).map(async([address,expected])=>{const code=lower(await rpc.getBytecode({address:address as Hex,blockNumber:r.blockNumber}),X);if(code==='0x'||keccak256(code as Hex)!==expected)return fail();}));
   const read=(address:string,abi:Abi,functionName:string,args?:readonly unknown[])=>rpc.readContract({address:address as Hex,abi,functionName,...(args?{args}:{}),blockNumber:r.blockNumber});
   const [rawTerms,rawAccounting,factory,registered,token,factoryL,totalL,decimals,balance,allowance]=await Promise.all([
    read(target,AGREEMENT_ABI,'terms'),read(target,AGREEMENT_ABI,'accounting'),read(target,AGREEMENT_ABI,'factory'),
    read(policy.factory,FACTORY_ABI,'registeredAgreement',[target]),read(policy.factory,FACTORY_ABI,'token'),read(policy.factory,FACTORY_ABI,'perAgreementLiability',[target]),read(policy.factory,FACTORY_ABI,'outstandingLiability'),
    read(policy.token,erc20Abi,'decimals'),read(policy.token,erc20Abi,'balanceOf',[target]),read(policy.token,erc20Abi,'allowance',[p.actor,target])]);
   if(addr(factory)!==policy.factory||registered!==true||addr(token)!==policy.token||decimals!==6)return fail();
   const terms=readTerms(rawTerms,p,policy),e=receipt(await rpc.getTransactionReceipt({hash:r.hash as Hex}),p,r,policy,terms,b.time);if(b.txs[e.ti]!==r.hash.toLowerCase())return fail();
   const state=accounting(rawAccounting,terms,b.time,e.newF),tokenBalance=u(balance),remainingAllowance=u(allowance);
   if(u(factoryL)!==state.L||u(totalL)<state.L||tokenBalance<state.L)return fail();
   await chain();
   const outcome:FundingOutcome={kind:'STATE_CHANGED',action:'fund-renewal',agreement:target,client:terms.client,token:terms.token,termsHash:p.funding!.termsHash.toLowerCase(),fundedAmount:String(e.amount),periodSeconds:String(terms.periodSeconds),previousRegularFunded:String(e.oldF),newRegularFunded:String(e.newF),previousFundedThrough:String(e.oldD),newFundedThrough:String(e.newD),observedRegularFunded:String(state.F),observedLiability:String(state.L),observedBalance:String(tokenBalance),observedAllowance:String(remainingAllowance)};
   return {outcome,events:e.digest,time:String(b.time),state:digest([rawTerms,rawAccounting,factoryL,totalL]),transactions:b.txs};
  };
  const observations=await Promise.all(sources.map(async rpc=>{const a=await observe(rpc),b=await observe(rpc);if(digest(a)!==digest(b))return fail();return a;}));
  if(digest(observations[0])!==digest(observations[1]))return fail();const outcome=Object.freeze(observations[0]!.outcome);issued.set(outcome,{key:key(p,r),at:Date.now()});return outcome;
 }
 return async(p:AttemptPreparation,r:CanonicalExecution)=>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([verify(p,r),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('EVIDENCE_UNAVAILABLE: funding verification deadline exceeded')),5000);})]);}finally{if(timer!==undefined)clearTimeout(timer);}};
}
