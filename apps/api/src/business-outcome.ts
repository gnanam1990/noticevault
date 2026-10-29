/** Read-only creation/payout evidence; no live registration or transaction executor. */
import {decodeEventLog,decodeFunctionData,encodeEventTopics,encodeFunctionData,encodeAbiParameters,parseAbiParameters,erc20Abi,keccak256,hashTypedData} from 'viem';
import type {Abi,Hex} from 'viem';
import {AGREEMENT_ABI,FACTORY_ABI} from '@noticevault/sdk';
import {assertConsistentState,computeD,computeR,computeV,computeW,calculateReferenceSnapshot,validateTerms} from '@noticevault/domain';
import type {AgreementTerms} from '@noticevault/domain';
import type {FundingReader,FundingPolicy} from './funding-outcome.js';
import type {AttemptPreparation} from './attempt-evidence.js';
import type {CanonicalExecution} from './approval-outcome.js';
export type BusinessBinding=Readonly<{termsHash:string;agreementCodeHash:string;termsDigest?:string}>;
type Base=Readonly<{agreement:string;factory:string;client:string;provider:string;token:string;termsHash:string;noticeReserve:string;observedRegularFunded:string;observedRegularPaid:string;observedNoticePaid:string;observedClientRefunded:string;observedLiability:string;observedBalance:string}>;
export type BusinessOutcome=Base&(Readonly<{kind:'STATE_CHANGED';action:'create-agreement';initialRegular:string;noticeReserve:string;depositedAmount:string;clientNonce:string;termsDigest:string}>|Readonly<{kind:'TRANSFER'|'NO_CHANGE';action:'claim-provider'|'claim-client-refund';recipient:string;amount:string;regularAmount:string;noticeAmount:string;noticeMaterialized:boolean}>);
const H=/^0x[0-9a-f]{64}$/i,A=/^0x[0-9a-f]{40}$/i,X=/^0x(?:[0-9a-f]{2})*$/i,MAX=(1n<<256n)-1n,I64=(1n<<63n)-1n;
const termsParams=parseAbiParameters('uint32,address,address,address,uint256,uint64,uint64,uint64,uint256,uint64,bytes32');
function fail():never{throw new Error('EVIDENCE_CONFLICT: business outcome unavailable or inconsistent');}
function lower(v:unknown,re:RegExp):string{if(typeof v!=='string'||!re.test(v))return fail();return v.toLowerCase();}
function addr(v:unknown){const x=lower(v,A);if(BigInt(x)===0n)return fail();return x;}
function obj(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))return fail();return v as Record<string,unknown>;}
function u(v:unknown,max=MAX):bigint{if(typeof v!=='bigint'||v<0n||v>max)return fail();return v;}
function idx(v:unknown){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)return fail();return v;}
function tuple(v:unknown,n:number):unknown[]{if(!Array.isArray(v)||v.length!==n)return fail();return v;}
function digest(v:unknown){return JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x);}
function block(v:unknown,r:CanonicalExecution){const b=obj(v);if(u(b.number)!==r.blockNumber||lower(b.hash,H)!==r.blockHash.toLowerCase()||!Array.isArray(b.transactions))return fail();const txs=b.transactions.map(x=>lower(x,H));if(new Set(txs).size!==txs.length)return fail();return {time:u(b.timestamp,I64),txs};}
function termsOf(raw:unknown,binding:BusinessBinding,policy:FundingPolicy){
 const t=tuple(raw,11);if(t[0]!==1)return fail();
 const terms:AgreementTerms={schemaVersion:1,client:addr(t[1]),provider:addr(t[2]),token:addr(t[3]),amountPerPeriod:u(t[4]),periodSeconds:u(t[5],I64),noticeSeconds:u(t[6],I64),startAt:u(t[7],I64),clientNonce:u(t[8]),acceptanceDeadline:u(t[9],I64),termsDocumentHash:lower(t[10],H)};
 if(terms.client===terms.provider||terms.token!==policy.token||terms.amountPerPeriod===0n||terms.periodSeconds===0n||terms.noticeSeconds===0n)return fail();
 const values=[1,terms.client as Hex,terms.provider as Hex,terms.token as Hex,terms.amountPerPeriod,terms.periodSeconds,terms.noticeSeconds,terms.startAt,terms.clientNonce,terms.acceptanceDeadline,terms.termsDocumentHash as Hex] as const;
 if(keccak256(encodeAbiParameters(termsParams,values))!==lower(binding.termsHash,H))return fail();return {terms,values};
}
function stateOf(raw:unknown,terms:AgreementTerms,time:bigint){
 const a=tuple(raw,9),F=u(a[0]),RP=u(a[1]),NP=u(a[2]),CR=u(a[3]),R=u(a[4]),S=u(a[6],I64),L=u(a[8]);
 if(typeof a[5]!=='boolean'||typeof a[7]!=='number'||![0,1,2].includes(a[7])||R!==computeR(terms)||u(F+R)-RP-NP-CR!==L||F===0n||F%terms.amountPerPeriod!==0n)return fail();
 const D=computeD(terms,F);if(D+terms.noticeSeconds>I64||(!a[5]&&(S!==0n||a[7]!==0))||(a[5]&&(a[7]===0||(a[7]===2?S!==D||time<D:S<terms.startAt||S>=D||S>(time>terms.startAt?time:terms.startAt)))))return fail();
 const state={terms,regularFunded:F,regularPaid:RP,noticePaid:NP,clientRefunded:CR,noticeStartStored:a[5]?S:null,noticeReasonStored:a[5]?(a[7]===1?'CLIENT_CANCELLED' as const:'MISSED_CHECKPOINT' as const):null};
 assertConsistentState(state);if(RP>computeV(state,time)||NP>computeW(state,time)||(state.noticeStartStored!==null&&CR>F-computeV(state,state.noticeStartStored)))return fail();const snap=calculateReferenceSnapshot(state,time);return {F,RP,NP,CR,R,L,state,snap};
}
type Log={emitter:string;topics:[Hex,...Hex[]];data:Hex;index:number};
function logsOf(raw:unknown,p:AttemptPreparation,r:CanonicalExecution,txs:string[]){
 const v=obj(raw),ti=idx(v.transactionIndex);if(lower(v.transactionHash,H)!==r.hash.toLowerCase()||lower(v.blockHash,H)!==r.blockHash.toLowerCase()||u(v.blockNumber)!==r.blockNumber||addr(v.from)!==addr(p.actor)||addr(v.to)!==addr(p.target)||v.status!=='success'||txs[ti]!==r.hash.toLowerCase()||!Array.isArray(v.logs)||v.logs.length>5)return fail();
 if(v.logs.length===0&&v.logsBloom!=='0x'+'0'.repeat(512))return fail();let last=-1;
 return v.logs.map(raw=>{const l=obj(raw),index=idx(l.logIndex);if(index<=last||l.removed!==false||lower(l.transactionHash,H)!==r.hash.toLowerCase()||lower(l.blockHash,H)!==r.blockHash.toLowerCase()||u(l.blockNumber)!==r.blockNumber||idx(l.transactionIndex)!==ti||!Array.isArray(l.topics)||l.topics.length===0)return fail();last=index;return {emitter:addr(l.address),topics:l.topics.map(x=>lower(x,H)) as [Hex,...Hex[]],data:lower(l.data,X) as Hex,index};});
}
function exact(l:Log,topics:readonly unknown[],params:string,values:readonly unknown[]){if(digest(l.topics)!==digest(topics)||l.data!==encodeAbiParameters(parseAbiParameters(params),values).toLowerCase())return fail();}
const issued=new WeakMap<object,{key:string;at:number}>();
function key(p:AttemptPreparation,r:CanonicalExecution){const {issuedAt,...stable}=p;void issuedAt;return digest([stable,r]);}
export function isIssuedBusinessOutcome(v:unknown,p:AttemptPreparation,r:CanonicalExecution):v is BusinessOutcome{if(!v||typeof v!=='object')return false;const x=issued.get(v);return !!x&&x.key===key(p,r)&&Date.now()>=x.at&&Date.now()-x.at<=60000;}
export function createBusinessOutcomeVerifier(source:FundingPolicy,readers:readonly[FundingReader,FundingReader]){
 const policy=Object.freeze({...source,factory:addr(source.factory),token:addr(source.token),policyHash:lower(source.policyHash,H),factoryCodeHash:lower(source.factoryCodeHash,H),tokenCodeHash:lower(source.tokenCodeHash,H)});
 if(typeof policy.chainId!=='bigint'||policy.chainId<=0n||readers.length!==2||!readers[0]||!readers[1]||readers[0]===readers[1])return fail();const sources=Object.freeze([...readers]);
 async function verify(input:AttemptPreparation,execution:CanonicalExecution):Promise<BusinessOutcome>{
 const p=Object.freeze({...input,...(input.business?{business:Object.freeze({...input.business})}:{})}),r=Object.freeze({...execution});
 if(!['create-agreement','claim-provider','claim-client-refund'].includes(p.action)||!p.business||p.chainId!==String(policy.chainId)||lower(p.policyHash,H)!==policy.policyHash||p.value!=='0')return fail();const binding=p.business;lower(r.hash,H);lower(r.blockHash,H);u(r.blockNumber);
 const observe=async(rpc:FundingReader)=>{
 const chain=async()=>{const n=await rpc.getChainId();if(typeof n!=='number'||!Number.isSafeInteger(n)||BigInt(n)!==policy.chainId)return fail();};await chain();
 const b=block(await rpc.getBlock({blockNumber:r.blockNumber,includeTransactions:false}),r),logs=logsOf(await rpc.getTransactionReceipt({hash:r.hash as Hex}),p,r,b.txs),creating=p.action==='create-agreement';
 const createdTopic=encodeEventTopics({abi:FACTORY_ABI,eventName:'AgreementCreated'})[0];const created=logs.filter(l=>l.emitter===policy.factory&&l.topics[0]===createdTopic);
 if(creating?(addr(p.target)!==policy.factory||created.length!==1):created.length!==0)return fail();
 const agreement=creating?addr(decodeEventLog({abi:FACTORY_ABI,eventName:'AgreementCreated',topics:created[0]!.topics,data:created[0]!.data,strict:true}).args.agreement):addr(p.target);
 if(agreement===policy.factory||agreement===policy.token)return fail();
 await Promise.all(([[agreement,lower(binding.agreementCodeHash,H)],[policy.factory,policy.factoryCodeHash],[policy.token,policy.tokenCodeHash]] as const).map(async([address,expected])=>{const code=lower(await rpc.getBytecode({address:address as Hex,blockNumber:r.blockNumber}),X);if(code==='0x'||keccak256(code as Hex)!==expected)return fail();}));
 const read=(address:string,abi:Abi,functionName:string,args?:readonly unknown[])=>rpc.readContract({address:address as Hex,abi,functionName,...(args?{args}:{}),blockNumber:r.blockNumber});
 const [rawTerms,rawState,factory,registered,token,fl,tl,decimals,balance]=await Promise.all([read(agreement,AGREEMENT_ABI,'terms'),read(agreement,AGREEMENT_ABI,'accounting'),read(agreement,AGREEMENT_ABI,'factory'),read(policy.factory,FACTORY_ABI,'registeredAgreement',[agreement]),read(policy.factory,FACTORY_ABI,'token'),read(policy.factory,FACTORY_ABI,'perAgreementLiability',[agreement]),read(policy.factory,FACTORY_ABI,'outstandingLiability'),read(policy.token,erc20Abi,'decimals'),read(policy.token,erc20Abi,'balanceOf',[agreement])]);
 if(addr(factory)!==policy.factory||registered!==true||addr(token)!==policy.token||decimals!==6)return fail();const {terms,values}=termsOf(rawTerms,binding,policy),state=stateOf(rawState,terms,b.time),bal=u(balance);if(u(fl)!==state.L||u(tl)<state.L||bal<state.L)return fail();
 const base:Base={agreement,factory:policy.factory,client:terms.client,provider:terms.provider,token:terms.token,termsHash:binding.termsHash.toLowerCase(),noticeReserve:String(state.R),observedRegularFunded:String(state.F),observedRegularPaid:String(state.RP),observedNoticePaid:String(state.NP),observedClientRefunded:String(state.CR),observedLiability:String(state.L),observedBalance:String(bal)};
 let outcome:BusinessOutcome;
 if(creating){
  validateTerms(terms,b.time,{allowlistedTokens:new Set([policy.token]),decimals:6});if(terms.client!==addr(p.actor)||b.time>=terms.acceptanceDeadline)return fail();
  const call=decodeFunctionData({abi:FACTORY_ABI,data:lower(p.data,X) as Hex});if(call.functionName!=='createAgreement')return fail();
  if(encodeFunctionData({abi:FACTORY_ABI,functionName:'createAgreement',args:[{...terms,client:terms.client as Hex,provider:terms.provider as Hex,token:terms.token as Hex,termsDocumentHash:terms.termsDocumentHash as Hex},call.args[1]]}).toLowerCase()!==p.data.toLowerCase())return fail();
  const types={AgreementTerms:[{name:'schemaVersion',type:'uint32'},{name:'client',type:'address'},{name:'provider',type:'address'},{name:'token',type:'address'},{name:'amountPerPeriod',type:'uint256'},{name:'periodSeconds',type:'uint64'},{name:'noticeSeconds',type:'uint64'},{name:'startAt',type:'uint64'},{name:'clientNonce',type:'uint256'},{name:'acceptanceDeadline',type:'uint64'},{name:'termsDocumentHash',type:'bytes32'}]};
  const td=hashTypedData({domain:{name:'NoticeVaultAgreement',version:'1',chainId:policy.chainId,verifyingContract:policy.factory as Hex},types,primaryType:'AgreementTerms',message:{...terms}});
  const [nonceUnavailable,observedDigest]=await Promise.all([read(policy.factory,FACTORY_ABI,'isNonceUnavailable',[terms.client,terms.clientNonce]),read(policy.factory,FACTORY_ABI,'termsDigest',values)]);
  if(nonceUnavailable!==true||lower(observedDigest,H)!==td||lower(binding.termsDigest,H)!==td)return fail();
  const deposit=u(terms.amountPerPeriod+state.R);let transfer=-1,creation=-1,capacity=-1,approval=-1;
  for(const l of logs){
   if(l.emitter===policy.factory){const e=decodeEventLog({abi:FACTORY_ABI,topics:l.topics,data:l.data,strict:true});
    if(e.eventName==='AgreementCreated'){if(creation>=0)return fail();const a=e.args;if(addr(a.agreement)!==agreement||addr(a.client)!==terms.client||addr(a.provider)!==terms.provider||a.amountPerPeriod!==terms.amountPerPeriod||a.periodSeconds!==terms.periodSeconds||a.noticeSeconds!==terms.noticeSeconds||a.startAt!==terms.startAt||a.noticeReserve!==state.R||a.initialFunded!==terms.amountPerPeriod)return fail();exact(l,encodeEventTopics({abi:FACTORY_ABI,eventName:'AgreementCreated',args:{agreement:agreement as Hex,client:terms.client as Hex,provider:terms.provider as Hex}}),'uint256,uint64,uint64,uint64,uint256,uint256',[terms.amountPerPeriod,terms.periodSeconds,terms.noticeSeconds,terms.startAt,state.R,terms.amountPerPeriod]);creation=l.index;
    }else if(e.eventName==='CapacityChanged'){const a=e.args;if(capacity>=0||addr(a.agreement)!==agreement||a.delta!==deposit||a.newAgreementL!==deposit||u(a.newFactoryL)<deposit)return fail();exact(l,encodeEventTopics({abi:FACTORY_ABI,eventName:'CapacityChanged',args:{agreement:agreement as Hex}}),'int256,uint256,uint256',[deposit,deposit,a.newFactoryL]);capacity=l.index;}else return fail();
   }else if(l.emitter===policy.token){const e=decodeEventLog({abi:erc20Abi,topics:l.topics,data:l.data,strict:true});
    if(e.eventName==='Transfer'){if(transfer>=0||addr(e.args.from)!==terms.client||addr(e.args.to)!==agreement||e.args.value!==deposit)return fail();exact(l,encodeEventTopics({abi:erc20Abi,eventName:'Transfer',args:{from:terms.client as Hex,to:agreement as Hex}}),'uint256',[deposit]);transfer=l.index;
    }else if(e.eventName==='Approval'){if(approval>=0||addr(e.args.owner)!==terms.client||addr(e.args.spender)!==policy.factory)return fail();exact(l,encodeEventTopics({abi:erc20Abi,eventName:'Approval',args:{owner:terms.client as Hex,spender:policy.factory as Hex}}),'uint256',[u(e.args.value)]);approval=l.index;}else return fail();
   }else return fail();
  }
  if(transfer<0||creation<=transfer||capacity<=creation||(approval>=0&&approval>=transfer))return fail();
  outcome={...base,kind:'STATE_CHANGED',action:'create-agreement',initialRegular:String(terms.amountPerPeriod),noticeReserve:String(state.R),depositedAmount:String(deposit),clientNonce:String(terms.clientNonce),termsDigest:td};
 }else{
  const providerClaim=p.action==='claim-provider',action=providerClaim?'claim-provider' as const:'claim-client-refund' as const,recipient=providerClaim?terms.provider:terms.client;
  if(p.data.toLowerCase()!==encodeFunctionData({abi:AGREEMENT_ABI,functionName:providerClaim?'claimProvider':'claimClientRefund'}).toLowerCase())return fail();
  let transfer=-1,payout=-1,capacity=-1,notice=-1,amount=0n,regular=0n,noticeAmount=0n,transferAmount=0n,release=0n,releasedL=0n;
  for(const l of logs){
   if(l.emitter===agreement){const e=decodeEventLog({abi:AGREEMENT_ABI,topics:l.topics,data:l.data,strict:true});
    if(e.eventName==='NoticeStarted'){const D=computeD(terms,state.F);if(!providerClaim||notice>=0||e.args.S!==D||e.args.reason!==2||b.time<D||state.state.noticeStartStored!==D||state.state.noticeReasonStored!=='MISSED_CHECKPOINT')return fail();exact(l,encodeEventTopics({abi:AGREEMENT_ABI,eventName:'NoticeStarted'}),'uint64,uint8',[D,2]);notice=l.index;
    }else if(e.eventName==='ProviderClaimed'&&providerClaim){if(payout>=0)return fail();regular=u(e.args.regularDelta);noticeAmount=u(e.args.noticeDelta);amount=u(regular+noticeAmount);if(e.args.total!==amount||regular>state.RP||noticeAmount>state.NP)return fail();exact(l,encodeEventTopics({abi:AGREEMENT_ABI,eventName:'ProviderClaimed'}),'uint256,uint256,uint256',[regular,noticeAmount,amount]);payout=l.index;
    }else if(e.eventName==='ClientRefunded'&&!providerClaim){if(payout>=0)return fail();amount=u(e.args.amount);regular=amount;if(amount>state.CR)return fail();exact(l,encodeEventTopics({abi:AGREEMENT_ABI,eventName:'ClientRefunded'}),'uint256',[amount]);payout=l.index;}else return fail();
   }else if(l.emitter===policy.token){const e=decodeEventLog({abi:erc20Abi,eventName:'Transfer',topics:l.topics,data:l.data,strict:true});if(transfer>=0||addr(e.args.from)!==agreement||addr(e.args.to)!==recipient)return fail();transferAmount=u(e.args.value);exact(l,encodeEventTopics({abi:erc20Abi,eventName:'Transfer',args:{from:agreement as Hex,to:recipient as Hex}}),'uint256',[transferAmount]);transfer=l.index;
   }else if(l.emitter===policy.factory){const e=decodeEventLog({abi:FACTORY_ABI,eventName:'CapacityChanged',topics:l.topics,data:l.data,strict:true}),a=e.args;if(capacity>=0||addr(a.agreement)!==agreement||typeof a.delta!=='bigint'||a.delta>=0n)return fail();release=u(-a.delta);releasedL=u(a.newAgreementL);if(u(a.newFactoryL)<releasedL)return fail();exact(l,encodeEventTopics({abi:FACTORY_ABI,eventName:'CapacityChanged',args:{agreement:agreement as Hex}}),'int256,uint256,uint256',[a.delta,releasedL,a.newFactoryL]);capacity=l.index;
   }else return fail();
  }
  if(payout<0){if(transfer>=0||capacity>=0||logs.length>(notice>=0?1:0))return fail();}
  else if(amount===0n||transferAmount!==amount||release!==amount||releasedL+amount>state.F+state.R||capacity<0||transfer<=capacity||payout<=transfer||(notice>=0&&notice>=capacity))return fail();
  outcome={...base,kind:payout>=0?'TRANSFER':'NO_CHANGE',action,recipient,amount:String(amount),regularAmount:String(regular),noticeAmount:String(noticeAmount),noticeMaterialized:notice>=0};
 }
 await chain();return {outcome,logs,time:String(b.time),terms:rawTerms,state:rawState,factoryL:fl,totalL:tl,transactions:b.txs};
 };
 const observations=await Promise.all(sources.map(async rpc=>{const a=await observe(rpc),b=await observe(rpc);if(digest(a)!==digest(b))return fail();return a;}));if(digest(observations[0])!==digest(observations[1]))return fail();const outcome=Object.freeze(observations[0]!.outcome);issued.set(outcome,{key:key(p,r),at:Date.now()});return outcome;
 }
 return async(p:AttemptPreparation,r:CanonicalExecution)=>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([verify(p,r),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('EVIDENCE_UNAVAILABLE: business verification deadline exceeded')),5000);})]);}finally{if(timer!==undefined)clearTimeout(timer);}};
}
