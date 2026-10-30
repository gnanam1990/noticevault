import {configuredDiscoveryService,enqueueNotificationBatch,deliverOutboxBatch,createLocalNotificationAdapter,assertWorkerDeploymentIdentity} from '@noticevault/api/worker';
import {readFile,stat} from 'node:fs/promises';
import pg from 'pg';
import {loadDbConfig} from '@noticevault/db';
import {workerConfig} from './config.js';
import {httpRpc} from './http-rpc.js';
import {runWorker} from './worker.js';
async function main(){
 const file=process.env.NOTICEVAULT_WORKER_CONFIG;if(!file)throw Error('WORKER_CONFIG_REQUIRED: set NOTICEVAULT_WORKER_CONFIG to a reviewed configuration file');
 if((await stat(file)).size>32768)throw Error('WORKER_CONFIG_TOO_LARGE');const cfg=workerConfig(JSON.parse(await readFile(file,'utf8')));assertWorkerDeploymentIdentity(process.env.CONFIG_IDENTITY,cfg.rpcPolicy);const missing=['PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSCHEMA'].filter(k=>!process.env[k]);if(missing.length)throw Error('WORKER_DB_CONFIG_REQUIRED: '+missing.join(', '));const db=loadDbConfig();
 if(db.schema!==cfg.schema)throw Error('WORKER_DB_SCHEMA_MISMATCH');
 if(process.argv.includes('--check')){console.log('WORKER_CONFIG_VALID: registered identity matched; no connection opened; on-chain checks occur at runtime');return;}
 const pool=new pg.Pool({...db,max:2,connectionTimeoutMillis:10000,statement_timeout:15000,query_timeout:20000});const stop=new AbortController(),shutdown=()=>stop.abort();
 process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
 try{await pool.query('SELECT stream_id,source,deployment_policy FROM '+cfg.schema+'.indexer_streams LIMIT 0');
  const discovery=cfg.backgroundDiscovery?await configuredDiscoveryService(pool,cfg.schema,{...cfg.rpcPolicy,primaryRpc:cfg.primaryRpc,verificationRpc:cfg.verificationRpc}):undefined;
  const localDelivery=cfg.localNotificationSocket?await createLocalNotificationAdapter(cfg.localNotificationSocket):undefined;
 const afterStep=async(signal:AbortSignal)=>{if(discovery&&!signal.aborted)await discovery(signal);if(cfg.notificationOutbox&&!signal.aborted){await enqueueNotificationBatch(pool,cfg.schema,10,signal);if(!signal.aborted)await deliverOutboxBatch(pool,cfg.schema,signal,localDelivery);}};
  await runWorker(pool,cfg,httpRpc(cfg.primaryRpc,cfg.rpcPolicy.requestTimeoutMs),httpRpc(cfg.verificationRpc,cfg.rpcPolicy.requestTimeoutMs),stop.signal,status=>console.log(JSON.stringify({worker:'noticevault',...status})),afterStep);
 }finally{stop.abort();process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);await pool.end();}
}
main().catch(error=>{const message=error instanceof Error?error.message:'';console.error(message.startsWith('WORKER_')?message:'WORKER_START_OR_RUN_FAILED: verify reviewed configuration, applied migrations, database access and matching canonical RPC observations');process.exitCode=1;});
