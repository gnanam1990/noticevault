import {persistIndexedNotification} from './notifications.js';
import {normalizeDeploymentPolicy} from './deployment-policy.js';
import {decodeFactoryLog,decodeIndexedLog,decodeLifecycleBlock} from './decode.js';
import {applyProjection} from './project.js';
import {createHash} from 'node:crypto';

export interface SqlClient {
 query(sql:string, values?:unknown[]):Promise<{rows:Record<string,unknown>[]}>;
 release(error?:Error):void;
}
export interface SqlPool {connect():Promise<SqlClient>;}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function object(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid object');
 return value as Record<string,unknown>;
}
function uint(value:unknown,bits=256):string{
 if(typeof value!=='string'||! /^(0|[1-9][0-9]*)$/.test(value)||BigInt(value)>=(1n<<BigInt(bits)))throw new Error('Invalid uint');
 return value;
}
function hex(value:unknown,length:number):string{
 if(typeof value!=='string'||!new RegExp('^0x[0-9a-fA-F]{'+length+'}$').test(value)||/^0x0+$/.test(value))throw new Error('Invalid address/hash');
 return value.toLowerCase();
}
export function normalizeConfig(config:unknown){
 const c=object(config);
 if(c.source!=='SYNTHETIC'&&c.source!=='RPC_OBSERVED')throw new Error('LIVE_TRANSPORT_NOT_ENABLED');
 if(typeof c.streamId!=='string'||! /^[a-zA-Z0-9_-]{1,128}$/.test(c.streamId))throw new Error('Invalid stream');
 if(c.source==='RPC_OBSERVED'&&(typeof c.observationPolicy!=='string'||!/^[0-9a-f]{64}$/.test(c.observationPolicy)))throw new Error('Observed reader/finality binding required');
 const cfg={...(c.source==='RPC_OBSERVED'?{observationPolicy:c.observationPolicy}:{}),streamId:c.streamId,source:c.source,chainId:uint(c.chainId),factory:hex(c.factory,40),anchorNumber:uint(c.anchorNumber),anchorHash:hex(c.anchorHash,64),...(c.deploymentPolicy===undefined?{}:{deploymentPolicy:normalizeDeploymentPolicy(c.deploymentPolicy)})};
 if(cfg.source==='RPC_OBSERVED'&&(!cfg.deploymentPolicy||cfg.deploymentPolicy.mode!=='RPC_OBSERVED'))throw new Error('Observed stream requires bound deployment policy');
 if(cfg.chainId==='0')throw new Error('Invalid chain');
 if(cfg.deploymentPolicy&&(cfg.deploymentPolicy.chainId!==cfg.chainId||cfg.deploymentPolicy.factory!==cfg.factory))throw new Error('Stream deployment policy binding mismatch');
 return cfg;
}
function normalize(config:unknown,input:unknown){
 const cfg=normalizeConfig(config),b=object(input);
 const number=uint(b.number),hash=hex(b.hash,64),parentHash=hex(b.parentHash,64);
 const timestamp=b.timestamp===undefined?undefined:uint(b.timestamp,64);
 if(!Array.isArray(b.events))throw new Error('Complete event array required');
 const ids=new Map<string,string>();const indices=new Set<string>();
 const events: {transactionHash:string;logIndex:string;address:string;eventName:string;args:Record<string,string>;raw?:ReturnType<typeof decodeFactoryLog>["raw"]}[]=[];
 for(const raw of b.events){
  const e=object(raw),a=object(e.args);
  let row:{transactionHash:string;logIndex:string;address:string;eventName:string;args:Record<string,string>};
  let provenance:ReturnType<typeof decodeFactoryLog>['raw']|undefined;
  if(e.eventName==='RegularFunded'||e.eventName==='NoticeStarted'||e.eventName==='ProviderClaimed'||e.eventName==='ClientRefunded'){
   if(e.raw===undefined)throw new Error('Funding raw provenance required');
   const decoded=decodeIndexedLog(cfg,{number,hash,parentHash,...(timestamp===undefined?{}:{timestamp})},e.raw);
   const fields=e.eventName==='ClientRefunded'?['amount']:e.eventName==='NoticeStarted'?['S','reason']:e.eventName==='ProviderClaimed'?['regularDelta','noticeDelta','total']:['newF','newD','amount'];
   if(Object.keys(a).length!==fields.length||decoded.eventName!==e.eventName||e.address!==decoded.address||e.transactionHash!==decoded.transactionHash||e.logIndex!==decoded.logIndex||fields.some(k=>a[k]!==decoded.args[k]))throw new Error('Funding raw provenance mismatch');
   row={transactionHash:decoded.transactionHash,logIndex:decoded.logIndex,address:decoded.address,eventName:decoded.eventName,args:decoded.args};provenance=decoded.raw;
  }else{
   if(e.eventName!=='AgreementCreated'||hex(e.address,40)!==cfg.factory)throw new Error('Unsupported event/emitter');
   const args:Record<string,string>={agreement:hex(a.agreement,40),client:hex(a.client,40),provider:hex(a.provider,40)};
   for(const key of ['amountPerPeriod','noticeReserve','initialFunded'])args[key]=uint(a[key]);
   for(const key of ['periodSeconds','noticeSeconds','startAt'])args[key]=uint(a[key],64);
   if(args.client===args.provider||args.amountPerPeriod==='0'||args.periodSeconds==='0'||args.noticeSeconds==='0')throw new Error('Invalid creation fields');
   row={transactionHash:hex(e.transactionHash,64),logIndex:uint(e.logIndex,32),address:cfg.factory,eventName:'AgreementCreated',args};
   if(e.raw!==undefined){
    const decoded=decodeFactoryLog(cfg,{number,hash,parentHash,...(timestamp===undefined?{}:{timestamp})},e.raw);
    if(decoded.transactionHash!==row.transactionHash||decoded.logIndex!==row.logIndex||decoded.address!==row.address||Object.keys(args).some(k=>args[k]!==decoded.args[k]))throw new Error('Raw provenance contradicts decoded event');
    provenance=decoded.raw;
   }
  }
  const key=row.transactionHash+':'+row.logIndex,body=JSON.stringify({...row,...(provenance?{raw:provenance}:{})}),previous=ids.get(key);
  if(previous!==undefined){if(previous!==body)throw new Error('Conflicting duplicate event');continue;}
  if(indices.has(row.logIndex))throw new Error('Conflicting block log index');
  ids.set(key,body);indices.add(row.logIndex);events.push({...row,...(provenance?{raw:provenance}:{})});
 }
 if(events.some(e=>e.raw!==undefined)){
  if(events.some(e=>e.raw===undefined))throw new Error('Mixed raw and decoded block provenance');
  decodeLifecycleBlock(cfg,{number,hash,parentHash,...(timestamp===undefined?{}:{timestamp}),chainId:cfg.chainId,factory:cfg.factory,logs:events.map(e=>e.raw)});
 }
 events.sort((a,b)=>BigInt(a.logIndex)<BigInt(b.logIndex)?-1:1);
 return {cfg,block:{number,hash,parentHash,...(timestamp===undefined?{}:{timestamp}),events}};
}

