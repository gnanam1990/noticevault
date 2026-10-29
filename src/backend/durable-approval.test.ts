import {fixturePromise} from "../../scripts/test-promise.mjs";
import {completeWireFixture} from './durable-unit-support';
import {describe,it,expect} from 'vitest';
import {DurableAttemptClient} from './durable-attempt.js';
const ws='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',account='0x'+'1'.repeat(40),spender='0x'+'2'.repeat(40),hash='0x'+'a'.repeat(64);
function fixture(){return completeWireFixture({source:'SYNTHETIC',id,workspaceId:ws,account,chainId:'31337',resource:'agreement:test',action:'approve-renewal',binding:'b'.repeat(64),state:'confirmed',revision:2,hash,preparation:{approval:{spender,amount:'100'}},proof:{blockNumber:'10',blockHash:hash,outcome:{kind:'ALLOWANCE_CHANGED',owner:account,spender,approvedAmount:'100',currentAllowance:'0',allowanceBlockNumber:'11',allowanceBlockHash:hash}}});}
function client(v:unknown){return new DurableAttemptClient(()=>fixturePromise(()=>(new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}}))));}
describe('durable approval response',()=>{
 it('accepts historical approval with consumed current allowance without calling it funding',async()=>{const r=await client(fixture()).get(ws,id);expect(r.proof?.outcome?.kind).toBe('ALLOWANCE_CHANGED');const o=r.proof?.outcome;expect(o?.kind==='ALLOWANCE_CHANGED'?o.currentAllowance:undefined).toBe('0');});
 for(const [field,value] of Object.entries({kind:'TRANSFER',owner:123,spender:account,approvedAmount:'99',currentAllowance:'-1',allowanceBlockNumber:'9',allowanceBlockHash:'bad'}))it('rejects malformed or mismatched '+field,async()=>{const v=fixture();Object.assign(v.proof.outcome,{[field]:value});await expect(client(v).get(ws,id)).rejects.toMatchObject({status:502});});
 it('rejects confirmed legacy approval without outcome',async()=>{const v=fixture();Reflect.deleteProperty(v,'proof');await expect(client(v).get(ws,id)).rejects.toMatchObject({status:502});});
 it('keeps legacy unknown readable and locked',async()=>{const v=fixture();v.state='unknown';Reflect.deleteProperty(v,'proof');expect((await client(v).get(ws,id)).state).toBe('unknown');});
});
