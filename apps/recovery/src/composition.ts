import {createPublicClient,http,keccak256,toHex} from 'viem';
import type {Hex} from 'viem';
import {createArcCanonicalAttemptRpc} from '../../../apps/api/src/arc-finality';
import type {ArcFinalityPolicy} from '../../../apps/api/src/arc-finality';
import {createBusinessOutcomeVerifier} from '../../../apps/api/src/business-outcome';
import {reconcileCanonical} from '../../../apps/api/src/canonical-reconciliation';
import type {CanonicalAttemptReader} from '../../../apps/api/src/canonical-attempt-rpc';
import type {FundingReader} from '../../../apps/api/src/funding-outcome';
import type {MinimalPublicClient} from '../../../packages/sdk/src/index';
import {parseRecoveryConfig} from './config';
import type {RecoveryConfig} from './config';
import {createRecoveryReader,prepareRecoveryClaim,stringify} from './recovery';
import {recoveryWallet} from './wallet';
import type {Eip1193} from './wallet';
import type {ClaimJournal} from './journal';
import {RecoveryClaims} from './claims';
export interface ArtifactAcceptance{configurationDigest:Hex;manifestDigest:Hex;agreementCodeHash:Hex;finalityDigest:Hex;expiresAt:number;}
// Trusted application composition dependency, never populated by imported manifests/UI/URL.
export interface RecoveryArtifactVerifier{verify(config:RecoveryConfig,finality:ArcFinalityPolicy):Promise<ArtifactAcceptance>;}
export const unavailableArtifactVerifier:RecoveryArtifactVerifier=Object.freeze({verify:async()=>{throw Error('DEPLOYMENT_ARTIFACT_ACCEPTANCE_REQUIRED');}});
export function composeRecoveryClaims(config:RecoveryConfig,finality:ArcFinalityPolicy,provider:Eip1193,journal:ClaimJournal,artifacts:RecoveryArtifactVerifier=unavailableArtifactVerifier){
 const c=parseRecoveryConfig(stringify({schemaVersion:1,manifest:config.deployment,agreementCodeHash:config.agreementCodeHash,primaryRpcOrigin:config.primaryRpcOrigin,verificationRpcOrigin:config.verificationRpcOrigin})),f=Object.freeze({...finality});
 const client=(url:string)=>createPublicClient({ccipRead:false,transport:http(url,{retryCount:0,timeout:5000,fetchOptions:{credentials:'omit',redirect:'error'}})});
 const a=client(c.primaryRpcOrigin),b=client(c.verificationRpcOrigin);
 const wrap=(x:typeof a)=>({getChainId:()=>x.getChainId(),getBlock:(q:Parameters<typeof x.getBlock>[0])=>x.getBlock(q),getBytecode:(q:{address:Hex;blockNumber:bigint})=>x.getBytecode(q),readContract:(q:unknown)=>x.readContract(q as Parameters<typeof x.readContract>[0]),getTransaction:(q:{hash:Hex})=>x.getTransaction(q),getTransactionReceipt:(q:{hash:Hex})=>x.getTransactionReceipt(q)});
 const one=wrap(a),two=wrap(b);const named=[{id:keccak256(toHex(c.primaryRpcOrigin)),reader:one as CanonicalAttemptReader},{id:keccak256(toHex(c.verificationRpcOrigin)),reader:two as CanonicalAttemptReader}] as const;
 // Validates supported finality and distinct readers at composition, without network reads.
 createArcCanonicalAttemptRpc(f,named[0],named[1],async()=>null,async()=>null);
 const configurationDigest=keccak256(toHex(stringify({config:c,finality:f})));const policy={deployment:c.deployment,agreementCodeHash:c.agreementCodeHash,provenance:'OPERATOR_CONFIGURED' as const,contextHash:configurationDigest};const policyHash=keccak256(toHex(stringify(policy)));
 const reader=createRecoveryReader(policy,one as MinimalPublicClient,two as MinimalPublicClient);
 const verifyBusiness=createBusinessOutcomeVerifier({chainId:c.deployment.chainId,factory:c.deployment.factoryAddress!,token:c.deployment.allowlistedToken!,factoryCodeHash:c.deployment.expectedFactoryCodeHash!,tokenCodeHash:c.deployment.expectedTokenCodeHash!,policyHash},[one as FundingReader,two as FundingReader]);
 async function authorize(){const accepted=await artifacts.verify(c,f);if(accepted.configurationDigest!==configurationDigest||accepted.manifestDigest!==keccak256(toHex(stringify(c.deployment)))||accepted.agreementCodeHash!==c.agreementCodeHash||accepted.finalityDigest!==keccak256(toHex(stringify(f)))||!Number.isSafeInteger(accepted.expiresAt)||accepted.expiresAt<=Date.now()||accepted.expiresAt>Date.now()+86400000)throw Error('DEPLOYMENT_ACCEPTANCE_MISMATCH');}
 return new RecoveryClaims({wallet:recoveryWallet(provider),journal,authorize,prepare:async(action,address,manifest,wallet)=>prepareRecoveryClaim(await reader.inspect(address,manifest),wallet,action),nonce:async wallet=>{const request={address:wallet.account as Hex,blockTag:'pending' as const};const [x,y]=await Promise.all([a.getTransactionCount(request),b.getTransactionCount(request)]);if(x!==y||!Number.isSafeInteger(x)||x<0)throw Error('NETWORK_NONCE_DISAGREEMENT');return BigInt(x);},reconcile:async(p,hash)=>{if(p.source!=='OPERATOR_CONFIGURED'||p.policyHash!==policyHash||p.chainId!==String(c.deployment.chainId)||!['claim-provider','claim-client-refund'].includes(p.action))return{state:'conflicted'};const locate=async()=>hash??null;const rpc=createArcCanonicalAttemptRpc(f,named[0],named[1],locate,locate);return reconcileCanonical({source:'CONFIGURED_READ_ONLY',prepare:async()=>{throw Error('RECOVERY_ONLY');},rpc,verifyBusiness},p,hash);}});
}
