import {keccak256,sha256,toHex,encodeAbiParameters,parseAbiParameters,type Hex} from 'viem';
import {inspectDeploymentRecord} from './deployment-record.js';
import type {NoticeVaultDeployment} from '@noticevault/sdk';
import type {ArcFinalityPolicy} from './arc-finality.js';
export type ReviewedArtifactConfig=Readonly<{deployment:NoticeVaultDeployment;agreementCodeHash:Hex;primaryRpcOrigin:string;verificationRpcOrigin:string}>;
export interface RecoveryArtifactVerifier {verify(config:ReviewedArtifactConfig,finality:ArcFinalityPolicy):Promise<{configurationDigest:Hex;manifestDigest:Hex;agreementCodeHash:Hex;finalityDigest:Hex;expiresAt:number}>;}
export function stringify(value:unknown):string{return JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2);}

/** Bytes are supplied by trusted composition, never fetched using manifest URLs. */
export interface RecoveryArtifactBundle {
  review: Uint8Array; record: Uint8Array; build: Uint8Array;
  source: Uint8Array; lock: Uint8Array;
  evidence: Readonly<Record<string,Uint8Array>>;
}
/** Pin obtained independently of the bundle. No production pin ships with this app. */
export interface RecoveryReviewAnchor { readonly reviewSha256: Hex; }
type Obj = Record<string,unknown>;
const hashPattern = /^0x[0-9a-f]{64}$/;
const fail = (reason:string):never => { throw Error(`ARTIFACT_ACCEPTANCE_${reason}`); };
function requireThat(ok:unknown, reason:string):asserts ok { if (!ok) fail(reason); }
function object(value:unknown):Obj {
  requireThat(value && typeof value==='object' && !Array.isArray(value),'OBJECT');
  return value as Obj;
}
function exact(value:Obj, keys:string[]) {
  requireThat(Object.keys(value).length===keys.length && keys.every(k=>Object.hasOwn(value,k)),'SCHEMA');
}
function digest(bytes:Uint8Array):Hex { return sha256(bytes); }
function same(actual:unknown,expected:unknown,reason:string) { requireThat(actual===expected,reason); }
function bytes(value:Uint8Array,limit=4*1024*1024):Uint8Array {
  requireThat(value instanceof Uint8Array && value.byteLength>0 && value.byteLength<=limit,'BYTES');
  return new Uint8Array(value);
}
function text(value:Uint8Array):string {
  try { return new TextDecoder('utf-8',{fatal:true}).decode(value); } catch { return fail('UTF8'); }
}
// Canonical JSON format rejects duplicate keys, alternate encodings and ambiguity.
function json(value:Uint8Array):Obj {
  const raw=text(value); let result:unknown;
  try { result=JSON.parse(raw); } catch { return fail('JSON'); }
  requireThat(JSON.stringify(result)===raw,'NONCANONICAL_JSON');
  return object(result);
}
function code(value:unknown):Hex {
  requireThat(typeof value==='string' && /^0x(?:[0-9a-f]{2})+$/.test(value),'RUNTIME_BYTES');
  return value as Hex;
}

