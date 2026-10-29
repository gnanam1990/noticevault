import {REFUND_EVENT} from './refund-event.js';
import {CLAIM_EVENT} from './claim-event.js';
import {NOTICE_EVENT} from './notice-event.js';
import {FUNDING_EVENT} from './funding-event.js';
import {decodeEventLog} from 'viem';
import {FACTORY_EVENT} from './factory-event.js';
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Invalid object');return v as Record<string,unknown>;}
function uint(v:unknown):string{if(typeof v!=='string'||!/^(0|[1-9][0-9]*)$/.test(v)||BigInt(v)>=(1n<<256n))throw new Error('Invalid decimal uint');return v;}
function hex(v:unknown,n:number):`0x${string}`{if(typeof v!=='string'||!new RegExp('^0x[0-9a-fA-F]{'+n+'}$').test(v)||/^0x0+$/.test(v))throw new Error('Invalid address/hash');return v.toLowerCase() as `0x${string}`;}
function quantity(v:unknown):string{if(typeof v!=='string'||!/^0x(0|[1-9a-f][0-9a-f]*)$/.test(v)||BigInt(v)>=(1n<<256n))throw new Error('Invalid RPC quantity');return BigInt(v).toString();}
function context(config:unknown,block:unknown){
 const c=object(config),b=object(block);if(c.source!=='SYNTHETIC'&&c.source!=='RPC_OBSERVED')throw new Error('LIVE_TRANSPORT_NOT_ENABLED');
 const chainId=uint(c.chainId);if(chainId==='0')throw new Error('Invalid chain');
 return {chainId,factory:hex(c.factory,40),number:uint(b.number),hash:hex(b.hash,64),parentHash:hex(b.parentHash,64),...(b.timestamp===undefined?{}:{timestamp:uint(b.timestamp)})};
}
export function decodeFactoryLog(config:unknown,block:unknown,input:unknown){
 const ctx=context(config,block),r=object(input);
 if(r.chainId!==ctx.chainId||hex(r.factory,40)!==ctx.factory||hex(r.address,40)!==ctx.factory)throw new Error('Deployment/chain/emitter mismatch');
 if(quantity(r.blockNumber)!==ctx.number||hex(r.blockHash,64)!==ctx.hash||r.removed!==false)throw new Error('Noncanonical or removed block log');
 const transactionHash=hex(r.transactionHash,64),logIndex=quantity(r.logIndex),transactionIndex=quantity(r.transactionIndex);
 if(BigInt(logIndex)>=(1n<<32n)||BigInt(transactionIndex)>=(1n<<32n))throw new Error('Index overflow');
 if(!Array.isArray(r.topics)||r.topics.length!==4)throw new Error('Unexpected event topics');
 const topics=r.topics.map(t=>hex(t,64));
 for(const t of topics.slice(1))if(!/^0x0{24}[0-9a-f]{40}$/.test(t))throw new Error('Noncanonical indexed address');
 if(typeof r.data!=='string'||!/^0x[0-9a-fA-F]{384}$/.test(r.data))throw new Error('Unexpected event data length');
 const data=r.data.toLowerCase() as `0x${string}`;
 const decoded=decodeEventLog({abi:FACTORY_EVENT,topics:topics as [`0x${string}`,...`0x${string}`[]],data,strict:true});
 const a=decoded.args,args:Record<string,string>={agreement:hex(a.agreement,40),client:hex(a.client,40),provider:hex(a.provider,40)};
 for(const field of FACTORY_EVENT[0].inputs.filter(f=>!f.indexed)){
  const value=a[field.name as keyof typeof a];if(typeof value!=='bigint'||value<0n||value>=(1n<<BigInt(field.type.slice(4))))throw new Error('Invalid ABI integer');args[field.name]=value.toString();
 }
 if(args.client===args.provider||args.amountPerPeriod==='0'||args.periodSeconds==='0'||args.noticeSeconds==='0')throw new Error('Invalid creation values');
 const raw={chainId:ctx.chainId,factory:ctx.factory,address:ctx.factory,blockNumber:r.blockNumber,blockHash:ctx.hash,transactionHash,transactionIndex:r.transactionIndex,logIndex:r.logIndex,removed:false,topics,data,...(ctx.timestamp===undefined?{}:{blockTimestamp:ctx.timestamp})};
 return {transactionHash,logIndex,address:ctx.factory,eventName:'AgreementCreated',args,raw};
}
function decodeBlock(config:unknown,input:unknown,allowFunding:boolean){
 const b=object(input),ctx=context(config,b);
 if(b.chainId!==ctx.chainId||hex(b.factory,40)!==ctx.factory||!Array.isArray(b.logs))throw new Error('Invalid raw block envelope');
 const identities=new Map<string,string>(),indices=new Set<string>(),txHashes=new Map<string,string>(),txIndices=new Map<string,string>();
 const events:ReturnType<typeof decodeFactoryLog>[]=[];
 for(const item of b.logs){
  const event=(allowFunding?decodeIndexedLog:decodeFactoryLog)(config,b,{...object(item),chainId:b.chainId,factory:b.factory,...(b.timestamp===undefined?{}:{blockTimestamp:b.timestamp})});
  const key=event.transactionHash+':'+event.logIndex,body=JSON.stringify(event),prior=identities.get(key);
  if(prior!==undefined){if(prior!==body)throw new Error('Conflicting duplicate raw event');continue;}
  if(indices.has(event.logIndex))throw new Error('Conflicting block log index');
  const txIndex=quantity(event.raw.transactionIndex),knownHash=txHashes.get(txIndex),knownIndex=txIndices.get(event.transactionHash);
  if((knownHash!==undefined&&knownHash!==event.transactionHash)||(knownIndex!==undefined&&knownIndex!==txIndex))throw new Error('Conflicting transaction identity');
  identities.set(key,body);indices.add(event.logIndex);txHashes.set(txIndex,event.transactionHash);txIndices.set(event.transactionHash,txIndex);events.push(event);
 }
 events.sort((a,b)=>BigInt(a.logIndex)<BigInt(b.logIndex)?-1:1);
 for(let i=1;i<events.length;i++)if(BigInt(quantity(events[i]!.raw.transactionIndex))<BigInt(quantity(events[i-1]!.raw.transactionIndex)))throw new Error('Inconsistent transaction order');
 return {number:ctx.number,hash:ctx.hash,parentHash:ctx.parentHash,events,...(ctx.timestamp===undefined?{}:{timestamp:ctx.timestamp})};
}


