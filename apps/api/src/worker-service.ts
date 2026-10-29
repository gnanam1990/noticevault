import type pg from 'pg';
import {loadOperatorApprovalInputs} from './operator-startup.js';
import {composeReadOnlyRuntime} from './configured-runtime.js';
import {reconcileBackgroundBatch} from './background-discovery.js';
export async function configuredDiscoveryService(pool:pg.Pool,schema:string,expected:{chainId:string;factory:string;token:string;factoryCodeHash:string;tokenCodeHash:string;primaryRpc:string;verificationRpc:string}){
 const input=await loadOperatorApprovalInputs();if(!input)throw Error('WORKER_DISCOVERY_REVIEWED_CONFIG_REQUIRED');
 const runtime=await composeReadOnlyRuntime(input.runtime),d=runtime.deployment;
 if(String(d.chainId)!==expected.chainId||d.factoryAddress?.toLowerCase()!==expected.factory||d.allowlistedToken?.toLowerCase()!==expected.token||d.expectedFactoryCodeHash!==expected.factoryCodeHash||d.expectedTokenCodeHash!==expected.tokenCodeHash||input.runtime.primary.id!==new URL(expected.primaryRpc).origin||input.runtime.verification.id!==new URL(expected.verificationRpc).origin)throw Error('WORKER_DISCOVERY_DEPLOYMENT_MISMATCH');
 return async(signal:AbortSignal)=>{if(signal.aborted)return;const result=await reconcileBackgroundBatch(pool,schema,runtime.attempts,signal);if(result.failed)console.warn('WORKER_DISCOVERY_RECORDS_BLOCKED',result.failed);};
}
export {enqueueNotificationBatch} from './notification-outbox.js';
export {deliverOutboxBatch} from './notification-delivery.js';

export {createLocalNotificationAdapter} from './local-notification-receiver.js';
