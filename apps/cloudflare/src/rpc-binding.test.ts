import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHostedOperatorReader} from './rpc-binding';
import {loadHostedOperatorInputs} from './operator-inputs';
const origin='https://arc-mainnet.g.alchemy.com',endpoint=origin+'/v2/SyntheticOnly1234567890',circle='https://rpc.mainnet.arc.io';
await test('encrypted endpoint stays on its reviewed origin and secondary remains independent',async()=>{
 const calls:{url:string;redirect:RequestRedirect|undefined}[]=[];
 const fake:typeof fetch=(input,init)=>{calls.push({url:String(input),redirect:init?.redirect});return Promise.resolve(Response.json({jsonrpc:'2.0',id:1,result:'0x13b2'}));};
 const reader=createHostedOperatorReader(endpoint,fake);
 assert.equal(await reader(origin).getChainId(),5042);assert.equal(await reader(circle).getChainId(),5042);
 assert.deepEqual(calls,[{url:endpoint,redirect:'error'},{url:circle,redirect:'error'}]);
});
await test('missing or mismatched encrypted endpoints fail without exposing the value',()=>{
 assert.throws(()=>createHostedOperatorReader(undefined)(origin));
 for(const value of [endpoint+'?secret=synthetic',endpoint+'\n','https://wrong.invalid/v2/SyntheticOnly1234567890',origin]){
  assert.throws(()=>createHostedOperatorReader(value),error=>error instanceof Error&&!error.message.includes(value)&&!error.message.includes('SyntheticOnly'));
 }
});
await test('secret presence never enables an absent reviewed operator bundle',async()=>{
 let requests=0;const fake:typeof fetch=()=>{requests++;return Promise.reject(new Error('Unexpected provider call'));};
 const reader=createHostedOperatorReader(endpoint,fake);
 assert.equal(await loadHostedOperatorInputs(null,undefined,{reader}),undefined);assert.equal(requests,0);
 await assert.rejects(loadHostedOperatorInputs(null,'synthetic-review',{reader}),/HOSTED_OPERATOR_INPUTS_REQUIRED/);assert.equal(requests,0);
});
