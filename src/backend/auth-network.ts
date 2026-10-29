import {arcDeployment} from '../../packages/sdk/src/deployments';
export type AuthNetwork={configIdentity:'ARC_TESTNET'|'ARC_MAINNET';chainId:number;label:string};
export function parseAuthNetwork(value:unknown):AuthNetwork{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Authentication network unavailable');
 const v=value as Record<string,unknown>;
 if(Object.keys(v).sort().join()!=='chainId,configIdentity')throw Error('Invalid authentication network');
 const d=arcDeployment(String(v.configIdentity));
 if(v.chainId!==String(d.chainId))throw Error('Authentication network mismatch');
 return {configIdentity:d.configIdentity as AuthNetwork['configIdentity'],chainId:Number(d.chainId),label:d.configIdentity==='ARC_MAINNET'?'Arc Mainnet':'Arc Testnet'};
}
export async function loadAuthNetwork(signal:AbortSignal):Promise<AuthNetwork>{
 const response=await fetch('/api/auth/network',{credentials:'same-origin',cache:'no-store',redirect:'error',signal});
 if(!response.ok)throw Error('Authentication network unavailable ('+response.status+').');
 return parseAuthNetwork(await response.json());
}
