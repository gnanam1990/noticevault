import {configuredDiscoveryService,enqueueNotificationBatch,deliverOutboxBatch} from '../../api/src/worker-service';
import {runWorker} from '../../worker/src/worker';
import type {WorkerConfig} from '../../worker/src/config';
import type {Rpc} from '../../worker/src/rpc-transport';
import type pg from 'pg';
/** One atomic PG page plus existing bounded discovery/outbox hooks; no external delivery adapter. */
export async function runBoundedWorker(pool:pg.Pool,cfg:WorkerConfig,primary:Rpc,verification:Rpc,signal:AbortSignal){
 if(cfg.localNotificationSocket)throw Error('LOCAL_SOCKET_DELIVERY_UNAVAILABLE_ON_WORKERS');
 const discovery=cfg.backgroundDiscovery?await configuredDiscoveryService(pool,cfg.schema,{...cfg.rpcPolicy,primaryRpc:cfg.primaryRpc,verificationRpc:cfg.verificationRpc}):undefined;
 const afterStep=async(s:AbortSignal)=>{if(discovery&&!s.aborted)await discovery(s);if(cfg.notificationOutbox&&!s.aborted){await enqueueNotificationBatch(pool,cfg.schema,10,s);if(!s.aborted)await deliverOutboxBatch(pool,cfg.schema,s,undefined);}};
 return runWorker(pool,{...cfg,maxSteps:1,pollIntervalMs:100},primary,verification,signal,()=>{},afterStep);
}
