/** Explicit read-only composition. No endpoint, signer, executor or credential loader. */
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {keccak256,erc20Abi} from 'viem';
import type {Hex} from 'viem';
import {FACTORY_ABI} from '@noticevault/sdk';
import type {MinimalPublicClient,NoticeVaultDeployment,WalletContext} from '@noticevault/sdk';
import type {ApiConfig} from './config.js';
import {parseArcManifest} from './deployment-manifest.js';
import {inspectDeploymentRecord} from './deployment-record.js';
import {createArcCanonicalAttemptRpc} from './arc-finality.js';
import type {ArcFinalityPolicy} from './arc-finality.js';
import type {CanonicalAttemptReader} from './canonical-attempt-rpc.js';
import {createApprovalOutcomeVerifier} from './approval-outcome.js';
import type {ApprovalReader} from './approval-outcome.js';
import {createNoticeOutcomeVerifier} from './notice-outcome.js';
import {createFundingOutcomeVerifier} from './funding-outcome.js';
import type {FundingReader} from './funding-outcome.js';
import {createBusinessOutcomeVerifier} from './business-outcome.js';
import type {SyntheticAttemptAdapter} from './attempt-evidence.js';
import type {SyntheticConsentAdapter} from './routes/creation-preparation.js';
import type {SyntheticAuthProvider} from './auth/pinned-verifier.js';
export type RuntimeReader=MinimalPublicClient&CanonicalAttemptReader&FundingReader&ApprovalReader&{getBlockNumber():Promise<unknown>};
export type RuntimeInputs=Readonly<{manifestText:string;recordText:string;provenance:'SYNTHETIC'|'OPERATOR_CONFIGURED';finality:ArcFinalityPolicy;primary:Readonly<{id:string;reader:RuntimeReader}>;verification:Readonly<{id:string;reader:RuntimeReader}>;readArtifact:(id:string)=>Promise<Uint8Array>;readWallet:()=>Promise<WalletContext>;windowSize?:number}>;
export type ConfiguredRuntime=Readonly<{deployment:NoticeVaultDeployment;policyHash:string;auth:SyntheticAuthProvider;consent:SyntheticConsentAdapter;attempts:SyntheticAttemptAdapter;report:Readonly<{state:'READ_ONLY_COMPOSED';executionEnabled:false;runtimeVerified:false;provenance:RuntimeInputs['provenance'];diagnostics:readonly string[]}>}>;
const issued=new WeakSet<object>(),adapters=new WeakSet<object>();
export function isConfiguredAdapter(v:unknown):boolean{return !!v&&typeof v==='object'&&adapters.has(v);}
export function assertConfiguredRuntime(v:ConfiguredRuntime,cfg:ApiConfig):void {if(!issued.has(v)||(v.report.provenance==='SYNTHETIC'&&Reflect.get(process.env,'NODE_ENV')!=='test')||cfg.configIdentity!==v.deployment.configIdentity||!cfg.consentDeployment||!isDeepStrictEqual(cfg.consentDeployment,v.deployment))throw new Error('CONFIGURED_RUNTIME_BINDING_REQUIRED');}
const HASH=/^0x[0-9a-f]{64}$/i,ADDRESS=/^0x[0-9a-f]{40}$/i;
const fail=(code:string):never=>{throw new Error(code);};
async function bounded<T>(work:Promise<T>):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('RUNTIME_EVIDENCE_TIMEOUT')),5000);})]);}finally{if(timer)clearTimeout(timer);}}
export async function composeReadOnlyRuntime(input:RuntimeInputs):Promise<ConfiguredRuntime>{
 if(input.provenance==='SYNTHETIC'&&Reflect.get(process.env,'NODE_ENV')!=='test')return fail('SYNTHETIC_RUNTIME_REQUIRES_TEST_CONSTRUCTION');
 const deployment=parseArcManifest(input.manifestText),assessment=inspectDeploymentRecord(input.recordText,deployment);
 if(assessment.state!=='RECORD_COMPLETE_UNVERIFIED')return fail('DEPLOYMENT_RECORD_REQUIRED_OR_INVALID');
 if(!['SYNTHETIC','OPERATOR_CONFIGURED'].includes(input.provenance))return fail('RUNTIME_PROVENANCE_REQUIRED');
 const record=JSON.parse(input.recordText) as {evidence:Array<{id:string;sha256:string}>;rpcOrigins:string[]};
 if(input.finality.network!==deployment.configIdentity||input.finality.chainId!==deployment.chainId)return fail('FINALITY_DEPLOYMENT_MISMATCH');
 const finality=Object.freeze({...input.finality}),size=input.windowSize??1000;
 if(!Number.isSafeInteger(size)||size<1||size>1000)return fail('INVALID_DISCOVERY_WINDOW');
 if(input.primary.reader===input.verification.reader||input.primary.id===input.verification.id)return fail('INDEPENDENT_READERS_REQUIRED');
 if(input.provenance==='OPERATOR_CONFIGURED'&&(input.primary.id!==record.rpcOrigins[0]||input.verification.id!==record.rpcOrigins[1]))return fail('PROVIDER_ORIGIN_BINDING_REQUIRED');
 const methods=['getChainId','getBlockNumber','getBlock','getBytecode','readContract','getTransaction','getTransactionReceipt'] as const;
 const snapshot=(reader:RuntimeReader)=>Object.freeze(Object.fromEntries(methods.map(k=>{if(typeof reader[k]!=='function')return fail('RUNTIME_READER_METHOD_REQUIRED');return [k,reader[k].bind(reader)];}))) as unknown as RuntimeReader;
 const primary=Object.freeze({id:input.primary.id,reader:snapshot(input.primary.reader)}),verification=Object.freeze({id:input.verification.id,reader:snapshot(input.verification.reader)});
 const rpc=createArcCanonicalAttemptRpc(finality,primary,verification,async()=>null);
 for(const entry of record.evidence){const bytes=await bounded(input.readArtifact(entry.id));if(!(bytes instanceof Uint8Array)||bytes.byteLength===0||bytes.byteLength>16*1024*1024||'0x'+createHash('sha256').update(bytes).digest('hex')!==entry.sha256.toLowerCase())return fail('ARTIFACT_BYTES_MISMATCH');}
 const policyHash='0x'+createHash('sha256').update(JSON.stringify({deployment,recordHash:assessment.recordHash,finality},(_k,v)=>typeof v==='bigint'?v.toString():v)).digest('hex');
 async function pair<K extends keyof RuntimeReader>(method:K,args:unknown[]):Promise<unknown>{
  const invoke=(reader:RuntimeReader)=>Reflect.apply(reader[method] as (...a:unknown[])=>Promise<unknown>,reader,args);
  const [a,b]=await bounded(Promise.all([invoke(primary.reader),invoke(verification.reader)]));if(!isDeepStrictEqual(a,b))return fail('RUNTIME_PROVIDER_DISAGREEMENT');return a;
 }
 const paired=Object.freeze(Object.fromEntries(['getChainId','getBlockNumber','getBlock','getBytecode','readContract','getTransaction','getTransactionReceipt'].map(k=>[k,(...args:unknown[])=>pair(k as keyof RuntimeReader,args)]))) as unknown as RuntimeReader;
 await rpc.getChainId();const head=await paired.getBlock({blockTag:'latest'});
 if(typeof head.number!=='bigint'||head.number<0n||!HASH.test(head.hash)||typeof head.timestamp!=='bigint'||head.timestamp<BigInt(Math.floor(Date.now()/1000))-7200n||head.timestamp>BigInt(Math.floor(Date.now()/1000))+30n)return fail('INVALID_RUNTIME_BLOCK');
 const blockNumber=head.number;
 for(const [address,expected] of [[deployment.factoryAddress,deployment.expectedFactoryCodeHash],[deployment.allowlistedToken,deployment.expectedTokenCodeHash]] as const){
  const code=await paired.getBytecode({address:address as Hex,blockNumber});if(typeof code!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(code)||keccak256(code as Hex).toLowerCase()!==expected?.toLowerCase())return fail('RUNTIME_CODE_MISMATCH');
 }
 const token=await paired.readContract({address:deployment.factoryAddress as Hex,abi:FACTORY_ABI,functionName:'token',args:[],blockNumber});
 const decimals=await paired.readContract({address:deployment.allowlistedToken as Hex,abi:erc20Abi,functionName:'decimals',args:[],blockNumber});
 if(typeof token!=='string'||token.toLowerCase()!==deployment.allowlistedToken?.toLowerCase()||(decimals!==6&&decimals!==6n))return fail('RUNTIME_TOKEN_MISMATCH');
 const end=await paired.getBlock({blockNumber});if(end.number!==blockNumber||end.hash.toLowerCase()!==head.hash.toLowerCase())return fail('RUNTIME_CANONICAL_CHANGE');await rpc.getChainId();
 const readWallet=input.readWallet;
 const consent:SyntheticConsentAdapter=Object.freeze({deployment,rpc:paired,source:input.provenance==='SYNTHETIC'?'SYNTHETIC' as const:'CONFIGURED_READ_ONLY' as const,readWallet:async()=>{const w=await readWallet();if(!w||typeof w.account!=='string'||!ADDRESS.test(w.account)||BigInt(w.account)===0n||w.chainId!==deployment.chainId)return fail('WALLET_CONTEXT_MISMATCH');return Object.freeze({...w});}});
 const auth:SyntheticAuthProvider=Object.freeze({chainId:deployment.chainId,rpc:paired});
 const policy=Object.freeze({chainId:deployment.chainId,factory:deployment.factoryAddress!,token:deployment.allowlistedToken!,factoryCodeHash:deployment.expectedFactoryCodeHash!,tokenCodeHash:deployment.expectedTokenCodeHash!,policyHash});
 const attempts:SyntheticAttemptAdapter=Object.freeze({source:'CONFIGURED_READ_ONLY' as const,prepare:async()=>fail('EXECUTION_DISABLED'),rpc,discovery:Object.freeze({policy:finality,policyHash,primary,verification,windowSize:size}),verifyApproval:createApprovalOutcomeVerifier(policy,[primary.reader,verification.reader]),verifyNotice:createNoticeOutcomeVerifier(policy,[primary.reader,verification.reader]),verifyFunding:createFundingOutcomeVerifier(policy,[primary.reader,verification.reader]),verifyBusiness:createBusinessOutcomeVerifier(policy,[primary.reader,verification.reader])});
 const runtime:ConfiguredRuntime=Object.freeze({deployment,policyHash,auth,consent,attempts,report:Object.freeze({state:'READ_ONLY_COMPOSED',executionEnabled:false,runtimeVerified:false,provenance:input.provenance,diagnostics:Object.freeze(['SIGNING_AND_EXECUTION_DISABLED','BUILD_ARTIFACT_AND_DEPLOYMENT_ACCEPTANCE_NOT_ESTABLISHED'])})});
 for(const a of [auth,consent,attempts])adapters.add(a);issued.add(runtime);return runtime;
}
