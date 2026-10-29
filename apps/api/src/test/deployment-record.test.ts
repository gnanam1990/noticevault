import {describe,it,expect} from 'vitest';
import {inspectDeploymentRecord} from '../deployment-record.js';
import {parseArcTestnetManifest} from '../deployment-manifest.js';
import {deploymentRecordFixture} from './deployment-record-fixture.js';
function inspect(mutate?:(r:ReturnType<typeof deploymentRecordFixture>['record'])=>void){const f=deploymentRecordFixture();mutate?.(f.record);return inspectDeploymentRecord(JSON.stringify(f.record),parseArcTestnetManifest(JSON.stringify(f.descriptor)));}
describe('original deployment record validation',()=>{
 it('maps complete synthetic claims without granting runtime trust',()=>{const r=inspect();expect(r.state).toBe('RECORD_COMPLETE_UNVERIFIED');expect(r.executionEnabled).toBe(false);expect(r.runtimeVerified).toBe(false);expect(r.diagnostics).toContain('RUNTIME_EVIDENCE_REQUIRED');});
 it('reports missing record explicitly',()=>{expect(inspectDeploymentRecord(undefined,undefined).diagnostics).toContain('DEPLOYMENT_RECORD_REQUIRED');});
 for(const key of ['environment','chainId','status','recordKind'] as const)it('rejects wrong '+key,()=>{expect(inspect(r=>{r[key]='wrong';}).state).toBe('BLOCKED');});
 it('rejects factory substitution',()=>expect(inspect(r=>{r.factory.address=r.token.address;}).state).toBe('BLOCKED'));
 it('rejects token code substitution',()=>expect(inspect(r=>{r.token.verificationEvidence.runtimeCodeHash='0x'+'44'.repeat(32);}).state).toBe('BLOCKED'));
 it('rejects mismatched signature domain',()=>expect(inspect(r=>{r.verification.signatureDomain.verifyingContract=r.token.address;}).state).toBe('BLOCKED'));
 it('rejects unsafe amount and cap inversion',()=>expect(inspect(r=>{r.factory.agreementCapBaseUnits='1001';}).state).toBe('BLOCKED'));
 it('rejects embedded credentials without echoing values',()=>{const r=inspect(x=>{x.rpcOrigins[0]='https://user:private-value@primary.invalid';});expect(r.state).toBe('BLOCKED');expect(JSON.stringify(r)).not.toContain('private-value');});
 it('rejects duplicate origins',()=>expect(inspect(r=>{r.rpcOrigins[1]=r.rpcOrigins[0]!;}).state).toBe('BLOCKED'));
 it('rejects missing review evidence',()=>expect(inspect(r=>{r.evidence=r.evidence.filter(e=>e.id!=='review');}).state).toBe('BLOCKED'));
 it('rejects missing deployment receipt reference',()=>expect(inspect(r=>{r.externalActions=[];}).state).toBe('BLOCKED'));
 it('rejects duplicate nested JSON keys',()=>{const f=deploymentRecordFixture();const text=JSON.stringify(f.record).replace('"decimals":6','"decimals":18,"decimals":6');expect(inspectDeploymentRecord(text,parseArcTestnetManifest(JSON.stringify(f.descriptor))).state).toBe('BLOCKED');});
 it('rejects malformed and oversized records',()=>{expect(inspectDeploymentRecord('{',undefined).state).toBe('BLOCKED');expect(inspectDeploymentRecord(' '.repeat(65537),undefined).state).toBe('BLOCKED');});
});

it('rejects origin aliases as independent providers',()=>expect(inspect(r=>{r.rpcOrigins=['https://primary.invalid','https://PRIMARY.invalid/'];}).state).toBe('BLOCKED'));
