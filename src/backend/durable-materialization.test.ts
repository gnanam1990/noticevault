import {fixturePromise} from "../../scripts/test-promise.mjs";
import {completeWireFixture} from './durable-unit-support';
import {describe,it,expect} from 'vitest';
import {DurableAttemptClient} from './durable-attempt.js';
const ws='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',client='0x'+'1'.repeat(40),agreement='0x'+'2'.repeat(40),provider='0x'+'3'.repeat(40),token='0x'+'4'.repeat(40),hash='0x'+'a'.repeat(64);
function fixture(){return completeWireFixture({source:'SYNTHETIC',id,workspaceId:ws,account:provider,chainId:'31337',resource:'agreement:test',action:'materialize-notice',binding:'b'.repeat(64),state:'confirmed',revision:2,hash,preparation:{target:agreement,notice:{termsHash:hash,agreementCodeHash:hash,regularFunded:'100',fundedThrough:'200'}},proof:{blockNumber:'10',blockHash:hash,outcome:{kind:'NO_CHANGE',action:'materialize-notice',agreement,client,provider,token,termsHash:hash,regularFunded:'100',fundedThrough:'200',noticeStart:'150',noticeEnd:'200',reason:'CLIENT_CANCELLED'}}});}
function read(v:unknown){return new DurableAttemptClient(()=>fixturePromise(()=>(new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}})))).get(ws,id);}
describe('durable materialization response',()=>{
 it('accepts proven no-op from permissionless actor without claiming payment',async()=>{const r=await read(fixture());expect(r.proof?.outcome?.kind).toBe('NO_CHANGE');expect(r.account).toBe(provider);});
 it('accepts exact default state change',async()=>{const v=fixture();Object.assign(v.proof.outcome,{kind:'STATE_CHANGED',noticeStart:'200',noticeEnd:'250',reason:'MISSED_CHECKPOINT'});expect((await read(v)).proof?.outcome?.kind).toBe('STATE_CHANGED');});
 it('rejects claimed new cancellation through default materialization',async()=>{const v=fixture();v.proof.outcome.kind='STATE_CHANGED';await expect(read(v)).rejects.toMatchObject({status:502});});
 it('rejects NO_CHANGE for start-notice',async()=>{const v=fixture();v.action='start-notice';v.proof.outcome.action='start-notice';v.account=client;await expect(read(v)).rejects.toMatchObject({status:502});});
 it('rejects impossible default start',async()=>{const v=fixture();v.proof.outcome.reason='MISSED_CHECKPOINT';await expect(read(v)).rejects.toMatchObject({status:502});});
 it('rejects cancellation at or after checkpoint',async()=>{const v=fixture();v.proof.outcome.noticeStart='200';v.proof.outcome.noticeEnd='250';await expect(read(v)).rejects.toMatchObject({status:502});});
 it('rejects transfer banner result',async()=>{const v=fixture();v.proof.outcome.kind='TRANSFER';await expect(read(v)).rejects.toMatchObject({status:502});});
 it('rejects confirmation without outcome proof',async()=>{const v=fixture();Reflect.deleteProperty(v,'proof');await expect(read(v)).rejects.toMatchObject({status:502});});
 it('keeps legacy unknown accessible without proof',async()=>{const v=fixture();v.state='unknown';Reflect.deleteProperty(v,'proof');expect((await read(v)).state).toBe('unknown');});
});