/** Persist a complete synthetic block. Never emits VERIFIED chain evidence. */
export async function ingestBlock(pool:SqlPool,schema:string,config:unknown,input:unknown):Promise<{status:'applied'|'duplicate';inserted:number}>{
 if(!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw new Error('Invalid schema');
 const s='"'+schema+'"',{cfg,block}=normalize(config,input);
 const binding=digest(cfg),content=digest(block),client=await pool.connect();
 let broken:Error|undefined;
 try{
  await client.query('BEGIN');
  await client.query(`INSERT INTO ${s}.indexer_streams(stream_id,binding_hash,source,head_number,head_hash,deployment_policy,observation_policy) VALUES($1,$2,$6,$3,$4,$5::jsonb,$7) ON CONFLICT DO NOTHING`,[cfg.streamId,binding,cfg.anchorNumber,cfg.anchorHash,cfg.deploymentPolicy?JSON.stringify(cfg.deploymentPolicy):null,cfg.source,cfg.observationPolicy??null]);
  const row=(await client.query(`SELECT binding_hash,head_number::text,head_hash FROM ${s}.indexer_streams WHERE stream_id=$1 FOR UPDATE`,[cfg.streamId])).rows[0];
  if(!row||row.binding_hash!==binding)throw new Error('Stream binding mismatch');
  const head=BigInt(String(row.head_number)),number=BigInt(block.number);
  if(number<=head){
   const prior=(await client.query(`SELECT block_hash,content_hash FROM ${s}.indexer_blocks WHERE stream_id=$1 AND block_number=$2`,[cfg.streamId,block.number])).rows[0];
   if(!prior||prior.block_hash!==block.hash||prior.content_hash!==content)throw new Error('Conflicting replay: reconciliation required');
   await client.query('COMMIT');return {status:'duplicate',inserted:0};
  }
  if(number!==head+1n||block.parentHash!==row.head_hash)throw new Error('Gap or reorg: reconciliation required');
  const historical=(await client.query(`SELECT block_number::text,content_hash FROM ${s}.indexer_block_history WHERE stream_id=$1 AND block_hash=$2`,[cfg.streamId,block.hash])).rows[0];
  if(historical&&(historical.block_number!==block.number||historical.content_hash!==content))throw new Error('Historical block hash conflict');
  await client.query(`INSERT INTO ${s}.indexer_block_history(stream_id,block_hash,block_number,content_hash,observed_timestamp) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[cfg.streamId,block.hash,block.number,content,block.timestamp??null]);
  for(const event of block.events){
   await client.query(`INSERT INTO ${s}.indexer_event_history(stream_id,block_hash,transaction_hash,log_index,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[cfg.streamId,block.hash,event.transactionHash,event.logIndex,JSON.stringify(event)]);
  }
  await client.query(`INSERT INTO ${s}.indexer_blocks(stream_id,block_number,block_hash,content_hash,observed_timestamp) VALUES($1,$2,$3,$4,$5)`,[cfg.streamId,block.number,block.hash,content,block.timestamp??null]);
  for(const event of block.events){
   await client.query(`INSERT INTO ${s}.indexer_events(stream_id,block_number,transaction_hash,log_index,payload) VALUES($1,$2,$3,$4,$5)`,[cfg.streamId,block.number,event.transactionHash,event.logIndex,JSON.stringify(event)]);
   await applyProjection(client,s,cfg.streamId,event,block.number);
  await persistIndexedNotification(client,s,cfg.streamId,block,event);
  }
  await client.query(`UPDATE ${s}.indexer_streams SET head_number=$2,head_hash=$3 WHERE stream_id=$1`,[cfg.streamId,block.number,block.hash]);
  await client.query('COMMIT');return {status:'applied',inserted:block.events.length};
 }catch(error){try{await client.query('ROLLBACK');}catch{broken=new Error('Rollback failed; discard connection');}throw error;}finally{client.release(broken);}
}

export interface BlockTransport {readBlock(number:string):Promise<unknown|null>;}
/** One bounded transport step; no background subscriptions or live RPC. */
export async function ingestNext(pool:SqlPool,schema:string,config:unknown,transport:BlockTransport):Promise<{status:string;inserted:number}>{
 if(!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw new Error('Invalid schema');
 const cfg=normalizeConfig(config);
 const anchor=uint(cfg.anchorNumber),c=await pool.connect();let head:string;
 try{const row=(await c.query(`SELECT head_number::text,binding_hash FROM ${schema}.indexer_streams WHERE stream_id=$1`,[cfg.streamId])).rows[0];if(row&&row.binding_hash!==digest(cfg))throw new Error('Stream binding mismatch');head=row?String(row.head_number):anchor;}finally{c.release();}
 const next=(BigInt(head)+1n).toString(),block=await transport.readBlock(next);
 if(block===null)return {status:'idle',inserted:0};
 if(object(block).number!==next)throw new Error('Transport returned wrong block');
 return ingestBlock(pool,schema,config,block);
}

// Explicit synthetic branch reconciliation; no network finality policy is implied.
export async function rollbackToAncestor(pool:SqlPool,schema:string,config:unknown,input:unknown):Promise<{status:'rolled-back'|'duplicate';head:string}>{
 if(!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw new Error('Invalid schema');
 if((config as {source?:unknown})?.source!=='SYNTHETIC')throw new Error('Observed streams require operator-reviewed recovery; automatic rollback disabled');
const cfg=normalizeConfig(config),request=object(input),s=String.fromCharCode(34)+schema+String.fromCharCode(34);
 const ancestor=uint(request.ancestorNumber),hash=hex(request.ancestorHash,64),expected=hex(request.expectedHeadHash,64);
 if(BigInt(ancestor)<BigInt(cfg.anchorNumber))throw new Error('Ancestor precedes stream anchor');
 const client=await pool.connect();let broken:Error|undefined;
 try{
  await client.query('BEGIN');
  const row=(await client.query(`SELECT binding_hash,head_number::text,head_hash FROM ${s}.indexer_streams WHERE stream_id=$1 FOR UPDATE`,[cfg.streamId])).rows[0];
  if(!row||row.binding_hash!==digest(cfg))throw new Error('Stream binding mismatch');
  if(BigInt(ancestor)>BigInt(String(row.head_number)))throw new Error('Ancestor beyond head');
  const recorded=ancestor===cfg.anchorNumber?cfg.anchorHash:(await client.query(`SELECT block_hash FROM ${s}.indexer_blocks WHERE stream_id=$1 AND block_number=$2`,[cfg.streamId,ancestor])).rows[0]?.block_hash;
  if(recorded!==hash)throw new Error('Ancestor is not canonical');
  if(row.head_number===ancestor&&row.head_hash===hash){await client.query('COMMIT');return {status:'duplicate',head:ancestor};}
  if(row.head_hash!==expected)throw new Error('Canonical head changed');
  const absent=(await client.query(`SELECT b.block_hash FROM ${s}.indexer_blocks b LEFT JOIN ${s}.indexer_block_history h ON h.stream_id=b.stream_id AND h.block_hash=b.block_hash AND h.block_number=b.block_number AND h.content_hash=b.content_hash WHERE b.stream_id=$1 AND h.block_hash IS NULL LIMIT 1`,[cfg.streamId])).rows;
  const missing=(await client.query(`SELECT e.transaction_hash FROM ${s}.indexer_events e JOIN ${s}.indexer_blocks b USING(stream_id,block_number) LEFT JOIN ${s}.indexer_event_history h ON h.stream_id=e.stream_id AND h.block_hash=b.block_hash AND h.transaction_hash=e.transaction_hash AND h.log_index=e.log_index AND h.payload=e.payload WHERE e.stream_id=$1 AND h.transaction_hash IS NULL LIMIT 1`,[cfg.streamId])).rows;
  if(absent.length||missing.length)throw new Error('Canonical provenance incomplete');
  await client.query(`DELETE FROM ${s}.indexed_agreements WHERE stream_id=$1`,[cfg.streamId]);
  await client.query(`DELETE FROM ${s}.indexer_events WHERE stream_id=$1 AND block_number>$2`,[cfg.streamId,ancestor]);
  await client.query(`DELETE FROM ${s}.indexer_blocks WHERE stream_id=$1 AND block_number>$2`,[cfg.streamId,ancestor]);
  const retained=(await client.query(`SELECT payload,block_number::text FROM ${s}.indexer_events WHERE stream_id=$1 ORDER BY block_number,log_index`,[cfg.streamId])).rows;
  for(const event of retained)await applyProjection(client,s,cfg.streamId,event.payload as Parameters<typeof applyProjection>[3],String(event.block_number));
  await client.query(`UPDATE ${s}.indexer_streams SET head_number=$2,head_hash=$3 WHERE stream_id=$1`,[cfg.streamId,ancestor,hash]);
  await client.query('COMMIT');return {status:'rolled-back',head:ancestor};
 }catch(error){try{await client.query('ROLLBACK');}catch{broken=new Error('Rollback failed; discard connection');}throw error;}finally{client.release(broken);}
}
