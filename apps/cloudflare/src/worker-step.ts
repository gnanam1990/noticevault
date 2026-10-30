import {configuredDiscoveryService,enqueueNotificationBatch,deliverOutboxBatch} from '../../api/src/worker-service';
import {runWorker} from '../../worker/src/worker';
import type {WorkerConfig} from '../../worker/src/config';
import type {Rpc} from '../../worker/src/rpc-transport';
import type pg from 'pg';
/** Bounded block batch; every block retains its own atomic PG commit and paired checks. */
export async function runBoundedWorker(pool:pg.Pool,cfg:WorkerConfig,primary:Rpc,verification:Rpc,signal:AbortSignal){
 if(cfg.localNotificationSocket)throw Error('LOCAL_SOCKET_DELIVERY_UNAVAILABLE_ON_WORKERS');
 const discovery=cfg.backgroundDiscovery?await configuredDiscoveryService(pool,cfg.schema,{...cfg.rpcPolicy,primaryRpc:cfg.primaryRpc,verificationRpc:cfg.verificationRpc}):undefined;
 const afterStep=async(s:AbortSignal)=>{if(discovery&&!s.aborted)await discovery(s);if(cfg.notificationOutbox&&!s.aborted){await enqueueNotificationBatch(pool,cfg.schema,10,s);if(!s.aborted)await deliverOutboxBatch(pool,cfg.schema,s,undefined);}};
 const status=await runWorker(pool,{...cfg,maxSteps:Math.min(cfg.maxSteps,250)},primary,verification,signal,()=>{},undefined,{stopWhenIdle:true});
 // Discovery/outbox are bounded once per batch, rather than delaying every indexed block.
 if(!signal.aborted)await afterStep(signal);
 return status;
}
