import {describe,it,expect} from 'vitest';
import {composeReadOnlyRuntime,isConfiguredAdapter,assertConfiguredRuntime} from '../configured-runtime.js';
import {configuredFixture} from './configured-runtime-fixture.js';
describe('configured read-only runtime',()=>{
 it('composes SDK/auth/discovery/outcomes without executor',async()=>{const f=configuredFixture(),r=await composeReadOnlyRuntime(f.input);expect(r.report.state).toBe('READ_ONLY_COMPOSED');expect(r.report.executionEnabled).toBe(false);expect(r.report.runtimeVerified).toBe(false);expect(r.report.provenance).toBe('SYNTHETIC');expect(isConfiguredAdapter(r.attempts)).toBe(true);expect(isConfiguredAdapter({...r.attempts})).toBe(false);expect(r.attempts.discovery?.policyHash).toBe(r.policyHash);for(const key of ['verifyApproval','verifyBusiness','verifyFunding','verifyNotice'] as const)expect(r.attempts[key]).toBeTypeOf('function');expect(f.calls()).toBeGreaterThanOrEqual(4);await expect(r.attempts.prepare({} as never)).rejects.toThrow('EXECUTION_DISABLED');expect('submit' in r).toBe(false);});
 it('rejects forged capability',()=>expect(()=>assertConfiguredRuntime({} as never,{} as never)).toThrow('BINDING'));
 it('rejects missing record before provider work',async()=>{const f=configuredFixture();await expect(composeReadOnlyRuntime({...f.input,recordText:''})).rejects.toThrow('RECORD');expect(f.calls()).toBe(0);});
 it('rejects corrupt artifact bytes',async()=>{const f=configuredFixture();await expect(composeReadOnlyRuntime({...f.input,readArtifact:async()=>new Uint8Array([1])})).rejects.toThrow('ARTIFACT');});
 it('rejects unavailable artifacts',async()=>{const f=configuredFixture();await expect(composeReadOnlyRuntime({...f.input,readArtifact:async()=>{throw new Error('absent');}})).rejects.toThrow();});
 it('rejects wrong chain',async()=>{const f=configuredFixture();f.setWrongChain();await expect(composeReadOnlyRuntime(f.input)).rejects.toThrow();});
 it('rejects wrong code',async()=>{const f=configuredFixture();f.setWrongCode();await expect(composeReadOnlyRuntime(f.input)).rejects.toThrow('CODE');});
 it('rejects canonical disagreement',async()=>{const f=configuredFixture();f.setDisagreement();await expect(composeReadOnlyRuntime(f.input)).rejects.toThrow();});
 it('rejects reused providers',async()=>{const f=configuredFixture();await expect(composeReadOnlyRuntime({...f.input,verification:{id:'second',reader:f.input.primary.reader}})).rejects.toThrow();});
 it('rejects unapproved finality',async()=>{const f=configuredFixture();await expect(composeReadOnlyRuntime({...f.input,finality:{...f.input.finality,kind:'DEPTH'} as never})).rejects.toThrow();});
 it('rejects changed wallet chain',async()=>{const f=configuredFixture(),r=await composeReadOnlyRuntime({...f.input,readWallet:async()=>({account:'0x'+'66'.repeat(20),chainId:1n})});await expect(r.consent.readWallet()).rejects.toThrow('WALLET');});
it('forbids synthetic construction outside tests before reads',async()=>{const f=configuredFixture(),old=Reflect.get(process.env,'NODE_ENV');Reflect.set(process.env,'NODE_ENV','production');try{await expect(composeReadOnlyRuntime(f.input)).rejects.toThrow('TEST_CONSTRUCTION');expect(f.calls()).toBe(0);}finally{Reflect.set(process.env,'NODE_ENV',old);}});
 it('requires operator provider identities to match record origins',async()=>{const f=configuredFixture();await expect(composeReadOnlyRuntime({...f.input,provenance:'OPERATOR_CONFIGURED'})).rejects.toThrow('ORIGIN_BINDING');});
});
