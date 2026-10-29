/** SYNTHETIC ONLY. Stateful historical fake chain; no endpoint or real wallet. */
import {decodeFunctionData,encodeEventTopics,encodeAbiParameters,parseAbiParameters,erc20Abi,type Abi,type Hex} from 'viem';
import {AGREEMENT_ABI,FACTORY_ABI,buildSimulationSnapshot,serializeTerms} from '../../packages/sdk/src/index';
import {operatorFixture} from './operator-approval.fixture';
import type {RuntimeReader} from '../../apps/api/src/configured-runtime';
export async function renewalFixture(options:Parameters<typeof operatorFixture>[0]){
 const f=await operatorFixture(options),dep=f.f.config.deployment,A=('0x'+'8a'.repeat(20)) as Hex,now=BigInt(Math.floor(Date.now()/1000));
 const terms={...f.terms,startAt:now-1800n,periodSeconds:3600n,noticeSeconds:3600n};
 type State={funded:bigint;allowance:bigint;nonce:bigint;time:bigint;balance:bigint;notice:boolean};
 let head=10n,state:State={funded:terms.amountPerPeriod,allowance:0n,nonce:0n,time:now,balance:100000000n,notice:false};
 const states=new Map<bigint,State>([[head,{...state}]]),txs=new Map<string,Record<string,unknown>>(),receipts=new Map<string,Record<string,unknown>>(),blocks=new Map<bigint,string[]>();
 const hash=(n:bigint)=>('0x'+n.toString(16).padStart(64,'0')) as Hex;
 const getState=(n?:bigint)=>states.get(n??head)??state;
 const reader=(base:RuntimeReader):RuntimeReader=>({...base,getTransactionCount:async()=>Number(state.nonce),getBlockNumber:async()=>head,
  getBlock:async(a:Record<string,unknown>)=>{const n=typeof a.blockNumber==='bigint'?a.blockNumber:head;return {number:n,hash:hash(n),parentHash:hash(n-1n),timestamp:getState(n).time,transactions:blocks.get(n)??[]};},
  getBytecode:async(a:Record<string,unknown>)=>String(a.address).toLowerCase()===A?'0x6002':base.getBytecode(a as never),
  getTransaction:async(a:{hash:Hex})=>txs.get(a.hash)??null,getTransactionReceipt:async(a:{hash:Hex})=>receipts.get(a.hash)??null,
  readContract:async(a:Record<string,unknown>)=>{const s=getState(a.blockNumber as bigint|undefined),name=a.functionName,args=a.args as unknown[]|undefined;
   const R=terms.amountPerPeriod,liability=s.funded+R;
   if(name==='terms')return Object.values(terms);
   if(name==='accounting')return [s.funded,0n,0n,0n,R,s.notice,s.notice?s.time:0n,s.notice?1:0,liability];
   if(name==='preview'){const v=buildSimulationSnapshot({terms,regularFunded:s.funded,regularPaid:0n,noticePaid:0n,clientRefunded:0n,noticeStartStored:s.notice?s.time:null,noticeReasonStored:s.notice?'CLIENT_CANCELLED':null},s.time);return {...v,phase:1,S:0n,E:0n,reason:0,hasStoredNotice:false};}
   if(name==='factory')return dep.factoryAddress;if(name==='registeredAgreement')return true;
   if(name==='perAgreementLiability'||name==='outstandingLiability')return liability;
   if(name==='balanceOf')return String(args?.[0]).toLowerCase()===A?liability:s.balance;
   if(name==='allowance')return s.allowance;return base.readContract(a as never);
  }} as unknown as RuntimeReader);
 const runtime={...f.runtime,primary:{...f.runtime.primary,reader:reader(f.runtime.primary.reader)},verification:{...f.runtime.verification,reader:reader(f.runtime.verification.reader)}};
 function send(tx:Record<string,unknown>){const approval=String(tx.to).toLowerCase()===dep.allowlistedToken!.toLowerCase(),call=decodeFunctionData({abi:approval?erc20Abi:AGREEMENT_ABI,data:tx.data as Hex});
  if(approval){if(call.functionName!=='approve'||String(call.args?.[0]).toLowerCase()!==A||BigInt(String(call.args?.[1]))!==terms.amountPerPeriod)throw Error('FAKE_EXACT_APPROVAL');state={...state,allowance:terms.amountPerPeriod};}
  else {if(call.functionName!=='fundNextPeriod'||BigInt(String(call.args?.[0]))!==terms.startAt+(state.funded/terms.amountPerPeriod)*terms.periodSeconds||state.allowance<terms.amountPerPeriod)throw Error('FAKE_EXACT_FUNDING');state={...state,funded:state.funded+terms.amountPerPeriod,allowance:state.allowance-terms.amountPerPeriod,balance:state.balance-terms.amountPerPeriod};}
  const nonce=state.nonce;state={...state,nonce:nonce+1n};head++;states.set(head,{...state});const h=hash(1000n+head),logs:Record<string,unknown>[]=[];
  const push=(address:Hex,abi:Abi,eventName:string,params:string,values:readonly unknown[],args:Record<string,unknown>={})=>logs.push({address,topics:encodeEventTopics({abi,eventName,args}),data:encodeAbiParameters(parseAbiParameters(params),values),transactionHash:h,blockHash:hash(head),blockNumber:head,transactionIndex:0,logIndex:logs.length,removed:false});
  if(approval)push(dep.allowlistedToken! as Hex,erc20Abi,'Approval','uint256',[state.allowance],{owner:terms.client,spender:A});
  else {const L=state.funded+terms.amountPerPeriod;push(dep.factoryAddress! as Hex,FACTORY_ABI,'CapacityChanged','int256,uint256,uint256',[terms.amountPerPeriod,L,L],{agreement:A});push(dep.allowlistedToken! as Hex,erc20Abi,'Transfer','uint256',[terms.amountPerPeriod],{from:terms.client,to:A});push(A,AGREEMENT_ABI,'RegularFunded','uint256,uint64,uint256',[state.funded,terms.startAt+(state.funded/terms.amountPerPeriod)*terms.periodSeconds,terms.amountPerPeriod]);}
  blocks.set(head,[h]);txs.set(h,{...tx,hash:h,chainId:5042002,nonce:Number(nonce),input:tx.data,value:0n,blockNumber:head,blockHash:hash(head),transactionIndex:0});receipts.set(h,{transactionHash:h,from:terms.client,to:tx.to,status:'success',blockNumber:head,blockHash:hash(head),transactionIndex:0,logs});return h;
 }
 return {...f,runtime,terms,A,hash,send,serializedTerms:serializeTerms(terms),state:()=>({...state}),mutate:(v:Partial<State>)=>{state={...state,...v};head++;states.set(head,{...state});}};
}
