import type {Hex} from 'viem';
import {createOperatorReaderFactory} from './operator-rpc.js';
import {parseArcManifest} from '@noticevault/sdk';
import {createReviewedArtifactVerifier,type RecoveryArtifactBundle,type ReviewedArtifactConfig} from './reviewed-artifacts.js';
import type {OperatorApprovalInputs} from './operator-approval.js';
import type {RuntimeReader} from './configured-runtime.js';
import type {ArcFinalityPolicy} from './arc-finality.js';
export type OperatorStartupInputs=Omit<OperatorApprovalInputs,'cfg'|'pool'>;
export type OperatorReaderFactory=(origin:string)=>RuntimeReader;
export async function parseOperatorApprovalInputs(configBytes:Uint8Array,pin:string,readArtifact:(name:string)=>Promise<Uint8Array>,deps:{reader?:OperatorReaderFactory}={}):Promise<OperatorStartupInputs>{
 if(!/^0x[0-9a-f]{64}$/.test(pin))throw Error('OPERATOR_STARTUP_INPUTS_REQUIRED');
 let total=configBytes.length;if(!total||total>1048576)throw Error('OPERATOR_ARTIFACT_SIZE');
 const bytes=async(name:string)=>{const b=await readArtifact(name);total+=b.length;if(!b.length||b.length>1048576||total>4194304)throw Error('OPERATOR_ARTIFACT_SIZE');return new Uint8Array(b);};
 const o=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(configBytes)) as Record<string,unknown>;
 const keys=(v:unknown,names:string[])=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join()!==names.sort().join())throw Error('OPERATOR_CONFIG_SHAPE');return v as Record<string,unknown>;};
 keys(o,['schemaVersion','config','finality','artifacts']);if(o.schemaVersion!==1)throw Error('OPERATOR_CONFIG_VERSION');
 const c=keys(o.config,['deployment','agreementCodeHash','primaryRpcOrigin','verificationRpcOrigin']);
 for(const name of ['primaryRpcOrigin','verificationRpcOrigin']){if(typeof c[name]!=='string')throw Error('OPERATOR_RPC_ORIGIN');const u=new URL(c[name]);if(u.protocol!=='https:'||u.origin!==c[name]||u.username||u.password)throw Error('OPERATOR_RPC_ORIGIN');}
 const config={...c,deployment:parseArcManifest(JSON.stringify(c.deployment))} as ReviewedArtifactConfig;
 const f=keys(o.finality,['network','chainId','kind','verification']);
 if(f.network!==config.deployment.configIdentity||String(f.chainId)!==String(config.deployment.chainId)||f.kind!=='COMMITTED_INCLUSION'||f.verification!=='TWO_PROVIDERS')throw Error('OPERATOR_FINALITY');
 const finality={...f,chainId:config.deployment.chainId} as ArcFinalityPolicy;
 const a=keys(o.artifacts,['review','record','source','lock','build','evidence']);
 const artifact=async(v:unknown)=>{if(typeof v!=='string'||!v||v.includes(String.fromCharCode(92))||v.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('OPERATOR_ARTIFACT_PATH');return bytes(v);};
 const bundle={} as RecoveryArtifactBundle;
 for(const name of ['review','record','source','lock','build'] as const)bundle[name]=await artifact(a[name]);
 if(!a.evidence||typeof a.evidence!=='object'||Array.isArray(a.evidence)||Object.keys(a.evidence).length>32)throw Error('OPERATOR_EVIDENCE');
 const evidence:Record<string,Uint8Array>={};for(const [id,value] of Object.entries(a.evidence))evidence[id]=await artifact(value);bundle.evidence=evidence;
 const anchor={reviewSha256:pin as Hex};await createReviewedArtifactVerifier(bundle,anchor).verify(config,finality);
 const reader=deps.reader??createOperatorReaderFactory();
 return {config,bundle,anchor,runtime:{manifestText:JSON.stringify(c.deployment),recordText:new TextDecoder().decode(bundle.record),provenance:'OPERATOR_CONFIGURED',finality,primary:{id:config.primaryRpcOrigin,reader:reader(config.primaryRpcOrigin)},verification:{id:config.verificationRpcOrigin,reader:reader(config.verificationRpcOrigin)},readArtifact:async id=>{if(!evidence[id])throw Error('OPERATOR_EVIDENCE_MISSING');return evidence[id];},readWallet:async()=>{throw Error('SERVER_HAS_NO_WALLET');}}};
}
