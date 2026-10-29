import {createPool} from '@noticevault/db';
import {composeOperatorApproval} from './operator-approval.js';
import type {OperatorStartupInputs} from './operator-startup.js';
import {isDeepStrictEqual} from 'node:util';
/** Configured startup builds the same application and routes; it never loads a signer. */
import {buildServer} from './server.js';
import type {ServerOptions} from './server.js';
import {composeReadOnlyRuntime} from './configured-runtime.js';
import type {RuntimeInputs} from './configured-runtime.js';
export type ConfiguredServerOptions=Omit<ServerOptions,'configuredRuntime'|'syntheticAuth'|'syntheticConsent'|'syntheticAttempts'>&{runtimeInputs?:RuntimeInputs;operatorInputs?:OperatorStartupInputs};
export async function buildConfiguredServer(options:ConfiguredServerOptions){
 const {runtimeInputs,operatorInputs,...server}=options;
 if(operatorInputs){
  if(runtimeInputs||server.operatorApproval)throw Error('AMBIGUOUS_OPERATOR_STARTUP');
  const pool=server.pool??createPool(server.cfg.db);
  try{
   const cfg={...server.cfg,consentDeployment:server.cfg.consentDeployment??operatorInputs.config.deployment};
   const composed=await composeOperatorApproval({...operatorInputs,cfg,pool});
   const app=await buildServer({...server,cfg,pool,configuredRuntime:composed.runtime,operatorApproval:composed.adapter,evidenceCollector:composed.evidence});
   if(!server.pool)app.addHook('onClose',async()=>{await pool.end();});
   return app;
  }catch(error){if(!server.pool)await pool.end();throw error;}
 }
 // Absent operator transports preserve the existing fail-closed routes and diagnostics.
 if(!runtimeInputs)return buildServer(server);
 if(!['ARC_TESTNET','ARC_MAINNET'].includes(server.cfg.configIdentity))throw new Error('CONFIGURED_STARTUP_REQUIRES_ARC_NETWORK');
 const runtime=await composeReadOnlyRuntime(runtimeInputs);
 if(server.cfg.consentDeployment&&!isDeepStrictEqual(server.cfg.consentDeployment,runtime.deployment))throw new Error('STARTUP_DEPLOYMENT_MISMATCH');
 return buildServer({...server,configuredRuntime:runtime,cfg:{...server.cfg,consentDeployment:runtime.deployment}});
}
