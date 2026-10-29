/** SYNTHETIC ONLY. Stateful historical fake chain; no endpoint or real wallet. */
import {decodeFunctionData,encodeEventTopics,encodeAbiParameters,parseAbiParameters,erc20Abi,type Abi,type Hex} from 'viem';
import {AGREEMENT_ABI,FACTORY_ABI,buildSimulationSnapshot,serializeTerms} from '../../packages/sdk/src/index';
import {operatorFixture} from './operator-approval.fixture';
import type {RuntimeReader} from '../../apps/api/src/configured-runtime';
export async function settlementFixture(options:Parameters<typeof operatorFixture>[0]){
 const f=await operatorFixture(options),dep=f.f.config.deployment,A=('0x'+'8a'.repeat(20)) as Hex,now=BigInt(Math.floor(Date.now()/1000));
 const terms={...f.terms,startAt:now-(process.env.SETTLEMENT_ACTION==='materialize-notice'?5400n:1800n),periodSeconds:3600n,noticeSeconds:3600n};
 type State={funded:bigint;allowance:bigint;nonce:bigint;time:bigint;balance:bigint;notice:boolean;start:bigint;reason:1|2;regularPaid:bigint;noticePaid:bigint;refunded:bigint};
 let head=10n,state:State={funded:terms.amountPerPeriod,allowance:0n,nonce:0n,time:now,balance:100000000n,notice:process.env.SETTLEMENT_ACTION==='claim-client-refund',start:now-900n,reason:1,regularPaid:0n,noticePaid:0n,refunded:0n};
 const states=new Map<bigint,State>([[head,{...state}]]),txs=new Map<string,Record<string,unknown>>(),receipts=new Map<string,Record<string,unknown>>(),blocks=new Map<bigint,string[]>();
 const hash=(n:bigint)=>('0x'+n.toString(16).padStart(64,'0')) as Hex;
 const getState=(n?:bigint)=>states.get(n??head)??state;
 const preview=(s:State)=>buildSimulationSnapshot({terms,regularFunded:s.funded,regularPaid:s.regularPaid,noticePaid:s.noticePaid,clientRefunded:s.refunded,noticeStartStored:s.notice?s.start:null,noticeReasonStored:s.notice?(s.reason===1?'CLIENT_CANCELLED':'MISSED_CHECKPOINT'):null},s.time);
 const reader=(base:RuntimeReader):RuntimeReader=>({...base,getTransactionCount:async()=>Number(state.nonce),getBlockNumber:async()=>head,
  getBlock:async(a:Record<string,unknown>)=>{const n=typeof a.blockNumber==='bigint'?a.blockNumber:head;return {number:n,hash:hash(n),parentHash:hash(n-1n),timestamp:getState(n).time,transactions:blocks.get(n)??[]};},
  getBytecode:async(a:Record<string,unknown>)=>String(a.address).toLowerCase()===A?'0x6002':base.getBytecode(a as never),
  getTransaction:async(a:{hash:Hex})=>txs.get(a.hash)??null,getTransactionReceipt:async(a:{hash:Hex})=>receipts.get(a.hash)??null,
  readContract:async(a:Record<string,unknown>)=>{const s=getState(a.blockNumber as bigint|undefined),name=a.functionName,args=a.args as unknown[]|undefined;
   const R=terms.amountPerPeriod,liability=s.funded+R-s.regularPaid-s.noticePaid-s.refunded;
   if(name==='terms')return Object.values(terms);
   if(name==='accounting')return [s.funded,s.regularPaid,s.noticePaid,s.refunded,R,s.notice,s.notice?s.start:0n,s.notice?s.reason:0,liability];
   if(name==='preview'){const v=preview(s);return {...v,phase:['SCHEDULED','ACTIVE','NOTICE_SCHEDULED','NOTICE','ENDED_CLAIMABLE','CLOSED'].indexOf(v.phase),S:v.S??0n,E:v.E??0n,reason:v.reason==='CLIENT_CANCELLED'?1:v.reason==='MISSED_CHECKPOINT'?2:0,hasStoredNotice:s.notice};}
   if(name==='factory')return dep.factoryAddress;if(name==='registeredAgreement')return true;
   if(name==='perAgreementLiability'||name==='outstandingLiability')return liability;
   if(name==='balanceOf')return String(args?.[0]).toLowerCase()===A?liability:s.balance;
   if(name==='allowance')return s.allowance;return base.readContract(a as never);
  }} as unknown as RuntimeReader);
 const runtime={...f.runtime,primary:{...f.runtime.primary,reader:reader(f.runtime.primary.reader)},verification:{...f.runtime.verification,reader:reader(f.runtime.verification.reader)}};

 function send(tx:Record<string,unknown>){const call=decodeFunctionData({abi:AGREEMENT_ABI,data:tx.data as Hex});if(String(tx.to).toLowerCase()!==A||(call.args?.length??0)!==0)throw Error('FAKE_EXACT_SETTLEMENT');
  const h=hash(1000n+head+1n),logs:Record<string,unknown>[]=[];
  const push=(address:Hex,abi:Abi,eventName:string,params:string,values:readonly unknown[],args:Record<string,unknown>={})=>logs.push({address,topics:encodeEventTopics({abi,eventName,args}),data:encodeAbiParameters(parseAbiParameters(params),values),transactionHash:h,blockHash:hash(head+1n),blockNumber:head+1n,transactionIndex:0,logIndex:logs.length,removed:false});
  const deadline=terms.startAt+(state.funded/terms.amountPerPeriod)*terms.periodSeconds;
  if(call.functionName==='startNotice'||call.functionName==='materializeNotice'){
   if(state.notice)throw Error('FAKE_NOTICE_ALREADY_STORED');const isDefault=state.time>=deadline;state={...state,notice:true,start:isDefault?deadline:state.time>terms.startAt?state.time:terms.startAt,reason:isDefault?2:1};push(A,AGREEMENT_ABI,'NoticeStarted','uint64,uint8',[state.start,state.reason]);
  }else if(call.functionName==='claimProvider'||call.functionName==='claimClientRefund'){
   const provider=call.functionName==='claimProvider',v=preview(state),regular=provider?v.V-state.regularPaid:v.clientRefundable,notice=provider?v.W-state.noticePaid:0n,amount=regular+notice;
   if(provider)state={...state,regularPaid:state.regularPaid+regular,noticePaid:state.noticePaid+notice};else state={...state,refunded:state.refunded+amount};
   if(amount>0n){const L=state.funded+terms.amountPerPeriod-state.regularPaid-state.noticePaid-state.refunded;
    push(dep.factoryAddress! as Hex,FACTORY_ABI,'CapacityChanged','int256,uint256,uint256',[-amount,L,L],{agreement:A});
    push(dep.allowlistedToken! as Hex,erc20Abi,'Transfer','uint256',[amount],{from:A,to:provider?terms.provider:terms.client});
    if(provider)push(A,AGREEMENT_ABI,'ProviderClaimed','uint256,uint256,uint256',[regular,notice,amount]);else push(A,AGREEMENT_ABI,'ClientRefunded','uint256',[amount]);
   }
  }else throw Error('FAKE_UNSUPPORTED_SETTLEMENT');
  const nonce=state.nonce;state={...state,nonce:nonce+1n};head++;states.set(head,{...state});blocks.set(head,[h]);txs.set(h,{...tx,hash:h,chainId:5042002,nonce:Number(nonce),input:tx.data,value:0n,blockNumber:head,blockHash:hash(head),transactionIndex:0});receipts.set(h,{transactionHash:h,from:tx.from,to:tx.to,status:'success',blockNumber:head,blockHash:hash(head),transactionIndex:0,logs,...(logs.length===0?{logsBloom:'0x'+'0'.repeat(512)}:{})});return h;
 }
 return {...f,runtime,terms,A,hash,send,serializedTerms:serializeTerms(terms),state:()=>({...state}),preview:()=>preview(state),noPayment:()=>{const v=preview(state);state=process.env.SETTLEMENT_ACTION==='claim-provider'?{...state,regularPaid:v.V,noticePaid:v.W}:{...state,refunded:state.refunded+v.clientRefundable};head++;states.set(head,{...state});},mutate:(v:Partial<State>)=>{state={...state,...v};head++;states.set(head,{...state});}};
}
