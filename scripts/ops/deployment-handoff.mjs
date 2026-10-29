// @ts-check
import {readFileSync,writeFileSync,statSync} from 'node:fs';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';import {encodeDeployData,keccak256} from 'viem';
import {preflight,inspectArtifacts,validatePlan,parsePlan} from './preflight.mjs';
/** @param {unknown} x */
const stringify=x=>{const text=JSON.stringify(x,(_,/** @type {unknown} */v)=>typeof v==='bigint'?v.toString():v);if(typeof text!=='string')throw Error('HANDOFF_INVALID_VALUE');return text;};
/** @param {string|Uint8Array} x */
const hash=x=>createHash('sha256').update(x).digest('hex');
/** @param {Parameters<typeof preflight>[0]} input */
export async function prepareDeploymentHandoff(input){
 const check=await preflight(input),plan=parsePlan(/** @type {unknown} */(JSON.parse(new TextDecoder().decode(input.bytes)))),{artifact}=inspectArtifacts(plan,input.root),caps=validatePlan(plan);
 const data=encodeDeployData({abi:artifact.abi,bytecode:artifact.bytecode.object,args:[plan.guardian,plan.token,caps.factory,caps.agreement]});
 if(keccak256(data)!==check.initCodeKeccak)throw Error('HANDOFF_BYTECODE_MISMATCH');
 const createdAt=input.now??Date.now();if(!Number.isSafeInteger(createdAt)||createdAt<0)throw Error('HANDOFF_INVALID_TIME');const artifactBody={format:'NOTICEVAULT_UNSIGNED_DEPLOYMENT_V1',purpose:'PREPARE_ONLY_NO_BROADCAST',reviewSha256:input.reviewSha256,sourceHead:check.sourceHead,artifactSha256:check.artifactSha256,createdAt,expiresAt:createdAt+300000,transaction:{chainId:plan.chainId,from:plan.signer,to:null,data,value:'0'},constructorArgs:check.constructorArgs,initCodeKeccak:check.initCodeKeccak,observedBlock:check.chain.block,requiredBeforeExecution:['EXPLICIT_NETWORK_SIGNER_FUNDS_DEPLOYMENT_AUTHORITY','SIGNER_CONTROL_AND_CURRENT_NONCE_GAS_REVIEW','FRESH_EXACT_PLAN_PREFLIGHT','INDEPENDENT_RECEIPT_RUNTIME_AND_CONSTRUCTOR_VERIFICATION'],executionEnabled:false};
 return {artifact:artifactBody,sha256:hash(stringify(artifactBody)),checksumMeaning:'INTEGRITY_ONLY_NOT_AUTHORITY'};
}
/** @param {unknown} value @returns {Record<string,unknown>} */
function record(value){if(!value||typeof value!=='object'||Array.isArray(value))throw Error('HANDOFF_INTEGRITY_FAILED');return /** @type {Record<string,unknown>} */(value);}
/** @param {unknown} value @param {Parameters<typeof preflight>[0]} input */
export async function validateDeploymentHandoff(value,input){
 const bundle=record(value);

 if(!bundle||Object.keys(bundle).sort().join()!=='artifact,checksumMeaning,sha256'||bundle.checksumMeaning!=='INTEGRITY_ONLY_NOT_AUTHORITY'||hash(stringify(bundle.artifact))!==bundle.sha256)throw Error('HANDOFF_INTEGRITY_FAILED');
 const now=input.now??Date.now(),a=record(bundle.artifact);if(typeof a.createdAt!=='number'||typeof a.expiresAt!=='number'||!Number.isSafeInteger(a.createdAt)||a.createdAt>now||a.expiresAt!==a.createdAt+300000||a.expiresAt<now)throw Error('HANDOFF_EXPIRED_OR_INVALID_TIME');
 const fresh=await prepareDeploymentHandoff(input);const normalized={...fresh.artifact,createdAt:a.createdAt,expiresAt:a.expiresAt};
 if(stringify(normalized)!==stringify(a))throw Error('HANDOFF_PLAN_OR_TRANSACTION_MISMATCH');
 // Fresh preflight independently verifies current chain. Old observation is evidence, never execution authority.
 return {status:'VALID_UNSIGNED_HANDOFF_EXECUTION_BLOCKED',reviewSha256:fresh.artifact.reviewSha256,initCodeKeccak:fresh.artifact.initCodeKeccak,freshObservedBlock:fresh.artifact.observedBlock,executionEnabled:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{
 const [mode,planFile,pin,file]=process.argv.slice(2);if(mode==='--help'){console.log('prepare PLAN REVIEW_SHA256 NEW_OUTPUT | validate PLAN REVIEW_SHA256 HANDOFF. No signing, wallet, nonce selection or broadcast capability.');}
 else{if(!['prepare','validate'].includes(mode)||!planFile||!file||statSync(planFile).size>32768)throw Error('EXPLICIT_INPUTS_REQUIRED');const input={bytes:readFileSync(planFile),reviewSha256:pin};
 if(mode==='prepare'){const bundle=await prepareDeploymentHandoff(input);writeFileSync(file,stringify(bundle),{flag:'wx',mode:0o600});console.log('UNSIGNED_HANDOFF_SAVED_EXECUTION_BLOCKED');}
 else{if(statSync(file).size>1000000)throw Error('HANDOFF_LIMIT');console.log(stringify(await validateDeploymentHandoff(/** @type {unknown} */(JSON.parse(readFileSync(file,'utf8'))),input)));}}
 }catch(e){console.error(e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'HANDOFF_BLOCKED');process.exitCode=1;}}
