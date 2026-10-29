import {fundingFixture} from './funding-fixture.js';
import {describe,it,expect,vi} from 'vitest';
import {TransactionNotFoundError,TransactionReceiptNotFoundError} from 'viem';
import type {Hex} from 'viem';
import {createCanonicalAttemptRpc} from '../canonical-attempt-rpc.js';
import {reconcileCanonical} from '../attempt-evidence.js';
import type {AttemptPreparation} from '../attempt-evidence.js';
const H=('0x'+'a'.repeat(64)) as Hex,B=('0x'+'b'.repeat(64)) as Hex,O=('0x'+'c'.repeat(64)) as Hex;
const A='0x'+'1'.repeat(40),T='0x'+'9'.repeat(40);
function fixture(){
 const p:AttemptPreparation={source:'SYNTHETIC',workspaceId:'w',actor:A,chainId:'31337',resource:'agreement:test',action:'fund-renewal',policyHash:O,cycleKey:'1',networkNonce:'7',target:T,data:fundingFixture(31337).p.data,value:'0',issuedAt:Date.now(),funding:fundingFixture(31337).p.funding!};
 const tx={hash:H,chainId:31337,from:A,to:T,nonce:7,input:p.data,value:0n,blockNumber:5n,blockHash:B,transactionIndex:0};
 const receipt={transactionHash:H,from:A,to:T,status:'success',blockNumber:5n,blockHash:B,transactionIndex:0};
 const block={number:5n,hash:B,transactions:[H]};
 const reader={getChainId:vi.fn(async()=>31337),getTransaction:vi.fn(async()=>structuredClone(tx)),getTransactionReceipt:vi.fn(async()=>structuredClone(receipt)),getBlock:vi.fn(async()=>structuredClone(block))};
 const locate=vi.fn(async(_query:Readonly<{chainId:bigint;account:string;nonce:bigint}>):Promise<string|null>=>{void _query;return H;});const rpc=createCanonicalAttemptRpc(reader,locate);
 return {p,tx,receipt,block,reader,locate,rpc,run:()=>reconcileCanonical({source:'SYNTHETIC',prepare:async()=>p,rpc,verifyFunding:async(p,r)=>{const f=fundingFixture(31337);Object.assign(f.r,r);return f.verify(p,r);}},p)};
}
describe('canonical RPC receipt adapter',()=>{
 it('validates exact identity and stable canonical receipt',async()=>{const f=fixture();expect((await f.run()).state).toBe('confirmed');expect(f.locate).toHaveBeenCalledWith({chainId:31337n,account:A,nonce:7n});expect(Object.isFrozen(f.locate.mock.calls[0]?.[0])).toBe(true);expect(f.reader.getBlock).toHaveBeenCalledWith({blockNumber:5n,includeTransactions:false});expect(f.reader.getTransactionReceipt).toHaveBeenCalledTimes(2);});
 it('maps revert without successful outcome',async()=>{const f=fixture();f.receipt.status='reverted';expect((await f.run()).state).toBe('reverted');});
 it('leaves missing legacy identity unresolved',async()=>{const f=fixture();f.locate.mockResolvedValue(null);expect((await f.run()).state).toBe('unknown');expect(f.reader.getTransaction).not.toHaveBeenCalled();});
 it.each(['from','to','nonce','chainId','input','value'])('rejects mismatched transaction %s',async key=>{const f=fixture();const values={from:T,to:A,nonce:8,chainId:1,input:'0xabcd',value:1n};Object.assign(f.tx,{[key]:values[key as keyof typeof values]});expect((await f.run()).state).toBe('conflicted');});
 it.each([{hash:O},{nonce:-1},{nonce:Number.MAX_SAFE_INTEGER+1},{input:'0x1'},{value:-1n}])('rejects malformed transaction shape',async change=>{const f=fixture();Object.assign(f.tx,change);await expect(f.run()).rejects.toThrow();});
 it.each([{transactionHash:O},{from:T},{to:A},{blockHash:O},{blockNumber:6n},{transactionIndex:1},{status:'unknown'}])('rejects inconsistent receipt shape',async change=>{const f=fixture();Object.assign(f.receipt,change);await expect(f.run()).rejects.toThrow();});
 it.each([{transactions:[H,H]},{transactions:[O]}])('rejects invalid block inclusion',async ({transactions})=>{const f=fixture();f.block.transactions=transactions;await expect(f.run()).rejects.toThrow();});
 it('rejects changed transaction on recheck',async()=>{const f=fixture();f.reader.getTransaction.mockResolvedValueOnce(structuredClone(f.tx)).mockResolvedValue({...f.tx,to:A});await expect(f.run()).rejects.toThrow();});
 it('rejects changed receipt on recheck',async()=>{const f=fixture();f.reader.getTransactionReceipt.mockResolvedValueOnce(structuredClone(f.receipt)).mockResolvedValue({...f.receipt,status:'reverted'});await expect(f.run()).rejects.toThrow();});
 it('recognizes only typed missing receipt',async()=>{const f=fixture();f.reader.getTransactionReceipt.mockRejectedValue(new TransactionReceiptNotFoundError({hash:H}));expect((await f.run()).state).toBe('submitted');f.reader.getTransactionReceipt.mockRejectedValue(new Error('RPC unavailable'));await expect(f.run()).rejects.toThrow('RPC unavailable');});
 it('recognizes only typed missing transaction',async()=>{const f=fixture();f.reader.getTransaction.mockRejectedValue(new TransactionNotFoundError({hash:H}));expect((await f.run()).state).toBe('unknown');f.reader.getTransaction.mockRejectedValue(new Error('timeout'));await expect(f.run()).rejects.toThrow('timeout');});
 it('rejects malformed candidate before RPC read',async()=>{const f=fixture();f.locate.mockResolvedValue('bad');await expect(f.run()).rejects.toThrow();expect(f.reader.getTransaction).not.toHaveBeenCalled();});
 it('does not confirm reorg during canonical recheck',async()=>{const f=fixture();f.reader.getBlock.mockResolvedValueOnce(f.block).mockResolvedValue({...f.block,hash:O});expect((await f.run()).state).toBe('reorged');});
 it('rejects chain switch before receipt resolution',async()=>{const f=fixture();f.reader.getChainId.mockResolvedValueOnce(31337).mockResolvedValue(1);await expect(f.run()).rejects.toThrow();});
 it('requires observed transaction before receipt lookup',async()=>{const f=fixture();await expect(f.rpc.getReceipt(H)).rejects.toThrow();});
});
