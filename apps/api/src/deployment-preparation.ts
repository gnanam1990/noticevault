import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPublicClient,custom} from 'viem';
import {createSecretRpcRequest,type RpcEndpoints} from './operator-rpc.js';
import {loadOperatorRpcEndpoints} from './operator-rpc-file.js';
import {parsePlan,validatePlan,preflight} from '../../../scripts/ops/preflight.mjs';
import {prepareDeploymentHandoff} from '../../../scripts/ops/deployment-handoff.mjs';
type Client=NonNullable<Parameters<typeof preflight>[0]['clients']>[number];
export function createPreflightRpcClients(origins:readonly string[],endpoints:RpcEndpoints,fetcher:typeof fetch=fetch):Client[]{
  if(origins.length!==2||new Set(origins).size!==2)throw Error('RPC_INDEPENDENT_PAIR_REQUIRED');
  return origins.map((origin):Client=>{
    const c=createPublicClient({transport:custom({request:createSecretRpcRequest(origin,endpoints,fetcher)},{retryCount:0})});
    return {getChainId:()=>c.getChainId(),getBlock:o=>c.getBlock(o),getCode:o=>c.getCode(o),readContract:o=>c.readContract(o),simulateContract:async o=>({result:(await c.simulateContract({...o,account:o.account})).result}),getBalance:o=>c.getBalance(o)};
  });
}
export async function prepareSecureDeployment(input:Omit<Parameters<typeof prepareDeploymentHandoff>[0],'clients'>,endpoints:RpcEndpoints,fetcher:typeof fetch=fetch){
  const value:unknown=JSON.parse(new TextDecoder().decode(input.bytes));
  const plan=parsePlan(value);validatePlan(plan);
  const clients=createPreflightRpcClients(plan.rpcUrls,endpoints,fetcher);
  return prepareDeploymentHandoff({...input,clients});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [planFile,reviewSha256,rpcFile,output]=process.argv.slice(2);
  if(planFile==='--help')console.log('bun apps/api/src/deployment-preparation.ts PLAN.json INDEPENDENT_REVIEW_SHA256 PROTECTED_RPC_FILE NEW_OUTPUT.json; read-only preparation, no signing or broadcast.');
  else try{
    if(!planFile||!reviewSha256||!rpcFile||!output)throw Error('PREPARATION_ARGUMENTS_REQUIRED');
    const root=process.cwd(),destination=resolve(output);
    if(!destination.startsWith(root+sep))throw Error('OUTPUT_MUST_STAY_IN_PROJECT');
    const bytes=readFileSync(planFile),plan=parsePlan(JSON.parse(bytes.toString()) as unknown);validatePlan(plan);
    const endpoints=await loadOperatorRpcEndpoints(rpcFile);
    const result=await prepareSecureDeployment({bytes,reviewSha256,root},endpoints);
    writeFileSync(destination,JSON.stringify(result,(_,value:unknown)=>typeof value==='bigint'?value.toString():value,2)+'\n',{flag:'wx',mode:0o600});
    console.log('UNSIGNED_DEPLOYMENT_PREPARED_NO_BROADCAST');
  }catch(error){
    const code=error instanceof Error&&/^[A-Z][A-Z0-9_]{1,100}$/.test(error.message)?error.message:'DEPLOYMENT_PREPARATION_FAILED';
    console.error(code);process.exitCode=1;
  }
}
