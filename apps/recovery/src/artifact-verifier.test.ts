import {afterEach,describe,it,expect,vi} from 'vitest';
import {sha256,keccak256,toHex} from 'viem';
import {createReviewedArtifactVerifier} from './artifact-verifier';
import {artifactFixture,encoded,decoded} from './artifact-verifier.fixture';
import {trustedArtifactVerifier} from './trusted-artifacts';
import {trustedConfigText,trustedFinalityPolicy} from './trusted-config';
import {stringify} from './recovery';
afterEach(()=>vi.useRealTimers());
describe('reviewed artifact acceptance (synthetic bytes only)',()=>{
  it('accepts exact bytes bound to independent pin without any network call',async()=>{
    const f=artifactFixture(), fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('network forbidden'));
    try {
      const result=await createReviewedArtifactVerifier(f.bundle,f.anchor).verify(f.config,f.finality);
      expect(result.configurationDigest).toBe(keccak256(toHex(stringify({config:f.config,finality:f.finality}))));
      expect(result.manifestDigest).toBe(f.review.manifestDigest);
      expect(result.agreementCodeHash).toBe(f.config.agreementCodeHash);
      expect(result.expiresAt).toBe(f.review.expiresAt); expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it('requires an external anchor, never self-trusts a complete manifest',()=>{
    const f=artifactFixture();
    expect(()=>createReviewedArtifactVerifier(f.bundle,undefined as never)).toThrow('REVIEW_ANCHOR_REQUIRED');
  });
  it.each(['review','record','build','source','lock'] as const)('rejects altered %s bytes',async key=>{
    const f=artifactFixture(); f.bundle[key]=encoded({forged:key});
    await expect(createReviewedArtifactVerifier(f.bundle,f.anchor).verify(f.config,f.finality)).rejects.toThrow('ARTIFACT_ACCEPTANCE');
  });
  it.each(['token-proof','review','approval','command-log','deployment'])('rejects altered evidence %s',async id=>{
    const f=artifactFixture(); f.bundle.evidence={...f.bundle.evidence,[id]:encoded({forged:true})};
    await expect(createReviewedArtifactVerifier(f.bundle,f.anchor).verify(f.config,f.finality)).rejects.toThrow('EVIDENCE_CHECKSUM');
  });
  it('rejects a forged self-consistent chain of checksums against the actual pin',async()=>{
    const f=artifactFixture(); f.proofs.deployment!.transactionHash='0x'+'ff'.repeat(32); f.seal();
    await expect(createReviewedArtifactVerifier(f.bundle,f.anchor).verify(f.config,f.finality)).rejects.toThrow('UNTRUSTED_REVIEW');
  });
  it('rejects missing referenced bytes even when the entry count is unchanged',async()=>{
    const f=artifactFixture(); const copy={...f.bundle.evidence}; delete copy.deployment; copy.other=encoded({}); f.bundle.evidence=copy;
    await expect(createReviewedArtifactVerifier(f.bundle,f.anchor).verify(f.config,f.finality)).rejects.toThrow('MISSING_EVIDENCE');
  });
  it('rejects extra unreferenced bytes',async()=>{
    const f=artifactFixture(); f.bundle.evidence={...f.bundle.evidence,extra:encoded({})};
    await expect(createReviewedArtifactVerifier(f.bundle,f.anchor).verify(f.config,f.finality)).rejects.toThrow('UNREFERENCED_EVIDENCE');
  });
  it.each([
    ['deployment','transactionHash','0x'+'ff'.repeat(32),'RECEIPT_TRANSACTION'],
    ['deployment','chainId','1','RECEIPT_CHAIN'],
    ['deployment','factory','0x'+'ff'.repeat(20),'RECEIPT_FACTORY'],
    ['deployment','blockNumber','999','RECEIPT_BLOCK'],
    ['deployment','status','reverted','RECEIPT_FAILED'],
    ['token-proof','decimals',18,'TOKEN_DECIMALS'],
    ['token-proof','blockHash','0x'+'ff'.repeat(32),'TOKEN_BLOCK'],
    ['approval','configurationDigest','0x'+'ff'.repeat(32),'APPROVAL_CONFIGURATION'],
    ['review','sourceCommit','f'.repeat(40),'REVIEW_COMMIT'],
    ['review','sourceSha256','0x'+'ff'.repeat(32),'REVIEW_SOURCE'],
    ['command-log','exitCode',1,'COMMAND_FAILED'],
  ])('rejects mismatched %s.%s despite correct checksums',async(id,field,value,error)=>{
    const f=artifactFixture(); f.proofs[String(id)]![String(field)]=value; const anchor=f.seal();
    await expect(createReviewedArtifactVerifier(f.bundle,anchor).verify(f.config,f.finality)).rejects.toThrow(String(error));
  });
  it.each(['factoryRuntime','tokenRuntime','agreementRuntime'] as const)('rejects incorrect %s',async key=>{
    const f=artifactFixture(); f.build[key]='0x6009'; const anchor=f.seal();
    await expect(createReviewedArtifactVerifier(f.bundle,anchor).verify(f.config,f.finality)).rejects.toThrow(/RUNTIME/);
  });
  it('rejects a different compiler identity',async()=>{
    const f=artifactFixture(); f.build.compiler='solc 0.8.29'; const anchor=f.seal();
    await expect(createReviewedArtifactVerifier(f.bundle,anchor).verify(f.config,f.finality)).rejects.toThrow('COMPILER');
  });
  it('rejects source commit mismatch',async()=>{
    const f=artifactFixture(); f.build.sourceCommit='f'.repeat(40); const anchor=f.seal();
    await expect(createReviewedArtifactVerifier(f.bundle,anchor).verify(f.config,f.finality)).rejects.toThrow('SOURCE_COMMIT');
  });
  it('rejects changed compiler settings',async()=>{
    const f=artifactFixture(); f.build.compilerSettings={optimizer:{enabled:false,runs:200}}; const anchor=f.seal();
    await expect(createReviewedArtifactVerifier(f.bundle,anchor).verify(f.config,f.finality)).rejects.toThrow('COMPILER_SETTINGS');
  });
  it.each(['issuedAt','expiresAt'] as const)('rejects invalid review time %s',async field=>{
    const f=artifactFixture(); f.review[field]=field==='issuedAt'?Date.now()+10000:Date.now()-1; const anchor=f.seal();
    await expect(createReviewedArtifactVerifier(f.bundle,anchor).verify(f.config,f.finality)).rejects.toThrow('REVIEW_EXPIRED');
  });
  it('rechecks expiry on every use',async()=>{
    vi.useFakeTimers(); const f=artifactFixture(), verifier=createReviewedArtifactVerifier(f.bundle,f.anchor);
    await verifier.verify(f.config,f.finality); vi.setSystemTime(f.review.expiresAt);
    await expect(verifier.verify(f.config,f.finality)).rejects.toThrow('REVIEW_EXPIRED');
  });
  it('binds RPC configuration and finality',async()=>{
    const f=artifactFixture(), verifier=createReviewedArtifactVerifier(f.bundle,f.anchor);
    await expect(verifier.verify({...f.config,primaryRpcOrigin:'https://other.example'},f.finality)).rejects.toThrow('CONFIGURATION_BINDING');
    await expect(verifier.verify(f.config,{...f.finality,chainId:1n})).rejects.toThrow('CONFIGURATION_BINDING');
  });
  it('rejects record RPC origins that disagree with the pinned configuration',async()=>{
    const f=artifactFixture(); f.record.rpcOrigins[0]='https://other.example'; const anchor=f.seal();
    await expect(createReviewedArtifactVerifier(f.bundle,anchor).verify(f.config,f.finality)).rejects.toThrow('RPC_BINDING');
  });
  it('rejects structural templates even when independently pinned',async()=>{
    const f=artifactFixture(); f.record.status='NOT_RUN'; const anchor=f.seal();
    await expect(createReviewedArtifactVerifier(f.bundle,anchor).verify(f.config,f.finality)).rejects.toThrow('RECORD_INVALID');
  });
  it('rejects duplicate JSON keys even when the exact malformed bytes are pinned',async()=>{
    const f=artifactFixture();
    f.bundle.review=new TextEncoder().encode(new TextDecoder().decode(f.bundle.review).replace('{','{"schemaVersion":1,'));
    await expect(createReviewedArtifactVerifier(f.bundle,{reviewSha256:sha256(f.bundle.review)}).verify(f.config,f.finality)).rejects.toThrow('NONCANONICAL_JSON');
  });
  it('snapshots supplied bytes and anchor against caller mutation',async()=>{
    const f=artifactFixture(), verifier=createReviewedArtifactVerifier(f.bundle,f.anchor);
    f.bundle.review.fill(0); f.bundle.evidence.deployment!.fill(0); f.anchor.reviewSha256=sha256(toHex('forged'));
    await expect(verifier.verify(f.config,f.finality)).resolves.toMatchObject({agreementCodeHash:f.config.agreementCodeHash});
  });
  it('bounds input bytes and rejects empty evidence',()=>{
    const f=artifactFixture(); f.bundle.build=new Uint8Array(4*1024*1024+1);
    expect(()=>createReviewedArtifactVerifier(f.bundle,f.anchor)).toThrow('BYTES');
    f.bundle.build=encoded({}); f.bundle.evidence={};
    expect(()=>createReviewedArtifactVerifier(f.bundle,f.anchor)).toThrow('EVIDENCE_COUNT');
  });
  it('keeps shipped trust and live execution disabled',async()=>{
    const f=artifactFixture(); expect(trustedConfigText).toBeNull(); expect(trustedFinalityPolicy).toBeNull();
    await expect(trustedArtifactVerifier.verify(f.config,f.finality)).rejects.toThrow('DEPLOYMENT_ARTIFACT_ACCEPTANCE_REQUIRED');
    expect(decoded(f.bundle.review).kind).toBe('RECOVERY_ARTIFACT_REVIEW');
  });
});
describe('constructor and deployment binding',()=>{
  it('rejects constructor argument bytes that disagree with guardian/token/caps',async()=>{
    const f=artifactFixture(); f.build.constructorArguments='0x1234'; const anchor=f.seal();
    await expect(createReviewedArtifactVerifier(f.bundle,anchor).verify(f.config,f.finality)).rejects.toThrow('CONSTRUCTOR_ARGUMENTS');
  });
  it('rejects constructor checksum mismatch',async()=>{
    const f=artifactFixture(); f.record.verification.constructorArgumentsHash='0x'+'ff'.repeat(32); const anchor=f.seal();
    await expect(createReviewedArtifactVerifier(f.bundle,anchor).verify(f.config,f.finality)).rejects.toThrow('CONSTRUCTOR_HASH');
  });
  it('rejects a deployment receipt for other init code even with correct checksum',async()=>{
    const f=artifactFixture(); f.proofs.deployment!.transactionInput='0x1234'; const anchor=f.seal();
    await expect(createReviewedArtifactVerifier(f.bundle,anchor).verify(f.config,f.finality)).rejects.toThrow('DEPLOYMENT_INPUT');
  });
  it('rejects a guardian change independently of field presence',async()=>{
    const f=artifactFixture(); f.record.factory.guardian='0x'+'ff'.repeat(20); const anchor=f.seal();
    await expect(createReviewedArtifactVerifier(f.bundle,anchor).verify(f.config,f.finality)).rejects.toThrow('CONSTRUCTOR_ARGUMENTS');
  });
});
describe('reference closure and review lifetime',()=>{
  it('rejects declared but unused evidence instead of trusting its asserted kind',async()=>{
    const f=artifactFixture(); f.proofs.unused={kind:'TOKEN_VERIFICATION'};
    f.record.evidence.push({id:'unused',kind:'TOKEN_VERIFICATION',sha256:'0x'+'ff'.repeat(32)});
    const anchor=f.seal();
    await expect(createReviewedArtifactVerifier(f.bundle,anchor).verify(f.config,f.finality)).rejects.toThrow('UNUSED_REFERENCE');
  });
  it('rejects excessively long review validity',async()=>{
    const f=artifactFixture(); f.review.expiresAt=f.review.issuedAt+86400001; const anchor=f.seal();
    await expect(createReviewedArtifactVerifier(f.bundle,anchor).verify(f.config,f.finality)).rejects.toThrow('REVIEW_EXPIRED');
  });
});
