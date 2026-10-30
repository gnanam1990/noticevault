import {createHash} from 'node:crypto';
import {normalizeConfig} from './ingest.js';
import {deploymentPolicyFromRpc} from './deployment-policy.js';
import {runConfiguredStep} from './run.js';
import {pairedRpc} from './http-rpc.js';
import type {WorkerConfig} from './config.js';
import type {Rpc} from './rpc-transport.js';
import type {SqlPool} from './ingest.js';
export type WorkerStatus={state:'running'|'idle'|'stopped'|'limit';steps:number;inserted:number;head:string};
const block=(v:unknown)=>{if(!v||typeof v!=='object')throw Error('WORKER_FINALITY_UNAVAILABLE');const r=v as Record<string,unknown>;if(typeof r.number!=='string'||!/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(r.number)||typeof r.hash!=='string'||!/^0x[0-9a-f]{64}$/i.test(r.hash))throw Error('WORKER_HEADER_INVALID');return {number:BigInt(r.number),hash:r.hash.toLowerCase()};};
const pause=(ms:number,signal:AbortSignal)=>new Promise<void>(resolve=>{if(signal.aborted){resolve();return;}const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();},timer=setTimeout(done,ms);signal.addEventListener('abort',done,{once:true});});
/** Reads only; each ingestion transaction commits cursor, projections and inbox notifications together. */
export async function runWorker(pool:SqlPool,cfg:WorkerConfig,primary:Rpc,verification:Rpc,signal:AbortSignal,onStatus:(s:WorkerStatus)=>void=()=>{},afterStep?:(signal:AbortSignal)=>Promise<void>,options:{stopWhenIdle?:boolean}={}){
 const binding=createHash('sha256').update(JSON.stringify(normalizeConfig({...cfg.stream,deploymentPolicy:deploymentPolicyFromRpc(cfg.rpcPolicy)}))).digest('hex');const rpc=pairedRpc(primary,verification);let steps=0,inserted=0,head=cfg.stream.anchorNumber;
 while(!signal.aborted&&steps<cfg.maxSteps){
  const c=await pool.connect();let expectedHash=cfg.stream.anchorHash;
  try{const row=(await c.query('SELECT head_number::text,head_hash,binding_hash FROM '+cfg.schema+'.indexer_streams WHERE stream_id=$1',[cfg.stream.streamId])).rows[0];if(row){if(row.binding_hash!==binding)throw Error('WORKER_STREAM_BINDING_MISMATCH');head=String(row.head_number);expectedHash=String(row.head_hash).toLowerCase();}}finally{c.release();}
  if(signal.aborted)break;
  try{
   const chain=await rpc.request('eth_chainId',[],signal);if(typeof chain!=='string'||BigInt(chain).toString()!==cfg.stream.chainId)throw Error('WORKER_CHAIN_MISMATCH');
   const checkpoint=block(await rpc.request('eth_getBlockByNumber',['0x'+BigInt(head).toString(16),false],signal));if(checkpoint.number!==BigInt(head)||checkpoint.hash!==expectedHash)throw Error('WORKER_CURSOR_CONFLICT');
   const finalized=block(await rpc.request('eth_getBlockByNumber',['finalized',false],signal));
   if(finalized.number===BigInt(head)&&finalized.hash!==expectedHash)throw Error('WORKER_FINALITY_CONFLICT');
   if(finalized.number<BigInt(head))throw Error('WORKER_FINALITY_REGRESSION');
   if(signal.aborted)break;
   const stepRpc:Rpc={request:(method,params,abort)=>method==='eth_getBlockByNumber'&&typeof params[0]==='string'&&/^0x[0-9a-f]+$/.test(params[0])&&BigInt(params[0])>finalized.number?Promise.resolve(null):rpc.request(method,params,abort)};
   const result=finalized.number===BigInt(head)?{status:'idle',inserted:0}:await runConfiguredStep(pool,cfg.schema,cfg.stream,cfg.rpcPolicy,stepRpc,signal);
   steps++;inserted+=result.inserted;if(result.status==='applied')head=(BigInt(head)+1n).toString();onStatus({state:result.status==='idle'?'idle':'running',steps,inserted,head});
   if(!signal.aborted&&afterStep)await afterStep(signal);
   if(result.status==='idle'){
    if(options.stopWhenIdle)return {state:'idle',steps,inserted,head} as WorkerStatus;
    await pause(cfg.pollIntervalMs,signal);
   }
  }catch(error){if(signal.aborted)break;throw error;}
 }
 const result:WorkerStatus={state:signal.aborted?'stopped':'limit',steps,inserted,head};onStatus(result);return result;
}
