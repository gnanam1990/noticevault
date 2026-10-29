import {createPublicClient,http} from 'viem';
import type {Hex} from 'viem';
import type {MinimalPublicClient} from '../../../packages/sdk/src/index';
import {parseArcManifest} from '../../../packages/sdk/src/manifest';
import {createRecoveryReader} from './recovery';
export function parseRecoveryConfig(text:string){
 if(typeof text!=='string'||text.length>32768)throw Error('INVALID_RECOVERY_CONFIG');
 let raw:unknown;try{raw=JSON.parse(text);}catch{throw Error('INVALID_RECOVERY_CONFIG');}
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('INVALID_RECOVERY_CONFIG');
 const v=raw as Record<string,unknown>,keys=['schemaVersion','manifest','agreementCodeHash','primaryRpcOrigin','verificationRpcOrigin'];
 if(v.schemaVersion!==1||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))throw Error('INVALID_RECOVERY_CONFIG');
 const seen=new Set<string>();for(const m of text.matchAll(/"(?:\\.|[^"\\])*"/g)){if(!/^\s*:/.test(text.slice(m.index!+m[0].length)))continue;const key=JSON.parse(m[0]);if(seen.has(key))throw Error('DUPLICATE_CONFIG_KEY');seen.add(key);}
 function origin(value:unknown):string{if(typeof value!=='string')throw Error('INVALID_RPC_ORIGIN');let u:URL;try{u=new URL(value);}catch{throw Error('INVALID_RPC_ORIGIN');}if(u.protocol!=='https:'||u.origin!==value||u.username||u.password||u.search||u.hash)throw Error('INVALID_RPC_ORIGIN');return value;}
 const primaryRpcOrigin=origin(v.primaryRpcOrigin),verificationRpcOrigin=origin(v.verificationRpcOrigin);if(primaryRpcOrigin===verificationRpcOrigin)throw Error('DISTINCT_RPC_ORIGINS_REQUIRED');
 if(typeof v.agreementCodeHash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(v.agreementCodeHash)||/^0x0{64}$/.test(v.agreementCodeHash))throw Error('MISSING_AGREEMENT_CODE_HASH');
 return Object.freeze({deployment:parseArcManifest(JSON.stringify(v.manifest)),agreementCodeHash:v.agreementCodeHash as Hex,primaryRpcOrigin,verificationRpcOrigin});
}
export type RecoveryConfig=ReturnType<typeof parseRecoveryConfig>;
export function createConfiguredReader(c:RecoveryConfig){
 // Operator-controlled build/CLI config only. Imported manifests cannot set RPC origins.
 const reader=(url:string):MinimalPublicClient=>{const client=createPublicClient({ccipRead:false,transport:http(url,{retryCount:0,timeout:5000,fetchOptions:{credentials:'omit',redirect:'error'}})});return {getChainId:()=>client.getChainId(),getBlock:q=>client.getBlock(q),getBytecode:q=>client.getBytecode(q),readContract:q=>client.readContract(q as Parameters<typeof client.readContract>[0])};};
 return createRecoveryReader({deployment:c.deployment,agreementCodeHash:c.agreementCodeHash,provenance:'OPERATOR_CONFIGURED'},reader(c.primaryRpcOrigin),reader(c.verificationRpcOrigin));
}
