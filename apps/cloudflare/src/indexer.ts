import {DurableObject} from 'cloudflare:workers';
import {createPool} from '../../../packages/db/src/index';
import {workerConfig} from '../../worker/src/config';
import {httpRpc} from '../../worker/src/http-rpc';
import {cloudConfig} from './config';
import {runBoundedWorker} from './worker-step';
import {nextIndexerDelay} from './indexer-schedule';
import type {WorkerStatus} from '../../worker/src/worker';
export class NoticeVaultIndexer extends DurableObject<Record<string,string>>{
 async arm(){if(this.env.INDEXER_ENABLED==='true'&&await this.ctx.storage.getAlarm()===null)await this.ctx.storage.setAlarm(Date.now()+1000);}
 async alarm(){
  const e=this.env;if(e.INDEXER_ENABLED!=='true')return;
  const interval=Number(e.INDEXER_INTERVAL_MS);if(!Number.isInteger(interval)||interval<60000||interval>3600000)throw Error('INDEXER_INTERVAL_REQUIRED');
  const api=cloudConfig(e),cfg=workerConfig(JSON.parse(e.WORKER_CONFIG_JSON??'null'));if(cfg.schema!==api.db.schema)throw Error('WORKER_DB_SCHEMA_MISMATCH');
  const pool=createPool(api.db),stop=new AbortController(),timer=setTimeout(()=>stop.abort(),120000);let status:WorkerStatus|undefined;
  try{status=await runBoundedWorker(pool,cfg,httpRpc(cfg.primaryRpc,cfg.rpcPolicy.requestTimeoutMs),httpRpc(cfg.verificationRpc,cfg.rpcPolicy.requestTimeoutMs),stop.signal);await this.ctx.storage.put('lastStatus',{at:Date.now(),...status});}
  catch{await this.ctx.storage.put('lastStatus',{at:Date.now(),state:'failed'});}
  finally{clearTimeout(timer);stop.abort();try{await pool.end();}finally{await this.ctx.storage.setAlarm(Date.now()+nextIndexerDelay(status,interval));}}
 }
}
