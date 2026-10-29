import {createEvidenceCollector} from './evidence-bundle.js';
import {prepareOperatorAgreementAction} from './operator-renewal.js';
/** Exact creation approval composition. No server signer or automatic broadcaster. */
import {isDeepStrictEqual} from 'node:util';
import {encodeFunctionData,encodeAbiParameters,parseAbiParameters,keccak256,toHex,type Address,type Hex} from 'viem';
import type pg from 'pg';
import {observeFactoryForCreation,prepareApproveForCreation,parseTerms,draftCreationBinding,prepareBoundDraftCreation,computeTermsDigest} from '@noticevault/sdk';
import type {SerializedTerms} from '@noticevault/sdk';
import {composeReadOnlyRuntime,assertConfiguredRuntime,type RuntimeInputs} from './configured-runtime.js';
import type {ApiConfig} from './config.js';
import type {SyntheticAttemptAdapter,AttemptInput,AttemptPreparation} from './attempt-evidence.js';
import {createReviewedArtifactVerifier,type RecoveryArtifactBundle,type RecoveryReviewAnchor} from './reviewed-artifacts.js';
import type {ReviewedArtifactConfig as RecoveryConfig} from './reviewed-artifacts.js';
import {stringify} from './reviewed-artifacts.js';
const issued=new WeakSet<object>();
const artifactGuards=new WeakMap<object,()=>Promise<void>>();
export async function assertOperatorArtifacts(adapter:object){const guard=artifactGuards.get(adapter);if(!guard)throw Error('Reviewed operator composition required');await guard();}
const bindings=new WeakMap<object,{cfg:ApiConfig;pool:pg.Pool;runtime:unknown}>();
export function assertOperatorApprovalBinding(value:object,cfg:ApiConfig,pool:pg.Pool,runtime:unknown){const b=bindings.get(value);if(!b||!isDeepStrictEqual(b.cfg,cfg)||b.pool!==pool||b.runtime!==runtime)throw Error("Operator runtime binding mismatch");}
export function isOperatorApprovalAdapter(value:unknown){return !!value&&typeof value==='object'&&issued.has(value);}
export type OperatorApprovalInputs={runtime:RuntimeInputs;cfg:ApiConfig;pool:pg.Pool;config:RecoveryConfig;bundle:RecoveryArtifactBundle;anchor:RecoveryReviewAnchor};
export async function composeOperatorApproval(input:OperatorApprovalInputs){
 const runtime=await composeReadOnlyRuntime(input.runtime);assertConfiguredRuntime(runtime,input.cfg);
 const config=structuredClone(input.config),verifier=createReviewedArtifactVerifier(input.bundle,input.anchor);
 const digest=(v:unknown)=>keccak256(toHex(stringify(v)));
 const accept=async()=>{const p=await verifier.verify(config,input.runtime.finality);if(!isDeepStrictEqual(config.deployment,runtime.deployment)||p.configurationDigest!==digest({config,finality:input.runtime.finality})||p.manifestDigest!==digest(runtime.deployment)||p.finalityDigest!==digest(input.runtime.finality)||p.agreementCodeHash!==config.agreementCodeHash||p.expiresAt<=Date.now())throw Error('OPERATOR_ARTIFACT_BINDING_REQUIRED');};
 if(new TextDecoder().decode(input.bundle.record)!==input.runtime.recordText)throw Error('Reviewed runtime record mismatch');
 await accept();
 const schema=input.cfg.db.schema;if(!/^[a-z][a-z0-9_]*$/.test(schema))throw Error('Invalid schema');
 const load=async(i:AttemptInput)=>{
  const id=i.resource.slice(6);if(!['approve-creation','create-agreement'].includes(i.action)||!/^draft:[0-9a-f-]{36}$/i.test(i.resource))throw Error('Only creation approval is configured');
  const result=await input.pool.query(`SELECT version,status,doc_hash,terms_json FROM ${schema}.terms_drafts WHERE id=$1 AND workspace_id=$2`,[id,i.workspaceId]);
  const row=result.rows[0];if(!row)throw Error('Draft unavailable');
  const terms=parseTerms({...row.terms_json as SerializedTerms,schemaVersion:String(row.terms_json.schemaVersion)});
  if(terms.client.toLowerCase()!==i.actor.toLowerCase()||terms.token.toLowerCase()!==runtime.deployment.allowlistedToken?.toLowerCase()||terms.termsDocumentHash.toLowerCase()!==row.doc_hash.toLowerCase()||i.chainId!==String(runtime.deployment.chainId))throw Error('Exact draft client, chain and document required');
  return {terms,version:row.version,documentHash:row.doc_hash,status:row.status};
 };
 const nonce=async(actor:Address)=>{
  const values=await Promise.all([input.runtime.primary.reader,input.runtime.verification.reader].flatMap(reader=>['latest','pending'].map(async blockTag=>{
   const rpc=reader as unknown as {getTransactionCount:(p:{address:Address;blockTag:string})=>Promise<unknown>};
   if(typeof rpc.getTransactionCount!=='function')throw Error('Canonical nonce reader required');
   const n=await rpc.getTransactionCount({address:actor,blockTag});if((typeof n!=='number'&&typeof n!=='bigint')||(typeof n==='number'&&!Number.isSafeInteger(n))||BigInt(n)<0n||BigInt(n)>=(1n<<64n))throw Error('Invalid nonce');return String(n);
  })));if(values.some(n=>n!==values[0]))throw Error('Nonce disagreement or pending transaction');return values[0]!;
 };
 const creationSnapshot=async(i:AttemptInput)=>{
  const d=await load(i),proof=(await input.pool.query('SELECT signature_hex,terms_digest,chain_id FROM '+schema+'.accepted_consents WHERE draft_id=$1 AND workspace_id=$2 AND lower(signer_address)=lower($3)',[i.resource.slice(6),i.workspaceId,d.terms.provider])).rows[0];
  if(!proof||proof.terms_digest.toLowerCase()!==computeTermsDigest(d.terms,runtime.deployment).toLowerCase()||String(proof.chain_id)!==i.chainId)throw Error('Current accepted provider consent required');
  return {workspaceId:i.workspaceId,draftId:i.resource.slice(6),version:d.version,docHash:d.documentHash,status:d.status,terms:d.terms,signature:proof.signature_hex as Hex};
 };
 const adapter:SyntheticAttemptAdapter=Object.freeze({...runtime.attempts,source:'CONFIGURED_EXECUTION' as const,async prepare(i:AttemptInput):Promise<AttemptPreparation>{
  await accept();if(['approve-renewal','fund-renewal','start-notice','materialize-notice','claim-provider','claim-client-refund'].includes(i.action))return prepareOperatorAgreementAction(i,{pool:input.pool,schema,runtime,agreementCodeHash:config.agreementCodeHash,nonce});const draft=await load(i),actor=i.actor as Address,wallet={account:actor,chainId:runtime.deployment.chainId};
  if(i.action==='create-agreement'){
   const snapshot=await creationSnapshot(i),binding=draftCreationBinding(snapshot,runtime.deployment);
   const prepared=await prepareBoundDraftCreation(binding,{deployment:runtime.deployment,rpc:runtime.consent.rpc,readWallet:async()=>wallet,loadCurrent:()=>creationSnapshot(i)});
   const networkNonce=await nonce(actor);if(draftCreationBinding(await creationSnapshot(i),runtime.deployment)!==binding)throw Error('Draft changed during creation preparation');
   const t=snapshot.terms,termsHash=keccak256(encodeAbiParameters(parseAbiParameters('uint32,address,address,address,uint256,uint64,uint64,uint64,uint256,uint64,bytes32'),[t.schemaVersion,t.client as Hex,t.provider as Hex,t.token as Hex,t.amountPerPeriod,t.periodSeconds,t.noticeSeconds,t.startAt,t.clientNonce,t.acceptanceDeadline,t.termsDocumentHash as Hex]));
   return {...i,source:'OPERATOR_CONFIGURED',policyHash:runtime.policyHash,cycleKey:binding,networkNonce,target:prepared.request.to,data:encodeFunctionData({abi:prepared.request.abi,functionName:prepared.request.functionName,args:prepared.request.args}),value:'0',issuedAt:Date.now(),discoveryAnchor:{blockNumber:String(prepared.blockNumber),blockHash:prepared.blockHash},creation:{draftVersion:snapshot.version,docHash:snapshot.docHash},business:{termsHash,agreementCodeHash:config.agreementCodeHash,termsDigest:computeTermsDigest(t,runtime.deployment)}};
  }
  const observation=await observeFactoryForCreation(runtime.consent.rpc,runtime.deployment,actor,draft.terms.clientNonce,draft.terms);
  if(observation.status!=='ok'||!observation.requestedTerms)throw Error('Factory evidence unavailable');
  const tx=prepareApproveForCreation(runtime.deployment,observation,actor,0n,wallet);
  const n=await nonce(actor),again=await load(i);
  if(!isDeepStrictEqual(draft,again))throw Error('Draft changed during preparation');
  const data=encodeFunctionData({abi:tx.abi,functionName:tx.functionName,args:tx.args});
  return {...i,source:'OPERATOR_CONFIGURED',policyHash:runtime.policyHash,cycleKey:digest({draft:i.resource,version:draft.version,document:draft.documentHash,nonce:String(draft.terms.clientNonce)}),networkNonce:n,target:tx.to,data,value:'0',issuedAt:Date.now(),discoveryAnchor:{blockNumber:String(observation.block.blockNumber),blockHash:observation.block.blockHash},approval:{spender:String(tx.args[0]),amount:String(tx.args[1])}};
 }});issued.add(adapter);artifactGuards.set(adapter,accept);bindings.set(adapter,{cfg:structuredClone(input.cfg),pool:input.pool,runtime});const evidence=createEvidenceCollector({config:input.config,bundle:input.bundle,anchor:input.anchor,finality:input.runtime.finality,provenance:input.runtime.provenance,primary:input.runtime.primary,verification:input.runtime.verification});return Object.freeze({runtime,adapter,evidence});
}