export function decodeIndexedLog(config:unknown,block:unknown,input:unknown){
 const ctx=context(config,block),r=object(input),address=hex(r.address,40);
 if(address===ctx.factory)return decodeFactoryLog(config,block,input);
 if(r.chainId!==ctx.chainId||hex(r.factory,40)!==ctx.factory)throw new Error('Deployment/chain mismatch');
 if(quantity(r.blockNumber)!==ctx.number||hex(r.blockHash,64)!==ctx.hash||r.removed!==false)throw new Error('Noncanonical or removed lifecycle log');
 const transactionHash=hex(r.transactionHash,64),logIndex=quantity(r.logIndex),transactionIndex=quantity(r.transactionIndex);
 if(BigInt(logIndex)>=(1n<<32n)||BigInt(transactionIndex)>=(1n<<32n))throw new Error('Index overflow');
 if(!Array.isArray(r.topics)||r.topics.length!==1||typeof r.data!=='string'||!/^0x(?:[0-9a-fA-F]{64}|[0-9a-fA-F]{128}|[0-9a-fA-F]{192})$/.test(r.data))throw new Error('Unsupported or malformed lifecycle event');
 const topics=r.topics.map(t=>hex(t,64)),data=r.data.toLowerCase() as `0x${string}`;
 const decoded=decodeEventLog({abi:[...FUNDING_EVENT,...NOTICE_EVENT,...CLAIM_EVENT,...REFUND_EVENT],topics:topics as [`0x${string}`],data,strict:true});
 if(decoded.eventName==='ClientRefunded'){
  if(data.length!==66||ctx.timestamp===undefined||BigInt(ctx.timestamp)>=(1n<<64n)||r.blockTimestamp!==ctx.timestamp)throw new Error('Claim block timestamp or data invalid');
  const a=decoded.args;if(!a||a.amount<=0n)throw new Error('Invalid refund amount');
  const args:Record<string,string>={amount:a.amount.toString()};
  const raw={chainId:ctx.chainId,factory:ctx.factory,address,blockNumber:r.blockNumber,blockHash:ctx.hash,transactionHash,transactionIndex:r.transactionIndex,logIndex:r.logIndex,removed:false,topics,data,blockTimestamp:ctx.timestamp};
  return {transactionHash,logIndex,address,eventName:'ClientRefunded',args,raw};
 }
 if(decoded.eventName==='ProviderClaimed'){
  if(data.length!==194||ctx.timestamp===undefined||BigInt(ctx.timestamp)>=(1n<<64n)||r.blockTimestamp!==ctx.timestamp)throw new Error('Claim block timestamp or data invalid');
  const a=decoded.args;if(!a||a.total<=0n||a.total!==a.regularDelta+a.noticeDelta)throw new Error('Invalid claim total');
  const args:Record<string,string>={regularDelta:a.regularDelta.toString(),noticeDelta:a.noticeDelta.toString(),total:a.total.toString()};
  const raw={chainId:ctx.chainId,factory:ctx.factory,address,blockNumber:r.blockNumber,blockHash:ctx.hash,transactionHash,transactionIndex:r.transactionIndex,logIndex:r.logIndex,removed:false,topics,data,blockTimestamp:ctx.timestamp};
  return {transactionHash,logIndex,address,eventName:'ProviderClaimed',args,raw};
 }
 if(decoded.eventName==='NoticeStarted'){
  if(data.length!==130||ctx.timestamp===undefined||BigInt(ctx.timestamp)>=(1n<<64n)||r.blockTimestamp!==ctx.timestamp)throw new Error('Notice block timestamp or data invalid');
  const a=decoded.args;if(!a||a.S>=(1n<<64n)||(a.reason!==1&&a.reason!==2))throw new Error('Invalid notice timestamp/reason');
  const args:Record<string,string>={S:a.S.toString(),reason:String(a.reason)};
  const raw={chainId:ctx.chainId,factory:ctx.factory,address,blockNumber:r.blockNumber,blockHash:ctx.hash,transactionHash,transactionIndex:r.transactionIndex,logIndex:r.logIndex,removed:false,topics,data,blockTimestamp:ctx.timestamp};
  return {transactionHash,logIndex,address,eventName:'NoticeStarted',args,raw};
 }
 if(data.length!==194)throw new Error('Invalid funding data length');
 const a=decoded.args;
 if(!a)throw new Error('Missing funding event arguments');
 if(a.newF<=0n||a.amount<=0n||a.newF>=(1n<<256n)||a.amount>=(1n<<256n)||a.newD>=(1n<<64n))throw new Error('Invalid funding values');
 const args:Record<string,string>={newF:a.newF.toString(),newD:a.newD.toString(),amount:a.amount.toString()};
 const raw={chainId:ctx.chainId,factory:ctx.factory,address,blockNumber:r.blockNumber,blockHash:ctx.hash,transactionHash,transactionIndex:r.transactionIndex,logIndex:r.logIndex,removed:false,topics,data,...(ctx.timestamp===undefined?{}:{blockTimestamp:ctx.timestamp})};
 return {transactionHash,logIndex,address,eventName:'RegularFunded',args,raw};
}
export function decodeFactoryBlock(config:unknown,input:unknown){return decodeBlock(config,input,false);}
export function decodeLifecycleBlock(config:unknown,input:unknown){return decodeBlock(config,input,true);}
