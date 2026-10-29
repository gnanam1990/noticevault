import {sha256,toHex} from 'viem';
/** Read-only bounded discovery. Absence is uncertainty, never permission to retry. */
import type {Hex} from 'viem';
import type {CanonicalAttemptReader,CandidateLocator} from './canonical-attempt-rpc.js';
export type DiscoveryRange=Readonly<{fromBlock:bigint;toBlock:bigint}>;
const H=/^0x[0-9a-f]{64}$/i,A=/^0x[0-9a-f]{40}$/i;
function fail():never{throw new Error('EVIDENCE_UNAVAILABLE: incomplete or inconsistent canonical discovery');}
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))return fail();return v as Record<string,unknown>;}
function hex(v:unknown,re:RegExp):string{if(typeof v!=='string'||!re.test(v))return fail();return v.toLowerCase();}
function integer(v:unknown):bigint{if(typeof v==='bigint'&&v>=0n)return v;if(typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)return BigInt(v);return fail();}
export type DiscoveryWindowEvidence=Readonly<{candidateHash:string|null;fromBlock:string;toBlock:string;firstParentHash:string;checkpointHash:string;branchDigest:string}>;
export function createBoundedDiscoveryScanner(reader:CanonicalAttemptReader,range:DiscoveryRange):(query:Parameters<CandidateLocator>[0])=>Promise<DiscoveryWindowEvidence>{
 const from=range.fromBlock,to=range.toBlock;
 if(typeof from!=='bigint'||typeof to!=='bigint'||from<0n||to<from||to-from>=1000n)throw new Error('Discovery requires an explicit range of at most 1000 blocks');
 async function scan(query:Parameters<CandidateLocator>[0],active:()=>boolean):Promise<DiscoveryWindowEvidence>{
  const chain=integer(query.chainId),account=hex(query.account,A),nonce=integer(query.nonce);
  if(chain===0n||integer(await reader.getChainId())!==chain)return fail();
  const observed:Array<{number:bigint;hash:string;parent:string;transactions:string[]}>=[];
  const seen=new Set<string>();let candidate:string|null=null;let total=0;
  for(let n=from;n<=to;n++){
   if(!active())return fail();
   const b=object(await reader.getBlock({blockNumber:n,includeTransactions:false}));
   if(integer(b.number)!==n||!Array.isArray(b.transactions))return fail();
   const block={number:n,hash:hex(b.hash,H),parent:hex(b.parentHash,H),transactions:b.transactions.map(x=>hex(x,H))};
   if(observed.length&&block.parent!==observed[observed.length-1]!.hash)return fail();
   total+=block.transactions.length;if(total>10000)return fail();
   for(let i=0;i<block.transactions.length;i++){
    const hash=block.transactions[i]!;if(seen.has(hash))return fail();seen.add(hash);
    if(!active())return fail();
    const tx=object(await reader.getTransaction({hash:hash as Hex}));
    if(hex(tx.hash,H)!==hash||integer(tx.chainId)!==chain||integer(tx.blockNumber)!==n||hex(tx.blockHash,H)!==block.hash||integer(tx.transactionIndex)!==BigInt(i))return fail();
    const sender=hex(tx.from,A),txNonce=integer(tx.nonce);
    if(sender===account&&txNonce===nonce){if(candidate!==null)return fail();candidate=hash;}
   }
   observed.push(block);
  }
  for(const old of observed){
   if(!active())return fail();
   const b=object(await reader.getBlock({blockNumber:old.number,includeTransactions:false}));
   if(integer(b.number)!==old.number||hex(b.hash,H)!==old.hash||hex(b.parentHash,H)!==old.parent||!Array.isArray(b.transactions)||b.transactions.length!==old.transactions.length||b.transactions.some((v,i)=>hex(v,H)!==old.transactions[i]))return fail();
  }
  if(!active()||integer(await reader.getChainId())!==chain)return fail();return Object.freeze({candidateHash:candidate,fromBlock:String(from),toBlock:String(to),firstParentHash:observed[0]!.parent,checkpointHash:observed[observed.length-1]!.hash,branchDigest:sha256(toHex(JSON.stringify(observed,(_,v)=>typeof v==='bigint'?v.toString():v))).slice(2)});
 }
 return async query=>{
  let timer:ReturnType<typeof setTimeout>|undefined;let running=true;
  try{return await Promise.race([scan(Object.freeze({...query}),()=>running),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('EVIDENCE_UNAVAILABLE: discovery deadline exceeded')),5000);})]);}
  finally{running=false;if(timer!==undefined)clearTimeout(timer);}
 };
}

export function createBoundedCandidateLocator(reader:CanonicalAttemptReader,range:DiscoveryRange):CandidateLocator{const scan=createBoundedDiscoveryScanner(reader,range);return async query=>(await scan(query)).candidateHash;}
