/** Read-only RPC normalization. This module creates no client, endpoint or live-mode gate.
 * Candidate lookup is a hint, never proof. No candidate means unresolved uncertainty.
 * Canonical consistency is relative to the injected trusted reader, not a finality proof.
 */
import {TransactionNotFoundError,TransactionReceiptNotFoundError} from 'viem';
import type {Hex} from 'viem';
import type {SyntheticAttemptAdapter} from './attempt-evidence.js';
export interface CanonicalAttemptReader {
 getChainId():Promise<unknown>;
 getTransaction(args:{hash:Hex}):Promise<unknown>;
 getTransactionReceipt(args:{hash:Hex}):Promise<unknown>;
 getBlock(args:{blockNumber:bigint;includeTransactions:false}):Promise<unknown>;
}
export type CandidateLocator=(query:Readonly<{chainId:bigint;account:string;nonce:bigint}>)=>Promise<string|null>;
type Rpc=SyntheticAttemptAdapter['rpc'];
type Tx=NonNullable<Awaited<ReturnType<Rpc['findTransaction']>>>;
function invalid():never{throw new Error('Invalid or inconsistent canonical transaction evidence');}
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))return invalid();return v as Record<string,unknown>;}
function hex(v:unknown,pattern:RegExp):string{if(typeof v!=='string'||!pattern.test(v))return invalid();return v.toLowerCase();}
const hash=(v:unknown)=>hex(v,/^0x[0-9a-f]{64}$/i);
const address=(v:unknown)=>hex(v,/^0x[0-9a-f]{40}$/i);
function integer(v:unknown):bigint{if(typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)return BigInt(v);if(typeof v==='bigint'&&v>=0n)return v;return invalid();}
function big(v:unknown):bigint{if(typeof v!=='bigint'||v<0n)return invalid();return v;}
function chain(v:unknown):bigint{const n=integer(v);if(n===0n)return invalid();return n;}
function transaction(v:unknown):Tx{const t=object(v);return Object.freeze({hash:hash(t.hash),chainId:chain(t.chainId),from:address(t.from),to:address(t.to),nonce:integer(t.nonce),input:hex(t.input,/^0x(?:[0-9a-f]{2})*$/i),value:big(t.value)});}
function sameTx(a:Tx,b:Tx):boolean{return (Object.keys(a) as (keyof Tx)[]).every(k=>a[k]===b[k]);}
function placement(v:Record<string,unknown>){return {blockNumber:big(v.blockNumber),blockHash:hash(v.blockHash),transactionIndex:integer(v.transactionIndex)};}
function receipt(v:unknown){const r=object(v);if(r.status!=='success'&&r.status!=='reverted')return invalid();return {...placement(r),hash:hash(r.transactionHash),from:address(r.from),to:address(r.to),status:r.status==='success'?'confirmed':'reverted'};}
function sameReceipt(a:ReturnType<typeof receipt>,b:ReturnType<typeof receipt>){return (Object.keys(a) as (keyof typeof a)[]).every(k=>a[k]===b[k]);}
export function createCanonicalAttemptRpc(reader:CanonicalAttemptReader,locate:CandidateLocator):Rpc{
 // Only an immutable read witness, never durable attempt state. Eviction fails closed.
 const observed=new Map<string,Tx>();
 async function getBlock(n:bigint){
  big(n);const b=object(await reader.getBlock({blockNumber:n,includeTransactions:false}));
  if(big(b.number)!==n||!Array.isArray(b.transactions))return invalid();
  const transactions=b.transactions.map(hash);if(new Set(transactions).size!==transactions.length)return invalid();
  return Object.freeze({number:n,hash:hash(b.hash),transactions:Object.freeze(transactions)});
 }
 return {
  async getChainId(){return chain(await reader.getChainId());},
  async findTransaction(p){
   const candidate=await locate(Object.freeze({chainId:chain(BigInt(p.chainId)),account:address(p.actor),nonce:integer(BigInt(p.networkNonce))}));
   if(candidate===null)return null;const key=hash(candidate);
   let raw:unknown;try{raw=await reader.getTransaction({hash:key as Hex});}catch(e){if(e instanceof TransactionNotFoundError)return null;throw e;}
   const tx=transaction(raw);if(tx.hash!==key)return invalid();
   const old=observed.get(key);if(old&&!sameTx(old,tx))return invalid();
   observed.set(key,tx);if(observed.size>128)observed.delete(observed.keys().next().value!);
   return tx;
  },
  async getReceipt(candidate){
   const key=hash(candidate),original=observed.get(key);if(!original)return invalid();
   let raw:unknown;try{raw=await reader.getTransactionReceipt({hash:key as Hex});}catch(e){if(e instanceof TransactionReceiptNotFoundError)return null;throw e;}
   const r=receipt(raw);if(r.hash!==key||r.from!==original.from||r.to!==original.to)return invalid();
   const txRaw=object(await reader.getTransaction({hash:key as Hex}));
   if(!sameTx(original,transaction(txRaw)))return invalid();
   const t=placement(txRaw);if(t.blockNumber!==r.blockNumber||t.blockHash!==r.blockHash||t.transactionIndex!==r.transactionIndex)return invalid();
   const b=await getBlock(r.blockNumber);
   if(b.hash!==r.blockHash||r.transactionIndex>=BigInt(b.transactions.length)||b.transactions[Number(r.transactionIndex)]!==key)return invalid();
   const again=receipt(await reader.getTransactionReceipt({hash:key as Hex}));if(!sameReceipt(r,again))return invalid();
   if(chain(await reader.getChainId())!==original.chainId)return invalid();
   return Object.freeze({hash:key,status:r.status,blockNumber:r.blockNumber,blockHash:r.blockHash});
  },getBlock,
 };
}
