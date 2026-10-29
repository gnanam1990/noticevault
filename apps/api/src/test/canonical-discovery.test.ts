import {createDiscoveredArcAttemptRpc} from '../arc-finality.js';
import {describe,it,expect,vi} from 'vitest';
import {createBoundedCandidateLocator} from '../canonical-discovery.js';
const H=(n:number)=>'0x'+n.toString(16).padStart(64,'0');
const A='0x'+'11'.repeat(20),B='0x'+'22'.repeat(20);
function fixture(){
 const tx={hash:H(11),chainId:5042002,from:A,to:B,nonce:7,input:'0x12345678',value:0n,blockNumber:5n,blockHash:H(5),transactionIndex:0};
 const block={number:5n,hash:H(5),parentHash:H(4),transactions:[H(11)]};
 const reader={getChainId:async()=>5042002,getBlock:async()=>({...block}),getTransaction:async()=>({...tx}),getTransactionReceipt:async()=>null};
 return {reader,tx,block,query:{chainId:5042002n,account:A,nonce:7n}};
}
describe('bounded canonical discovery',()=>{
 it('locates exact sender nonce without a client hash',async()=>{const f=fixture();expect(await createBoundedCandidateLocator(f.reader,{fromBlock:5n,toBlock:5n})(f.query)).toBe(H(11));});
 it('missing candidate is unresolved, never negative broadcast proof',async()=>{const f=fixture();f.tx.nonce=8;expect(await createBoundedCandidateLocator(f.reader,{fromBlock:5n,toBlock:5n})(f.query)).toBeNull();});
 for(const field of ['hash','blockHash','blockNumber','transactionIndex','chainId'] as const)it('rejects contradictory '+field,async()=>{const f=fixture();Object.assign(f.tx,{[field]:field==='hash'||field==='blockHash'?H(99):99});await expect(createBoundedCandidateLocator(f.reader,{fromBlock:5n,toBlock:5n})(f.query)).rejects.toThrow();});
 it('rejects omitted transactions',async()=>{const f=fixture();Object.assign(f.block,{transactions:null});await expect(createBoundedCandidateLocator(f.reader,{fromBlock:5n,toBlock:5n})(f.query)).rejects.toThrow();});
 it('rejects duplicate transaction identities',async()=>{const f=fixture();f.block.transactions.push(H(11));await expect(createBoundedCandidateLocator(f.reader,{fromBlock:5n,toBlock:5n})(f.query)).rejects.toThrow();});
 it('rejects reorg during scan',async()=>{const f=fixture();let n=0;f.reader.getBlock=async()=>({...f.block,hash:++n>1?H(99):H(5)});await expect(createBoundedCandidateLocator(f.reader,{fromBlock:5n,toBlock:5n})(f.query)).rejects.toThrow();});
 it('rejects chain changes',async()=>{const f=fixture();let n=0;f.reader.getChainId=async()=>++n>1?1:5042002;await expect(createBoundedCandidateLocator(f.reader,{fromBlock:5n,toBlock:5n})(f.query)).rejects.toThrow();});
 it('rejects unbounded ranges',()=>{const f=fixture();expect(()=>createBoundedCandidateLocator(f.reader,{fromBlock:0n,toBlock:1000n})).toThrow();});
 it('freezes range against caller mutation',async()=>{const f=fixture();const range={fromBlock:5n,toBlock:5n};const locate=createBoundedCandidateLocator(f.reader,range);range.toBlock=99999n;expect(await locate(f.query)).toBe(H(11));});
});

it('composes independent discovery with exact canonical transaction verification',async()=>{
 const a=fixture(),b=fixture();let reads=0;const original=b.reader.getTransaction;b.reader.getTransaction=async()=>{reads++;return original();};
 const rpc=createDiscoveredArcAttemptRpc({network:'ARC_TESTNET',chainId:5042002n,kind:'COMMITTED_INCLUSION',verification:'TWO_PROVIDERS'},{id:'a',reader:a.reader},{id:'b',reader:b.reader},{fromBlock:5n,toBlock:5n});
 const tx=await rpc.findTransaction({source:'SYNTHETIC',workspaceId:'ws',actor:A,chainId:'5042002',resource:'agreement',action:'fund-renewal',policyHash:H(1),cycleKey:'1',networkNonce:'7',target:B,data:'0x12345678',value:'0',issuedAt:Date.now()});
 expect(tx?.hash).toBe(H(11));expect(reads).toBeGreaterThanOrEqual(2);
 b.tx.nonce=8;await expect(rpc.findTransaction({source:'SYNTHETIC',workspaceId:'ws',actor:A,chainId:'5042002',resource:'agreement',action:'fund-renewal',policyHash:H(1),cycleKey:'1',networkNonce:'7',target:B,data:'0x12345678',value:'0',issuedAt:Date.now()})).rejects.toThrow('EVIDENCE_CONFLICT');
});
it('rejects a disconnected branch',async()=>{const f=fixture();f.reader.getBlock=async()=>({...f.block,number:5n});await expect(createBoundedCandidateLocator(f.reader,{fromBlock:5n,toBlock:6n})(f.query)).rejects.toThrow();});
it('bounds provider response size',async()=>{const f=fixture();f.block.transactions=Array.from({length:10001},(_,i)=>H(i+1));await expect(createBoundedCandidateLocator(f.reader,{fromBlock:5n,toBlock:5n})(f.query)).rejects.toThrow();});
it('stops issuing reads after a timed-out provider finally returns',async()=>{
 vi.useFakeTimers();try{const f=fixture();let release!:(v:typeof f.block)=>void;let txReads=0;f.reader.getBlock=()=>new Promise(resolve=>{release=resolve;});f.reader.getTransaction=async()=>{txReads++;return f.tx;};
 const result=createBoundedCandidateLocator(f.reader,{fromBlock:5n,toBlock:5n})(f.query);const assertion=expect(result).rejects.toThrow('deadline');await vi.advanceTimersByTimeAsync(5001);await assertion;release(f.block);await Promise.resolve();await Promise.resolve();expect(txReads).toBe(0);
 }finally{vi.useRealTimers();}
});
