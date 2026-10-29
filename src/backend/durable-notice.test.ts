import {fixturePromise} from "../../scripts/test-promise.mjs";
import {completeWireFixture} from './durable-unit-support';
import {describe,it,expect} from 'vitest';
import {DurableAttemptClient} from './durable-attempt.js';
const ws='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',client='0x'+'1'.repeat(40),agreement='0x'+'2'.repeat(40),provider='0x'+'3'.repeat(40),token='0x'+'4'.repeat(40),hash='0x'+'a'.repeat(64);
function fixture(){return completeWireFixture({source:'SYNTHETIC',id,workspaceId:ws,account:client,chainId:'31337',resource:'agreement:test',action:'start-notice',binding:'b'.repeat(64),state:'confirmed',revision:2,hash,preparation:{target:agreement,notice:{termsHash:hash,agreementCodeHash:hash,regularFunded:'100',fundedThrough:'200'}},proof:{blockNumber:'10',blockHash:hash,outcome:{kind:'STATE_CHANGED',action:'start-notice',agreement,client,provider,token,termsHash:hash,regularFunded:'100',fundedThrough:'200',noticeStart:'150',noticeEnd:'200',reason:'CLIENT_CANCELLED'}}});}
function read(v:unknown){return new DurableAttemptClient(()=>fixturePromise(()=>(new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}})))).get(ws,id);}
describe('durable notice response',()=>{
 it('accepts exact state change without implying payment',async()=>{expect((await read(fixture())).proof?.outcome?.kind).toBe('STATE_CHANGED');});
 for(const [field,value] of Object.entries({kind:'TRANSFER',action:'claim-provider',agreement:client,client:provider,provider:123,token:'0x0',termsHash:'0x'+'b'.repeat(64),regularFunded:'200',fundedThrough:'201',noticeStart:'-1',noticeEnd:'149',reason:'DEFAULT'}))it('rejects '+field,async()=>{const v=fixture();Object.assign(v.proof.outcome,{[field]:value});await expect(read(v)).rejects.toMatchObject({status:502});});
 it('rejects confirmed notice missing proof',async()=>{const v=fixture();Reflect.deleteProperty(v,'proof');await expect(read(v)).rejects.toMatchObject({status:502});});
 it('preserves legacy unknown without proof',async()=>{const v=fixture();v.state='unknown';Reflect.deleteProperty(v,'proof');expect((await read(v)).state).toBe('unknown');});
});
