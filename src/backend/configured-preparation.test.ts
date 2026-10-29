import {fixturePromise} from "../../scripts/test-promise.mjs";
import {describe,it,expect} from 'vitest';
import {CreationPreparationClient} from './creation-preparation.js';
const ws='11111111-1111-4111-8111-111111111111',draft='22222222-2222-4222-8222-222222222222',H='0x'+'a'.repeat(64),F='0x'+'2'.repeat(40),A='0x'+'1'.repeat(40);
const context={source:'CONFIGURED_READ_ONLY' as const,binding:H,workspaceId:ws,draftId:draft,version:1,factory:F,account:A,chainId:'5042002'};
function client(source='CONFIGURED_READ_ONLY'){return new CreationPreparationClient((_path,init)=>fixturePromise(()=>(new Response(JSON.stringify(init?.method==='POST'?{source,binding:H,workspaceId:ws,draftId:draft,blockNumber:'12',blockHash:H,observedAt:Date.now(),transaction:{to:F,data:'0x12345678',chainId:'5042002',value:'0'}}:context),{headers:{'content-type':'application/json'}}))));}
describe('configured unsigned preparation client',()=>{
 it('preserves explicit read-only source for context',async()=>expect((await client().context(ws,draft)).source).toBe('CONFIGURED_READ_ONLY'));
 it('preserves explicit read-only source for unsigned preparation',async()=>expect((await client().prepare(context,()=>(fixturePromise(()=>({account:A,chainId:'5042002'}))))).source).toBe('CONFIGURED_READ_ONLY'));
 it('rejects source substitution instead of relabelling as synthetic',async()=>{await expect(client('SYNTHETIC').prepare(context,()=>(fixturePromise(()=>({account:A,chainId:'5042002'}))))).rejects.toMatchObject({status:502});});
});
