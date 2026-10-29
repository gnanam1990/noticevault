import {describe,it,expect} from 'vitest';
import {parseArcManifest,parseArcTestnetManifest,arcDeployment,requireFactoryAddress} from '@noticevault/sdk';
import {composeReadOnlyRuntime,assertConfiguredRuntime} from '../configured-runtime.js';
import {configuredFixture} from './configured-runtime-fixture.js';
import {snapshotConsentDeployment} from '../consent-manifest.js';
import {inspectDeploymentRecord} from '../deployment-record.js';
import {loadArcManifest} from '../deployment-manifest.js';
import type {ApiConfig} from '../config.js';
function fixture(network:'ARC_TESTNET'|'ARC_MAINNET'){
 const f=configuredFixture(),chainId=arcDeployment(network).chainId;
 f.f.descriptor.configIdentity=network;f.f.descriptor.chainId=String(chainId);f.f.descriptor.isLive=network==='ARC_MAINNET';
 f.f.record.environment=network;f.f.record.chainId=String(chainId);f.f.record.verification.signatureDomain.chainId=String(chainId);
 const input={...f.input,manifestText:JSON.stringify(f.f.descriptor),recordText:JSON.stringify(f.f.record),finality:{...f.input.finality,network,chainId},primary:{...f.input.primary,reader:{...f.input.primary.reader,getChainId:async()=>Number(chainId)}},verification:{...f.input.verification,reader:{...f.input.verification.reader,getChainId:async()=>Number(chainId)}},readWallet:async()=>({account:'0x'+'66'.repeat(20),chainId})};
 return {f,input,chainId};
}
describe.each(['ARC_TESTNET','ARC_MAINNET'] as const)('%s strict synthetic composition',network=>{
 it('parses exact network and retains unavailable default deployment',()=>{const {input,chainId}=fixture(network);const dep=loadArcManifest('/synthetic/manifest.json',network,()=>input.manifestText);expect(dep.chainId).toBe(chainId);expect(snapshotConsentDeployment(network,dep)).toEqual(dep);expect(()=>requireFactoryAddress(arcDeployment(network))).toThrow();expect(arcDeployment(network).factoryAddress).toBeNull();});
 it('rejects opposite network, wrong chain, live marker and null pins',()=>{const {input}=fixture(network),v=JSON.parse(input.manifestText);for(const patch of [{chainId:'1'},{isLive:!v.isLive},{factoryAddress:null},{configIdentity:network==='ARC_MAINNET'?'ARC_TESTNET':'ARC_MAINNET'}])expect(()=>parseArcManifest(JSON.stringify({...v,...patch}))).toThrow();if(network==='ARC_MAINNET')expect(()=>parseArcTestnetManifest(input.manifestText)).toThrow();});
 it('composes with fake providers while execution remains disabled',async()=>{const {input,chainId}=fixture(network),r=await composeReadOnlyRuntime(input);expect(r.deployment.chainId).toBe(chainId);expect((await r.consent.readWallet()).chainId).toBe(chainId);expect(r.report.executionEnabled).toBe(false);expect(r.report.runtimeVerified).toBe(false);expect(()=>assertConfiguredRuntime(r,{configIdentity:network,consentDeployment:r.deployment} as ApiConfig)).not.toThrow();await expect(r.attempts.prepare({} as never)).rejects.toThrow('EXECUTION_DISABLED');});
 it('rejects wrong provider chain, finality and record',async()=>{const {input}=fixture(network);await expect(composeReadOnlyRuntime({...input,primary:{...input.primary,reader:{...input.primary.reader,getChainId:async()=>1}}})).rejects.toThrow();await expect(composeReadOnlyRuntime({...input,finality:{...input.finality,chainId:1n}})).rejects.toThrow('FINALITY');const record=JSON.parse(input.recordText);record.verification.signatureDomain.chainId='1';expect(inspectDeploymentRecord(JSON.stringify(record),parseArcManifest(input.manifestText)).state).toBe('BLOCKED');});
});
