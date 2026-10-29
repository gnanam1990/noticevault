import {deploymentPolicyFromRpc,normalizeDeploymentPolicy} from './deployment-policy.js';
import {ingestNext,type SqlPool} from './ingest.js';
import {createRpcTransport,validateRpcPolicy,type Rpc} from './rpc-transport.js';
/** One durable page. Cancellation during RPC never advances; an entered DB transaction completes atomically. */
export async function runConfiguredStep(pool:SqlPool,schema:string,config:unknown,policy:unknown,rpc:Rpc,signal?:AbortSignal){
 const p=validateRpcPolicy(policy);
 if(!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw new Error('Invalid schema');
 if(!config||typeof config!=='object'||Array.isArray(config))throw new Error('Invalid stream config');
 const c={...config} as Record<string,unknown>;
 if(c.source!==p.mode)throw new Error('Stream source mismatch');
 if(c.chainId!==p.chainId||typeof c.factory!=='string'||c.factory.toLowerCase()!==p.factory)throw new Error('Stream/deployment binding mismatch');
 const deploymentPolicy=deploymentPolicyFromRpc(p);
 if(c.deploymentPolicy!==undefined&&JSON.stringify(normalizeDeploymentPolicy(c.deploymentPolicy))!==JSON.stringify(deploymentPolicy))throw new Error('Stream/deployment policy binding mismatch');
 c.deploymentPolicy=deploymentPolicy;
 if(signal?.aborted)throw new Error('RPC_CANCELLED');
 const transport=createRpcTransport(p,rpc,async()=>{const db=await pool.connect();try{return (await db.query(`SELECT agreement FROM ${schema}.indexed_agreements WHERE stream_id=$1`,[c.streamId])).rows.map(r=>String(r.agreement));}finally{db.release();}},signal);
 return ingestNext(pool,schema,c,transport);
}

export async function runSyntheticStep(pool:SqlPool,schema:string,config:unknown,policy:unknown,rpc:Rpc,signal?:AbortSignal){
 if((policy as {mode?:unknown})?.mode!=='SYNTHETIC'||(config as {source?:unknown})?.source!=='SYNTHETIC')throw new Error('LIVE_TRANSPORT_NOT_ENABLED');
 return runConfiguredStep(pool,schema,config,policy,rpc,signal);
}
