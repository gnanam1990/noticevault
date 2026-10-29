import {fixturePromise} from "../../scripts/test-promise.mjs";
import {completeWireFixture} from './durable-unit-support';
import {describe,it,expect} from 'vitest';
import {DurableAttemptClient} from './durable-attempt.js';
const ws='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',client='0x'+'1'.repeat(40),agreement='0x'+'2'.repeat(40),token='0x'+'3'.repeat(40),hash='0x'+'a'.repeat(64);
function fixture(){return completeWireFixture({source:'SYNTHETIC',id,workspaceId:ws,account:client,chainId:'31337',resource:'agreement:test',action:'fund-renewal',binding:'b'.repeat(64),state:'confirmed',revision:2,hash,preparation:{target:agreement,funding:{termsHash:hash,agreementCodeHash:hash,regularFunded:'100',fundedThrough:'200'}},proof:{blockNumber:'10',blockHash:hash,outcome:{kind:'STATE_CHANGED',action:'fund-renewal',agreement,client,token,termsHash:hash,fundedAmount:'100',periodSeconds:'100',previousRegularFunded:'100',newRegularFunded:'200',previousFundedThrough:'200',newFundedThrough:'300',observedRegularFunded:'200',observedLiability:'250',observedBalance:'250',observedAllowance:'0'}}});}
function read(v:unknown){return new DurableAttemptClient(()=>fixturePromise(()=>(new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}})))).get(ws,id);}
describe('durable funding response',()=>{
it('accepts exact funding with spent zero allowance',async()=>{const r=await read(fixture());expect(r.proof?.outcome?.kind).toBe('STATE_CHANGED');});
it('distinguishes later same block funding and donations',async()=>{const v=fixture();Object.assign(v.proof.outcome,{observedRegularFunded:'300',observedLiability:'350',observedBalance:'400'});expect((await read(v)).state).toBe('confirmed');});
it.each([{client:token},{agreement:token},{termsHash:'0x'+'b'.repeat(64)},{fundedAmount:'0'},{newRegularFunded:'201'},{newFundedThrough:'301'},{previousRegularFunded:'0'},{previousFundedThrough:'100'},{observedRegularFunded:'199'},{observedBalance:'249'},{observedAllowance:'-1'},{periodSeconds:'0'},{kind:'TRANSFER'}])('rejects inconsistent funding outcome %j',async change=>{const v=fixture();Object.assign(v.proof.outcome,change);await expect(read(v)).rejects.toMatchObject({status:502});});
it('rejects confirmation without proof',async()=>{const v=fixture();Reflect.deleteProperty(v,'proof');await expect(read(v)).rejects.toMatchObject({status:502});});
it('rejects legacy funding lacking trusted binding',async()=>{const v=fixture();Reflect.deleteProperty(v.preparation,'funding');await expect(read(v)).rejects.toMatchObject({status:502});});
});
