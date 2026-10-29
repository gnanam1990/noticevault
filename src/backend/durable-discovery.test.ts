import {fixturePromise} from "../../scripts/test-promise.mjs";
import {completeWireFixture} from './durable-unit-support';
import {describe,it,expect} from 'vitest';
import {DurableAttemptClient} from './durable-attempt.js';
const ws='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',hash='0x'+'a'.repeat(64),binding='b'.repeat(64);
function fixture(){return completeWireFixture({source:'SYNTHETIC',id,workspaceId:ws,account:'0x'+'1'.repeat(40),chainId:'5042002',resource:'agreement:test',action:'approve-renewal',binding,state:'unknown',revision:1,hash:null,preparation:{policyHash:hash,discoveryAnchor:{blockNumber:'1',blockHash:hash}},discovery:{version:1,binding,policyHash:hash,anchorBlock:'1',anchorHash:hash,nextBlock:'3',checkpointBlock:'2',checkpointHash:hash,revision:1,status:'searching'}});}
const client=(v:unknown)=>new DurableAttemptClient(()=>fixturePromise(()=>(new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}}))));
describe('durable discovery response',()=>{
 it('returns informational progress without unlocking unknown',async()=>{expect((await client(fixture()).get(ws,id)).state).toBe('unknown');});
 for(const [key,value] of Object.entries({version:2,binding:'c'.repeat(64),policyHash:'0x'+'c'.repeat(64),anchorBlock:'0',anchorHash:'bad',nextBlock:'2',checkpointBlock:'3',checkpointHash:'bad',revision:-1,status:'retryable',candidateHash:'bad',extra:true}))it('rejects invalid '+key,async()=>{const v=fixture();Object.assign(v.discovery,{[key]:value});await expect(client(v).get(ws,id)).rejects.toMatchObject({status:502});});
 it('retains legacy uncertainty without progress',async()=>{const v=fixture();Reflect.deleteProperty(v,'discovery');expect((await client(v).get(ws,id)).state).toBe('unknown');});
});
