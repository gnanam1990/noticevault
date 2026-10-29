import {describe,it,expect} from 'vitest';
import {encodeFunctionData,encodeEventTopics,encodeAbiParameters,parseAbiParameters,keccak256} from 'viem';
import type {Hex} from 'viem';
import {AGREEMENT_ABI} from '@noticevault/sdk';
import {createNoticeOutcomeVerifier,isIssuedNoticeOutcome} from '../notice-outcome.js';
import type {NoticeReader} from '../notice-outcome.js';
import {reconcileCanonical} from '../attempt-evidence.js';
import type {AttemptPreparation,SyntheticAttemptAdapter} from '../attempt-evidence.js';
const C=('0x'+'1'.repeat(40)) as Hex,P=('0x'+'2'.repeat(40)) as Hex,T=('0x'+'3'.repeat(40)) as Hex,A=('0x'+'4'.repeat(40)) as Hex,F=('0x'+'5'.repeat(40)) as Hex,H=('0x'+'a'.repeat(64)) as Hex,B=('0x'+'b'.repeat(64)) as Hex,D=('0x'+'c'.repeat(64)) as Hex,code='0x6000' as Hex;
const terms=[1,C,P,T,100n,100n,50n,100n,0n,99n,D] as const;
const termsHash=keccak256(encodeAbiParameters(parseAbiParameters('uint32,address,address,address,uint256,uint64,uint64,uint64,uint256,uint64,bytes32'),terms));
function setup(){
 const p:AttemptPreparation={source:'SYNTHETIC',workspaceId:'w',actor:C,chainId:'31337',resource:'agreement:'+A,action:'materialize-notice',policyHash:D,cycleKey:'notice',networkNonce:'1',target:A,data:encodeFunctionData({abi:AGREEMENT_ABI,functionName:'materializeNotice'}),value:'0',issuedAt:Date.now(),notice:{termsHash,agreementCodeHash:keccak256(code),regularFunded:'100',fundedThrough:'200'}};
 const r={hash:H,blockNumber:10n,blockHash:B};
 const state={time:200n,start:200n,reason:2,logs:true,accounting:[100n,0n,0n,0n,50n,true,200n,2,150n] as unknown[],terms:[...terms] as unknown[],code,chain:31337,factory:F,emitter:A,hash:H,block:B};
 const receipt=()=>({transactionHash:H,blockHash:B,blockNumber:10n,transactionIndex:0,from:p.actor,to:A,status:'success',logsBloom:'0x'+(state.logs?'1':'0').repeat(512),logs:state.logs?[{address:state.emitter,topics:encodeEventTopics({abi:AGREEMENT_ABI,eventName:'NoticeStarted'}),data:encodeAbiParameters(parseAbiParameters('uint64,uint8'),[state.start,state.reason]),transactionHash:state.hash,blockHash:state.block,blockNumber:10n,transactionIndex:0,logIndex:0,removed:false}]:[]});
 const reader=():NoticeReader=>({getChainId:async()=>state.chain,getTransactionReceipt:async()=>receipt(),getBytecode:async()=>state.code,getBlock:async()=>({number:10n,hash:B,timestamp:state.time,transactions:[H]}),readContract:async a=>a.functionName==='terms'?state.terms:a.functionName==='accounting'?state.accounting:state.factory});
 const a=reader(),b=reader(),verify=createNoticeOutcomeVerifier({chainId:31337n,factory:F,token:T,policyHash:D},[a,b]);
 const adapter:SyntheticAttemptAdapter={source:'SYNTHETIC',prepare:async()=>p,verifyNotice:verify,rpc:{getChainId:async()=>31337n,findTransaction:async()=>({hash:H,chainId:31337n,from:p.actor,to:A,nonce:1n,input:p.data,value:0n}),getReceipt:async()=>({hash:H,status:'confirmed',blockNumber:10n,blockHash:B}),getBlock:async()=>({number:10n,hash:B,transactions:[H]})}};
 return {p,r,state,a,b,verify,adapter};
}
describe('materialize-notice outcome',()=>{
 it('confirms exact default notice state through durable reconciler',async()=>{const x=setup();const r=await reconcileCanonical(x.adapter,x.p);expect(r.state).toBe('confirmed');expect(r.proof?.outcome).toMatchObject({kind:'STATE_CHANGED',action:'materialize-notice',noticeStart:'200',noticeEnd:'250',reason:'MISSED_CHECKPOINT'});});
 it('permits a different authenticated caller without changing beneficiaries',async()=>{const x=setup();x.p.actor=P;expect((await x.verify(x.p,x.r)).client).toBe(C);});
 it('accepts verified no-event no-op with previously stored default notice',async()=>{const x=setup();x.state.logs=false;expect((await x.verify(x.p,x.r)).kind).toBe('NO_CHANGE');});
 it('accepts no-op preserving an earlier cancellation instead of rederiving default',async()=>{const x=setup();x.state.logs=false;x.state.accounting[6]=150n;x.state.accounting[7]=1;const o=await x.verify(x.p,x.r);expect(o).toMatchObject({kind:'NO_CHANGE',noticeStart:'150',noticeEnd:'200',reason:'CLIENT_CANCELLED'});});
 it('preserves future scheduled cancellation on a no-op before start',async()=>{const x=setup();x.state.time=90n;x.state.logs=false;x.state.accounting[6]=100n;x.state.accounting[7]=1;expect((await x.verify(x.p,x.r)).kind).toBe('NO_CHANGE');});
 it('no verifier cannot release a legacy unknown attempt',async()=>{const x=setup();delete x.adapter.verifyNotice;expect((await reconcileCanonical(x.adapter,x.p)).state).toBe('unknown');});
 it('requires trusted binding even for a success receipt',async()=>{const x=setup();delete x.p.notice;expect((await reconcileCanonical(x.adapter,x.p)).state).toBe('unknown');});
 for(const [name,mutate] of Object.entries({beforeCheckpoint:(x:ReturnType<typeof setup>)=>{x.state.time=199n;},cancelEvent:(x:ReturnType<typeof setup>)=>{x.state.reason=1;x.state.accounting[7]=1;},wrongDefaultStart:(x:ReturnType<typeof setup>)=>{x.state.start=199n;x.state.accounting[6]=199n;},absentStoredState:(x:ReturnType<typeof setup>)=>{x.state.logs=false;x.state.accounting[5]=false;},absentWrongReason:(x:ReturnType<typeof setup>)=>{x.state.logs=false;x.state.accounting[7]=0;},futureDefault:(x:ReturnType<typeof setup>)=>{x.state.logs=false;x.state.time=199n;},wrongDefaultState:(x:ReturnType<typeof setup>)=>{x.state.logs=false;x.state.accounting[6]=201n;},impossibleCancellation:(x:ReturnType<typeof setup>)=>{x.state.logs=false;x.state.accounting[6]=201n;x.state.accounting[7]=1;},wrongCall:(x:ReturnType<typeof setup>)=>{x.p.data=encodeFunctionData({abi:AGREEMENT_ABI,functionName:'startNotice'});}}))it('rejects '+name,async()=>{const x=setup();mutate(x);await expect(x.verify(x.p,x.r)).rejects.toThrow();});
 it('rejects public fabricated no-op proof',async()=>{const x=setup();expect(isIssuedNoticeOutcome({kind:'NO_CHANGE'},x.p,x.r)).toBe(false);x.adapter.verifyNotice=async()=>({kind:'NO_CHANGE'} as never);await expect(reconcileCanonical(x.adapter,x.p)).rejects.toThrow();});
 for(const bloom of [undefined,'0x','0x'+'1'.repeat(512)])it('rejects empty logs with missing or contradictory bloom '+String(bloom).slice(0,8),async()=>{const x=setup();x.state.logs=false;const original=x.a.getTransactionReceipt;x.a.getTransactionReceipt=async a=>({...await original(a) as Record<string,unknown>,logsBloom:bloom});await expect(x.verify(x.p,x.r)).rejects.toThrow();});
});
