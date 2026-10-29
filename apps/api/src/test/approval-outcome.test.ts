import {describe,it,expect,vi} from 'vitest';
import {encodeFunctionData,encodeEventTopics,encodeAbiParameters,erc20Abi,keccak256} from 'viem';
import type {Hex} from 'viem';
import {createApprovalOutcomeVerifier} from '../approval-outcome.js';
import {reconcileCanonical} from '../attempt-evidence.js';
import type {AttemptPreparation,SyntheticAttemptAdapter} from '../attempt-evidence.js';
const A=('0x'+'1'.repeat(40)) as Hex,T=('0x'+'2'.repeat(40)) as Hex,S=('0x'+'3'.repeat(40)) as Hex,H=('0x'+'a'.repeat(64)) as Hex,B=('0x'+'b'.repeat(64)) as Hex,P=('0x'+'c'.repeat(64)) as Hex,C='0x6000' as Hex;
function fixture(){
 const data=encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[S,100n]});
 const p:AttemptPreparation={source:'SYNTHETIC',workspaceId:'w',actor:A,chainId:'31337',resource:'agreement:test',action:'approve-renewal',policyHash:P,cycleKey:'1',networkNonce:'7',target:T,data,value:'0',issuedAt:Date.now(),approval:{spender:S,amount:'100'}};
 const log={address:T,topics:encodeEventTopics({abi:erc20Abi,eventName:'Approval',args:{owner:A,spender:S}}),data:encodeAbiParameters([{type:'uint256'}],[100n]),transactionHash:H,blockHash:B,blockNumber:5n,transactionIndex:0,logIndex:0,removed:false};
 const receipt={transactionHash:H,from:A,to:T,status:'success',blockNumber:5n,blockHash:B,transactionIndex:0,logs:[log]};
 const block={number:5n,hash:B,timestamp:BigInt(Math.floor(Date.now()/1000)),transactions:[H]};
 const reader=()=>({getChainId:vi.fn(async()=>31337),getTransactionReceipt:vi.fn(async()=>structuredClone(receipt)),getBytecode:vi.fn(async()=>C),getBlock:vi.fn(async()=>structuredClone(block)),readContract:vi.fn(async()=>100n)});
 const a=reader(),b=reader();const verify=createApprovalOutcomeVerifier({chainId:31337n,token:T,tokenCodeHash:keccak256(C),policyHash:P},[a,b]);
 const adapter:SyntheticAttemptAdapter={source:'SYNTHETIC',prepare:async()=>p,verifyApproval:verify,rpc:{getChainId:async()=>31337n,findTransaction:async()=>({hash:H,chainId:31337n,from:A,to:T,nonce:7n,input:data,value:0n}),getReceipt:async()=>({hash:H,status:'confirmed',blockNumber:5n,blockHash:B}),getBlock:async()=>({number:5n,hash:B,transactions:[H]})}};
 return {p,log,receipt,block,a,b,adapter,run:()=>reconcileCanonical(adapter,p)};
}
describe('durable approval outcome',()=>{
 it('bounds approval reads without retry or resolution',async()=>{vi.useFakeTimers();try{const f=fixture();f.b.readContract.mockImplementation(()=>new Promise(()=>{}));const result=expect(f.run()).rejects.toThrow('EVIDENCE_UNAVAILABLE');await vi.advanceTimersByTimeAsync(5001);await result;expect(f.b.readContract).toHaveBeenCalledTimes(1);}finally{vi.useRealTimers();}});
 it('rejects receipt changes during allowance reads',async()=>{const f=fixture();const raw=structuredClone(f.receipt);f.a.getTransactionReceipt.mockResolvedValueOnce(raw).mockImplementation(async()=>({...raw,logs:[]}));await expect(f.run()).rejects.toThrow();});
 it('rejects later token code changes',async()=>{const f=fixture();f.a.getBytecode.mockResolvedValueOnce(C).mockResolvedValue('0x6001');await expect(f.run()).rejects.toThrow();});
 it('rejects preparation mutation during provider work',async()=>{const f=fixture();f.a.readContract.mockImplementation(async()=>{f.p.resource='agreement:changed';return 100n;});await expect(f.run()).rejects.toThrow('Unissued or mismatched');});
 it('requires event evidence and pinned fresh allowance; never funding success',async()=>{const f=fixture();const r=await f.run();expect(r.state).toBe('confirmed');expect(r.proof?.outcome).toMatchObject({kind:'ALLOWANCE_CHANGED',owner:A,spender:S,approvedAmount:'100',currentAllowance:'100'});expect(f.a.readContract).toHaveBeenCalledWith(expect.objectContaining({address:T,functionName:'allowance',args:[A,S],blockNumber:5n}));});
 it('records subsequently consumed allowance without pretending current funding is available',async()=>{const f=fixture();f.a.readContract.mockResolvedValue(0n);f.b.readContract.mockResolvedValue(0n);const outcome=(await f.run()).proof?.outcome;expect(outcome?.kind==='ALLOWANCE_CHANGED'?outcome.currentAllowance:undefined).toBe('0');});
 it('keeps an approval with no trusted verifier unresolved',async()=>{const f=fixture();delete f.adapter.verifyApproval;expect((await f.run()).state).toBe('unknown');});
 it('keeps legacy approval without bound approval identity unresolved',async()=>{const f=fixture();delete f.p.approval;expect((await f.run()).state).toBe('unknown');});
 it('rejects fabricated verifier result',async()=>{const f=fixture();f.adapter.verifyApproval=async()=>({kind:'ALLOWANCE_CHANGED'} as never);await expect(f.run()).rejects.toThrow();});
 it.each(['missing','amount','spender','owner','emitter','tx','block','removed','duplicate'])('rejects invalid Approval evidence: %s',async kind=>{const f=fixture();if(kind==='missing')f.receipt.logs=[];if(kind==='amount')f.log.data=encodeAbiParameters([{type:'uint256'}],[101n]);if(kind==='spender')f.log.topics=encodeEventTopics({abi:erc20Abi,eventName:'Approval',args:{owner:A,spender:T}});if(kind==='owner')f.log.topics=encodeEventTopics({abi:erc20Abi,eventName:'Approval',args:{owner:S,spender:S}});if(kind==='emitter')f.log.address=S;if(kind==='tx')f.log.transactionHash=P;if(kind==='block')f.log.blockHash=P;if(kind==='removed')f.log.removed=true;if(kind==='duplicate')f.receipt.logs.push({...f.log});await expect(f.run()).rejects.toThrow();});
 it('rejects token code mismatch',async()=>{const f=fixture();f.b.getBytecode.mockResolvedValue('0x6001');await expect(f.run()).rejects.toThrow();});
 it('rejects independent allowance disagreement',async()=>{const f=fixture();f.b.readContract.mockResolvedValue(99n);await expect(f.run()).rejects.toThrow();});
 it('rejects stale allowance observation',async()=>{const f=fixture();f.block.timestamp-=7201n;await expect(f.run()).rejects.toThrow();});
 it('rejects wrong chain or policy',async()=>{const f=fixture();f.p.policyHash=H;await expect(f.run()).rejects.toThrow();});
 it('rejects calldata differing from trusted approval identity',async()=>{const f=fixture();f.p.approval={spender:S,amount:'101'};await expect(f.run()).rejects.toThrow();});
 it('does not request action proof for reverted execution',async()=>{const f=fixture();f.adapter.rpc.getReceipt=async()=>({hash:H,status:'reverted',blockNumber:5n,blockHash:B});const verify=vi.spyOn(f.adapter,'verifyApproval');expect((await f.run()).state).toBe('reverted');expect(verify).not.toHaveBeenCalled();});
});
