import type {Attempt} from './transaction-review.js';
export type TerminalRpc={source:'SYNTHETIC';getChainId():Promise<bigint>;getTransaction(hash:string):Promise<{hash:string;chainId:bigint;from:string;to:string;input:string;value:bigint}>;getReceipt(hash:string):Promise<{hash:string;status:string;blockNumber:bigint;blockHash:string}>;getBlock(number:bigint):Promise<{number:bigint;hash:string;transactions:readonly string[]}>};
export type TerminalProof=Readonly<{observedAt:number}>;
const issued=new WeakMap<object,string>();
const hex=/^0x[0-9a-f]{64}$/i;
function check(value:unknown):asserts value{if(!value)throw new Error('Canonical terminal evidence unavailable or mismatched');}
function binding(a:Attempt){return JSON.stringify(a);}
/** Explicit deterministic test construction. No network transport or production fallback. */
export async function verifySyntheticTerminal(rpc:TerminalRpc,a:Attempt):Promise<TerminalProof>{
 const r=a.request;check(rpc.source==='SYNTHETIC'&&r&&a.hash&&hex.test(a.hash)&&['confirmed','reverted'].includes(a.status));
 check(r.chainId===a.chainId&&r.scopeKey&&r.cycleKey&&r.key===a.key);
 const chain=await rpc.getChainId(),tx=await rpc.getTransaction(a.hash),receipt=await rpc.getReceipt(a.hash);
 check(chain===BigInt(a.chainId)&&tx.chainId===chain&&tx.hash.toLowerCase()===a.hash.toLowerCase()&&tx.from.toLowerCase()===r.account.toLowerCase()&&tx.to.toLowerCase()===r.target.toLowerCase()&&tx.input.toLowerCase()===r.data.toLowerCase()&&tx.value===0n);
 check(receipt.hash.toLowerCase()===a.hash.toLowerCase()&&receipt.status===a.status&&typeof receipt.blockNumber==='bigint'&&receipt.blockNumber>=0n&&hex.test(receipt.blockHash));
 for(let i=0;i<2;i++){const b=await rpc.getBlock(receipt.blockNumber);check(b.number===receipt.blockNumber&&b.hash.toLowerCase()===receipt.blockHash.toLowerCase()&&b.transactions.filter(h=>h.toLowerCase()===a.hash!.toLowerCase()).length===1);}
 check(await rpc.getChainId()===chain);
 const proof=Object.freeze({observedAt:Date.now()});issued.set(proof,binding(a));return proof;
}
export function requireTerminalProof(proof:TerminalProof,a:Attempt){check(issued.get(proof)===binding(a)&&Number.isSafeInteger(proof.observedAt)&&proof.observedAt<=Date.now()&&Date.now()-proof.observedAt<=5000);}
