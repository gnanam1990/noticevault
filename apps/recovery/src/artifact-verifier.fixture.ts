// Synthetic test material only; never a production review anchor.
import {keccak256,sha256,toHex,encodeAbiParameters,parseAbiParameters} from 'viem';
import {deploymentRecordFixture} from '../../api/src/test/deployment-record-fixture';
import {agreementFixture} from './fixture';
import {parseRecoveryConfig} from './config';
import {stringify} from './recovery';
import type {RecoveryArtifactBundle} from './artifact-verifier';
export const encoded=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));
export const decoded=(value:Uint8Array)=>JSON.parse(new TextDecoder().decode(value)) as Record<string,unknown>;
export function artifactFixture() {
  const dep=agreementFixture().dep;
  const config=parseRecoveryConfig(stringify({schemaVersion:1,manifest:dep,agreementCodeHash:keccak256('0x6002'),
    primaryRpcOrigin:'https://primary.example',verificationRpcOrigin:'https://verification.example'}));
  const finality={network:'ARC_TESTNET' as const,chainId:5042002n,kind:'COMMITTED_INCLUSION' as const,verification:'TWO_PROVIDERS' as const};
  const configurationDigest=keccak256(toHex(stringify({config,finality})));
  const {record}=deploymentRecordFixture();
  const source=encoded({syntheticSource:'fixture',commit:record.build.sourceCommit});
  const lock=encoded({syntheticLock:'fixture'});
  const build={schemaVersion:1,sourceCommit:record.build.sourceCommit,compiler:record.build.compiler,
    compilerSettings:record.build.compilerSettings,dependencyLockHash:sha256(lock),
    factoryRuntime:'0x60006000',tokenRuntime:'0x60016001',agreementRuntime:'0x6002',factoryCreationCode:'0x60036004',
    constructorArguments:encodeAbiParameters(parseAbiParameters('address,address,uint256,uint256'),[
      record.factory.guardian as `0x${string}`,record.token.address as `0x${string}`,
      BigInt(record.factory.factoryCapBaseUnits),BigInt(record.factory.agreementCapBaseUnits)])};
  record.verification.constructorArgumentsHash=keccak256(build.constructorArguments);
  record.rpcOrigins=[config.primaryRpcOrigin,config.verificationRpcOrigin];
  record.factory.runtimeCodeHash=dep.expectedFactoryCodeHash!;
  record.token.verificationEvidence.runtimeCodeHash=dep.expectedTokenCodeHash!;
  record.build.dependencyLockHash=sha256(lock); record.build.artifactHash=sha256(encoded(build));
  const proofs:Record<string,Record<string,unknown>>={
    'token-proof':{kind:'TOKEN_VERIFICATION',chainId:record.chainId,address:record.token.address,decimals:6,
      blockHash:record.token.verificationBlockHash,runtimeCodeHash:dep.expectedTokenCodeHash},
    review:{kind:'INDEPENDENT_REVIEW',sourceCommit:record.build.sourceCommit,artifactHash:record.build.artifactHash,
      sourceSha256:sha256(source),compilerSettingsSha256:sha256(toHex(JSON.stringify(build.compilerSettings)))},
    approval:{kind:'APPROVAL',chainId:record.chainId,factory:record.factory.address,configurationDigest,sourceCommit:record.build.sourceCommit},
    'command-log':{kind:'COMMAND_LOG',sourceCommit:record.build.sourceCommit,command:'synthetic fixture only',exitCode:0},
    deployment:{kind:'DEPLOYMENT_RECEIPT',chainId:record.chainId,factory:record.factory.address,
      transactionHash:record.factory.deploymentTransactionHash,blockNumber:record.factory.creationBlock,
      blockHash:record.token.verificationBlockHash,status:'success',runtimeCodeHash:record.factory.runtimeCodeHash,
      transactionInput:build.factoryCreationCode+build.constructorArguments.slice(2)},
  };
  const bundle:RecoveryArtifactBundle={review:encoded({}),record:encoded(record),build:encoded(build),source,lock,evidence:{}};
  const review={schemaVersion:1,kind:'RECOVERY_ARTIFACT_REVIEW',configurationDigest,
    manifestDigest:keccak256(toHex(stringify(config.deployment))),finalityDigest:keccak256(toHex(stringify(finality))),
    agreementCodeHash:config.agreementCodeHash,recordSha256:'',sourceSha256:sha256(source),issuedAt:Date.now()-1000,expiresAt:Date.now()+60000};
  // Resealing represents an independent reviewer solely in synthetic negative tests.
  function seal() {
    bundle.build=encoded(build); record.build.artifactHash=sha256(bundle.build);
    bundle.evidence=Object.fromEntries(Object.entries(proofs).map(([id,p])=>[id,encoded(p)]));
    record.evidence=record.evidence.map(ref=>({...ref,sha256:sha256(bundle.evidence[ref.id]!)}));
    bundle.record=encoded(record); review.recordSha256=sha256(bundle.record); bundle.review=encoded(review);
    return {reviewSha256:sha256(bundle.review)};
  }
  const anchor=seal();
  return {config,finality,bundle,anchor,record,build,proofs,review,seal};
}