export function createReviewedArtifactVerifier(
  bundle:RecoveryArtifactBundle, anchor:RecoveryReviewAnchor,
):RecoveryArtifactVerifier {
  requireThat(anchor && hashPattern.test(anchor.reviewSha256),'REVIEW_ANCHOR_REQUIRED');
  const pinnedReview=anchor.reviewSha256;
  // Snapshot every byte before asynchronous use; caller mutations cannot swap proof.
  const reviewBytes=bytes(bundle.review,65536), recordBytes=bytes(bundle.record,65536);
  const buildBytes=bytes(bundle.build), sourceBytes=bytes(bundle.source), lockBytes=bytes(bundle.lock);
  const entries=Object.entries(bundle.evidence);
  requireThat(entries.length>0 && entries.length<=100,'EVIDENCE_COUNT');
  const evidence=new Map(entries.map(([id,value])=>[id,bytes(value,65536)]));
  return Object.freeze<RecoveryArtifactVerifier>({async verify(config,finality) {
    same(digest(reviewBytes),pinnedReview,'UNTRUSTED_REVIEW');
    const review=json(reviewBytes);
    exact(review,['schemaVersion','kind','configurationDigest','manifestDigest','finalityDigest',
      'agreementCodeHash','recordSha256','sourceSha256','issuedAt','expiresAt']);
    same(review.schemaVersion,1,'REVIEW_VERSION');
    same(review.kind,'RECOVERY_ARTIFACT_REVIEW','REVIEW_KIND');
    const now=Date.now();
    requireThat(Number.isSafeInteger(review.issuedAt) && Number.isSafeInteger(review.expiresAt) &&
      (review.issuedAt as number)<=now && (review.issuedAt as number)>=0 &&
      (review.expiresAt as number)>now && (review.expiresAt as number)-(review.issuedAt as number)<=86400000,
      'REVIEW_EXPIRED');
    const configurationDigest=keccak256(toHex(stringify({config,finality})));
    const manifestDigest=keccak256(toHex(stringify(config.deployment)));
    const finalityDigest=keccak256(toHex(stringify(finality)));
    same(review.configurationDigest,configurationDigest,'CONFIGURATION_BINDING');
    same(review.manifestDigest,manifestDigest,'MANIFEST_BINDING');
    same(review.finalityDigest,finalityDigest,'FINALITY_BINDING');
    same(review.agreementCodeHash,config.agreementCodeHash,'AGREEMENT_BINDING');
    same(digest(recordBytes),review.recordSha256,'RECORD_CHECKSUM');
    same(digest(sourceBytes),review.sourceSha256,'SOURCE_CHECKSUM');
    const assessment=inspectDeploymentRecord(text(recordBytes),config.deployment);
    requireThat(assessment.state==='RECORD_COMPLETE_UNVERIFIED','RECORD_INVALID');
    const record=object(JSON.parse(text(recordBytes)));
    const buildRecord=object(record.build), factory=object(record.factory), token=object(record.token);
    const verification=object(record.verification);
    const origins=record.rpcOrigins as string[];
    requireThat(origins.includes(config.primaryRpcOrigin) && origins.includes(config.verificationRpcOrigin),'RPC_BINDING');
    same(finality.network,config.deployment.configIdentity,'FINALITY_NETWORK');
    same(finality.chainId,config.deployment.chainId,'FINALITY_CHAIN');
    same(finality.kind,'COMMITTED_INCLUSION','FINALITY_KIND');
    same(finality.verification,'TWO_PROVIDERS','FINALITY_PROVIDERS');
    same(digest(buildBytes),buildRecord.artifactHash,'BUILD_CHECKSUM');
    same(digest(lockBytes),buildRecord.dependencyLockHash,'LOCK_CHECKSUM');
    const build=json(buildBytes);
    exact(build,['schemaVersion','sourceCommit','compiler','compilerSettings','dependencyLockHash',
      'factoryRuntime','tokenRuntime','agreementRuntime','factoryCreationCode','constructorArguments']);
    same(build.schemaVersion,1,'BUILD_VERSION');
    same(build.sourceCommit,buildRecord.sourceCommit,'SOURCE_COMMIT');
    same(build.compiler,buildRecord.compiler,'COMPILER');
    same(JSON.stringify(build.compilerSettings),JSON.stringify(buildRecord.compilerSettings),'COMPILER_SETTINGS');
    same(build.dependencyLockHash,buildRecord.dependencyLockHash,'BUILD_LOCK');
    same(keccak256(code(build.factoryRuntime)),factory.runtimeCodeHash,'FACTORY_RUNTIME');
    same(keccak256(code(build.tokenRuntime)),object(token.verificationEvidence).runtimeCodeHash,'TOKEN_RUNTIME');
    same(keccak256(code(build.agreementRuntime)),config.agreementCodeHash,'AGREEMENT_RUNTIME');
    const constructorArguments=encodeAbiParameters(parseAbiParameters('address,address,uint256,uint256'),[
      factory.guardian as Hex,token.address as Hex,BigInt(factory.factoryCapBaseUnits as string),
      BigInt(factory.agreementCapBaseUnits as string)]);
    same(build.constructorArguments,constructorArguments,'CONSTRUCTOR_ARGUMENTS');
    same(keccak256(constructorArguments),verification.constructorArgumentsHash,'CONSTRUCTOR_HASH');
    const deploymentInput=code(build.factoryCreationCode)+constructorArguments.slice(2);
    const references=record.evidence as Obj[];
    requireThat(references.length===evidence.size,'UNREFERENCED_EVIDENCE');
    const checked=new Map<string,Obj>();
    for (const reference of references) {
      const id=reference.id as string, supplied=evidence.get(id);
      requireThat(supplied,'MISSING_EVIDENCE');
      same(digest(supplied),reference.sha256,'EVIDENCE_CHECKSUM');
      const proof=json(supplied);
      same(proof.kind,reference.kind,'EVIDENCE_KIND');
      checked.set(id,proof);
    }
    const proof=(id:unknown):Obj=>{
      const value=checked.get(id as string); requireThat(value,'MISSING_REFERENCE'); return value;
    };
    const used=new Set([object(token.verificationEvidence).reference,verification.independentReviewReference,
      record.approvalRecord,...record.commands as string[],...record.externalActions as string[]]);
    requireThat(used.size===checked.size && [...used].every(id=>checked.has(id as string)),'UNUSED_REFERENCE');
    const tv=proof(object(token.verificationEvidence).reference);
    exact(tv,['kind','chainId','address','decimals','blockHash','runtimeCodeHash']);
    same(tv.chainId,record.chainId,'TOKEN_CHAIN'); same(tv.address,token.address,'TOKEN_ADDRESS');
    same(tv.decimals,token.decimals,'TOKEN_DECIMALS');
    same(tv.blockHash,token.verificationBlockHash,'TOKEN_BLOCK');
    same(tv.runtimeCodeHash,object(token.verificationEvidence).runtimeCodeHash,'TOKEN_CODE');
    const independent=proof(verification.independentReviewReference);
    exact(independent,['kind','sourceCommit','artifactHash','sourceSha256','compilerSettingsSha256']);
    same(independent.sourceCommit,buildRecord.sourceCommit,'REVIEW_COMMIT');
    same(independent.artifactHash,buildRecord.artifactHash,'REVIEW_BUILD');
    same(independent.sourceSha256,review.sourceSha256,'REVIEW_SOURCE');
    same(independent.compilerSettingsSha256,sha256(toHex(JSON.stringify(build.compilerSettings))),'REVIEW_SETTINGS');
    const approval=proof(record.approvalRecord);
    exact(approval,['kind','chainId','factory','configurationDigest','sourceCommit']);
    same(approval.chainId,record.chainId,'APPROVAL_CHAIN'); same(approval.factory,factory.address,'APPROVAL_FACTORY');
    same(approval.configurationDigest,configurationDigest,'APPROVAL_CONFIGURATION');
    same(approval.sourceCommit,buildRecord.sourceCommit,'APPROVAL_COMMIT');
    for (const id of record.commands as string[]) {
      const log=proof(id); exact(log,['kind','sourceCommit','command','exitCode']);
      same(log.sourceCommit,buildRecord.sourceCommit,'COMMAND_COMMIT'); same(log.exitCode,0,'COMMAND_FAILED');
      requireThat(typeof log.command==='string' && log.command.trim().length>0 && log.command.length<=4096,'COMMAND_REQUIRED');
    }
    for (const id of record.externalActions as string[]) {
      const receipt=proof(id);
      exact(receipt,['kind','chainId','factory','transactionHash','blockNumber','blockHash','status','runtimeCodeHash','transactionInput']);
      same(receipt.chainId,record.chainId,'RECEIPT_CHAIN'); same(receipt.factory,factory.address,'RECEIPT_FACTORY');
      same(receipt.transactionHash,factory.deploymentTransactionHash,'RECEIPT_TRANSACTION');
      same(receipt.blockNumber,factory.creationBlock,'RECEIPT_BLOCK');
      requireThat(typeof receipt.blockHash==='string' && hashPattern.test(receipt.blockHash) && !/^0x0+$/.test(receipt.blockHash),'RECEIPT_BLOCK_HASH');
      same(receipt.transactionInput,deploymentInput,'DEPLOYMENT_INPUT');
      same(receipt.status,'success','RECEIPT_FAILED');
      same(receipt.runtimeCodeHash,factory.runtimeCodeHash,'RECEIPT_RUNTIME');
    }
    return Object.freeze({configurationDigest,manifestDigest,finalityDigest,
      agreementCodeHash:config.agreementCodeHash,expiresAt:review.expiresAt as number});
  }});
}
