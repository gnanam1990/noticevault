/** Server-issued read-only approval evidence. No endpoint, signer or HTTP evidence input. */
import {decodeFunctionData,encodeFunctionData,decodeEventLog,encodeAbiParameters,erc20Abi,keccak256,toEventSelector} from 'viem';
import type {Hex} from 'viem';
import type {AttemptPreparation} from './attempt-evidence.js';
export type ApprovalOutcome=Readonly<{kind:'ALLOWANCE_CHANGED';owner:string;spender:string;approvedAmount:string;currentAllowance:string;allowanceBlockNumber:string;allowanceBlockHash:string}>;
export type CanonicalExecution={hash:string;blockNumber:bigint;blockHash:string};
export interface ApprovalReader {
 getChainId():Promise<unknown>;
 getTransactionReceipt(args:{hash:Hex}):Promise<unknown>;
 getBytecode(args:{address:Hex;blockNumber:bigint}):Promise<unknown>;
 getBlock(args:{blockNumber:bigint;includeTransactions:false}|{blockTag:'latest';includeTransactions:false}):Promise<unknown>;
 readContract(args:{address:Hex;abi:typeof erc20Abi;functionName:'allowance';args:readonly [Hex,Hex];blockNumber:bigint}):Promise<unknown>;
}
export type ApprovalPolicy=Readonly<{chainId:bigint;token:string;tokenCodeHash:string;policyHash:string}>;
const issued=new WeakMap<object,{key:string;hash:string;blockHash:string;blockNumber:bigint;at:number}>();
const hash=/^0x[0-9a-f]{64}$/i,address=/^0x[0-9a-f]{40}$/i,hex=/^0x(?:[0-9a-f]{2})*$/i;
const topic=toEventSelector('Approval(address,address,uint256)').toLowerCase(),MAX=(1n<<256n)-1n;
function fail():never{throw new Error('EVIDENCE_CONFLICT: approval outcome unavailable or inconsistent');}
function obj(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))return fail();return v as Record<string,unknown>;}
function lower(v:unknown,re:RegExp):string{if(typeof v!=='string'||!re.test(v))return fail();return v.toLowerCase();}
function uint(v:unknown):bigint{if(typeof v!=='bigint'||v<0n||v>MAX)return fail();return v;}
function index(v:unknown):number{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)return fail();return v;}
function key(p:AttemptPreparation){return JSON.stringify([p.workspaceId,p.actor,p.chainId,p.resource,p.action,p.policyHash,p.cycleKey,p.networkNonce,p.target,p.data,p.value,p.approval?.spender,p.approval?.amount]);}
export function isIssuedApprovalOutcome(value:unknown,p:AttemptPreparation,r:CanonicalExecution):value is ApprovalOutcome{
 if(!value||typeof value!=='object')return false;const proof=issued.get(value);return !!proof&&proof.key===key(p)&&proof.hash===r.hash.toLowerCase()&&proof.blockHash===r.blockHash.toLowerCase()&&proof.blockNumber===r.blockNumber&&Date.now()>=proof.at&&Date.now()-proof.at<=60000;
}
function block(v:unknown,n?:bigint){const b=obj(v),number=uint(b.number),blockHash=lower(b.hash,hash),timestamp=uint(b.timestamp);if(n!==undefined&&number!==n)return fail();if(!Array.isArray(b.transactions))return fail();const txs=b.transactions.map(x=>lower(x,hash));if(new Set(txs).size!==txs.length)return fail();return {number,hash:blockHash,timestamp,txs};}
function receipt(v:unknown,p:AttemptPreparation,r:CanonicalExecution,token:string,spender:string,amount:bigint){
 const v0=obj(v);if(lower(v0.transactionHash,hash)!==r.hash.toLowerCase()||lower(v0.blockHash,hash)!==r.blockHash.toLowerCase()||uint(v0.blockNumber)!==r.blockNumber||lower(v0.from,address)!==p.actor.toLowerCase()||lower(v0.to,address)!==token||v0.status!=='success'||!Array.isArray(v0.logs))return fail();
 const ti=index(v0.transactionIndex),seen=new Set<number>();let count=0;
 const normalized=v0.logs.map(raw=>{const l=obj(raw),li=index(l.logIndex);if(seen.has(li)||l.removed!==false||lower(l.transactionHash,hash)!==r.hash.toLowerCase()||lower(l.blockHash,hash)!==r.blockHash.toLowerCase()||uint(l.blockNumber)!==r.blockNumber||index(l.transactionIndex)!==ti||!Array.isArray(l.topics))return fail();seen.add(li);const emitter=lower(l.address,address),topics=l.topics.map(x=>lower(x,hash)),data=lower(l.data,hex);
  if(emitter===token&&topics[0]===topic){count++;if(topics.length!==3)return fail();const decoded=decodeEventLog({abi:erc20Abi,eventName:'Approval',topics:topics as [Hex,...Hex[]],data:data as Hex,strict:true});if(decoded.args.owner.toLowerCase()!==p.actor.toLowerCase()||decoded.args.spender.toLowerCase()!==spender||decoded.args.value!==amount||encodeAbiParameters([{type:'uint256'}],[amount]).toLowerCase()!==data)return fail();}
  return [emitter,topics,data,li];
 });if(count!==1)return fail();return {ti,digest:JSON.stringify(normalized)};
}
export function createApprovalOutcomeVerifier(source:ApprovalPolicy,readers:readonly [ApprovalReader,ApprovalReader]){
 const policy=Object.freeze({...source}),token=lower(policy.token,address),codeHash=lower(policy.tokenCodeHash,hash),policyHash=lower(policy.policyHash,hash);
 if(typeof policy.chainId!=='bigint'||policy.chainId<=0n||BigInt(token)===0n||BigInt(codeHash)===0n||readers.length!==2||!readers[0]||!readers[1]||readers[0]===readers[1])return fail();
 const sources=Object.freeze([...readers]);
 const verify=async(input:AttemptPreparation,execution:CanonicalExecution):Promise<ApprovalOutcome>=>{
  const p=Object.freeze({...input,...(input.approval?{approval:Object.freeze({...input.approval})}:{})}),r=Object.freeze({...execution});
  if(!['approve-creation','approve-renewal'].includes(p.action)||p.chainId!==String(policy.chainId)||p.target.toLowerCase()!==token||p.policyHash.toLowerCase()!==policyHash||p.value!=='0'||!p.approval)return fail();
  const spender=lower(p.approval.spender,address);if(BigInt(spender)===0n||!/^[1-9][0-9]{0,77}$/.test(p.approval.amount))return fail();const amount=uint(BigInt(p.approval.amount));
  const decoded=decodeFunctionData({abi:erc20Abi,data:p.data as Hex});if(decoded.functionName!=='approve'||decoded.args?.[0]?.toLowerCase()!==spender||decoded.args?.[1]!==amount||encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[spender as Hex,amount]}).toLowerCase()!==p.data.toLowerCase())return fail();
  const latest=block(await sources[0]!.getBlock({blockTag:'latest',includeTransactions:false}));const now=BigInt(Math.floor(Date.now()/1000));if(latest.number<r.blockNumber||latest.timestamp>now+30n||latest.timestamp<now-7200n)return fail();
  const observations=await Promise.all(sources.map(async rpc=>{
   async function chain(){const id=await rpc.getChainId();if(typeof id!=='number'||!Number.isSafeInteger(id)||BigInt(id)!==policy.chainId)return fail();}
   await chain();const raw=await rpc.getTransactionReceipt({hash:r.hash as Hex}),proof=receipt(raw,p,r,token,spender,amount);
   const rb=block(await rpc.getBlock({blockNumber:r.blockNumber,includeTransactions:false}),r.blockNumber);if(rb.hash!==r.blockHash.toLowerCase()||rb.txs[proof.ti]!==r.hash.toLowerCase())return fail();
   const code=lower(await rpc.getBytecode({address:token as Hex,blockNumber:r.blockNumber}),hex);if(code==='0x'||keccak256(code as Hex)!==codeHash)return fail();
   const current=block(await rpc.getBlock({blockNumber:latest.number,includeTransactions:false}),latest.number);if(current.hash!==latest.hash||current.timestamp!==latest.timestamp)return fail();
   const currentCode=lower(await rpc.getBytecode({address:token as Hex,blockNumber:latest.number}),hex);if(currentCode==='0x'||keccak256(currentCode as Hex)!==codeHash)return fail();
   const allowance=uint(await rpc.readContract({address:token as Hex,abi:erc20Abi,functionName:'allowance',args:[p.actor as Hex,spender as Hex],blockNumber:latest.number}));
   const again=receipt(await rpc.getTransactionReceipt({hash:r.hash as Hex}),p,r,token,spender,amount);if(again.digest!==proof.digest||again.ti!==proof.ti)return fail();
   if(block(await rpc.getBlock({blockNumber:r.blockNumber,includeTransactions:false}),r.blockNumber).hash!==rb.hash||block(await rpc.getBlock({blockNumber:latest.number,includeTransactions:false}),latest.number).hash!==latest.hash)return fail();await chain();return {allowance,digest:proof.digest};
  }));if(observations[0]!.allowance!==observations[1]!.allowance||observations[0]!.digest!==observations[1]!.digest)return fail();
  const outcome:ApprovalOutcome=Object.freeze({kind:'ALLOWANCE_CHANGED',owner:p.actor.toLowerCase(),spender,approvedAmount:String(amount),currentAllowance:String(observations[0]!.allowance),allowanceBlockNumber:String(latest.number),allowanceBlockHash:latest.hash});
  issued.set(outcome,{key:key(p),hash:r.hash.toLowerCase(),blockHash:r.blockHash.toLowerCase(),blockNumber:r.blockNumber,at:Date.now()});return outcome;
 };
 return async(p:AttemptPreparation,r:CanonicalExecution)=>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([verify(p,r),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('EVIDENCE_UNAVAILABLE: approval verification deadline exceeded')),5000);})]);}finally{if(timer!==undefined)clearTimeout(timer);}};
}
