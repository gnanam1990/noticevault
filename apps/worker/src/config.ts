import {deploymentPolicyFromRpc} from './deployment-policy.js';
import {createHash} from 'node:crypto';
import {validateRpcPolicy} from './rpc-transport.js';
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('WORKER_CONFIG_INVALID');return v as Record<string,unknown>;};
const uint=(v:unknown)=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(v))throw Error('WORKER_CONFIG_INTEGER');return v;};
const endpoint=(v:unknown)=>{if(typeof v!=='string')throw Error('WORKER_RPC_REQUIRED');const u=new URL(v);if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error('WORKER_RPC_HTTPS_REQUIRED');return u.href;};
export function workerConfig(input:unknown){
 const c=object(input),allowed=['version','schema','streamId','anchorNumber','anchorHash','primaryRpc','verificationRpc','rpcPolicy','pollIntervalMs','maxSteps','backgroundDiscovery','notificationOutbox','localNotificationSocket'];
 if(c.version!==1||Object.keys(c).some(k=>!allowed.includes(k)))throw Error('WORKER_CONFIG_VERSION_OR_FIELD');
 if(typeof c.schema!=='string'||!/^[a-z][a-z0-9_]{0,62}$/.test(c.schema)||typeof c.streamId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(c.streamId))throw Error('WORKER_SCHEMA_OR_STREAM_REQUIRED');
 if(c.localNotificationSocket!==undefined&&(typeof c.localNotificationSocket!=='string'||!c.localNotificationSocket.startsWith('/')||c.localNotificationSocket.includes('..')||c.localNotificationSocket.length>100||c.notificationOutbox!==true))throw Error('WORKER_LOCAL_SINK_CONFIG');
 if(c.notificationOutbox!==undefined&&typeof c.notificationOutbox!=='boolean')throw Error('WORKER_OUTBOX_FLAG');
 if(c.backgroundDiscovery!==undefined&&typeof c.backgroundDiscovery!=='boolean')throw Error('WORKER_DISCOVERY_FLAG');
 const primaryRpc=endpoint(c.primaryRpc),verificationRpc=endpoint(c.verificationRpc);
 if(new URL(primaryRpc).hostname===new URL(verificationRpc).hostname)throw Error('WORKER_DISTINCT_PROVIDERS_REQUIRED');
 const rpcPolicy=validateRpcPolicy(c.rpcPolicy);deploymentPolicyFromRpc(rpcPolicy);if(rpcPolicy.mode!=='RPC_OBSERVED')throw Error('WORKER_OBSERVED_POLICY_REQUIRED');
 if(typeof c.anchorHash!=='string'||!/^0x[0-9a-f]{64}$/i.test(c.anchorHash)||BigInt(c.anchorHash)===0n)throw Error('WORKER_ANCHOR_REQUIRED');
 const bound=(v:unknown,min:number,max:number)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)throw Error('WORKER_LOOP_LIMIT_REQUIRED');return v;};
 const observationPolicy=createHash('sha256').update(JSON.stringify({primaryRpc,verificationRpc,finality:'FINALIZED_TAG',version:1})).digest('hex');
 return {localNotificationSocket:typeof c.localNotificationSocket==='string'?c.localNotificationSocket:undefined,notificationOutbox:c.notificationOutbox===true,backgroundDiscovery:c.backgroundDiscovery===true,schema:c.schema,primaryRpc,verificationRpc,rpcPolicy,pollIntervalMs:bound(c.pollIntervalMs,100,60000),maxSteps:bound(c.maxSteps,1,100000),stream:{streamId:c.streamId,source:'RPC_OBSERVED',chainId:rpcPolicy.chainId,factory:rpcPolicy.factory,anchorNumber:uint(c.anchorNumber),anchorHash:c.anchorHash.toLowerCase(),observationPolicy}};
}
export type WorkerConfig=ReturnType<typeof workerConfig>;
