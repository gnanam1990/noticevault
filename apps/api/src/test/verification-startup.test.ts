import {describe,it,expect,afterAll} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {runVerificationStartup,loadDeploymentAssessment} from '../verification-startup.js';
import {deploymentRecordFixture} from './deployment-record-fixture.js';
const directory=mkdtempSync(join(tmpdir(),'nv-startup-unit-'));
afterAll(()=>rmSync(directory,{recursive:true,force:true}));
function files(){const f=deploymentRecordFixture();const descriptor=join(directory,'descriptor.json'),record=join(directory,'record.json');writeFileSync(descriptor,JSON.stringify(f.descriptor));writeFileSync(record,JSON.stringify(f.record));return {descriptor,record};}
describe('configured read-only startup',()=>{
 it('reports absent record without exposing paths or system errors',()=>{const r=loadDeploymentAssessment(join(directory,'absent-secret-location'),undefined);expect(r.state).toBe('BLOCKED');expect(JSON.stringify(r)).not.toContain(directory);});
 it('does not accept relative record paths',()=>expect(loadDeploymentAssessment('record.json',undefined).diagnostics).toContain('INVALID_DEPLOYMENT_RECORD_PATH'));
 it('keeps a complete record unverified and execution disabled',()=>{const f=files();const r=runVerificationStartup(['--verify-deployment',f.descriptor,f.record]);expect(r.exitCode).toBe(2);expect(r.report.state).toBe('RECORD_COMPLETE_UNVERIFIED');expect(r.report.executionEnabled).toBe(false);});
 it('runnable server verification entry does not require credentials or a database',()=>{const f=files();const child=spawnSync('bun',[resolve('src/server.ts'),'--verify-deployment',f.descriptor,f.record],{encoding:'utf8',env:{PATH:process.env.PATH},timeout:10000});expect(child.status).toBe(2);expect(child.stderr).toBe('');expect(JSON.parse(child.stdout).state).toBe('RECORD_COMPLETE_UNVERIFIED');});
 it('rejects malformed descriptor before normal API configuration loading',()=>{const f=files();writeFileSync(f.descriptor,'{}');const r=runVerificationStartup(['--verify-deployment',f.descriptor,f.record]);expect(r.exitCode).toBe(1);expect(r.report.diagnostics).toContain('DEPLOYMENT_DESCRIPTOR_UNAVAILABLE_OR_INVALID');});
 it('rejects extra CLI arguments instead of starting normal server',()=>expect(runVerificationStartup(['--verify-deployment','a','b','--live']).exitCode).toBe(1));
});
