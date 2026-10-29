import {describe,it} from 'vitest';
import assert from 'node:assert/strict';
import {createPreflightRpcClients,prepareSecureDeployment} from '../deployment-preparation.js';
import {ALCHEMY_MAINNET_ORIGIN} from '../operator-rpc.js';
const circle='https://rpc.mainnet.arc.io',secret='dummy_key_for_transport_test',endpoint=ALCHEMY_MAINNET_ORIGIN+'/v2/'+secret;
const endpoints={[ALCHEMY_MAINNET_ORIGIN]:endpoint};
describe('unsigned deployment secret transport',()=>{
 it('uses two independently pinned read-only transports and keeps keys out of clients',async()=>{
  const calls:{url:string;method:string;redirect:string|undefined}[]=[];
  const fake=((input:RequestInfo|URL,init?:RequestInit)=>{
   if(typeof input!=='string'||typeof init?.body!=='string')return Promise.reject(new Error('BAD_FIXTURE_TRANSPORT'));
   const body:unknown=JSON.parse(init.body);
   if(typeof body!=='object'||body===null||!('method' in body)||typeof body.method!=='string')throw Error('BAD_FIXTURE_REQUEST');
   calls.push({url:input,method:body.method,redirect:init?.redirect});
   const result=body.method==='eth_chainId'?'0x13b2':body.method==='eth_getCode'?'0x6000':'0x0';
   return Promise.resolve(Response.json({jsonrpc:'2.0',id:1,result}));
  });
  const [a,b]=createPreflightRpcClients([ALCHEMY_MAINNET_ORIGIN,circle],endpoints,fake);
  assert.ok(a);assert.ok(b);if(!a||!b)throw Error('FIXTURE_CLIENTS');
  assert.equal(await a.getChainId(),5042);assert.equal(await b.getChainId(),5042);
  assert.equal(await a.getCode({address:'0x0000000000000000000000000000000000000001',blockNumber:1n}),'0x6000');
  assert.deepEqual(calls.map(x=>x.url),[endpoint,circle,endpoint]);
  assert.ok(calls.every(x=>x.redirect==='error'));
  assert.deepEqual(Object.keys(a).sort(),['getBalance','getBlock','getChainId','getCode','readContract','simulateContract']);
  assert.ok(!JSON.stringify(a).includes(secret));
 });
 it('rejects duplicate providers, missing keys and origin mismatch before network use',()=>{
  assert.throws(()=>createPreflightRpcClients([circle,circle],{}),/RPC_INDEPENDENT_PAIR_REQUIRED/);
  assert.throws(()=>createPreflightRpcClients([ALCHEMY_MAINNET_ORIGIN,circle],{}),/RPC_SECRET_ENDPOINT_REQUIRED/);
  assert.throws(()=>createPreflightRpcClients([ALCHEMY_MAINNET_ORIGIN,circle],{[ALCHEMY_MAINNET_ORIGIN]:'https://wrong.invalid/v2/'+secret}),/RPC_ENDPOINT_ORIGIN_MISMATCH/);
 });
 it('does not leak endpoint credentials from transport failures',async()=>{
  const fake=(()=>Promise.reject(new Error(endpoint)));
  const [client]=createPreflightRpcClients([ALCHEMY_MAINNET_ORIGIN,circle],endpoints,fake);
  if(!client)throw Error('FIXTURE_CLIENT');
  try{await client.getChainId();throw Error('EXPECTED_FAILURE');}catch(error){assert.ok(!String(error).includes(secret));assert.match(String(error),/RPC_TRANSPORT_FAILED/);}
 });
 it('rejects an incomplete deployment plan before sending any request',async()=>{
  let called=false;const fake=(()=>{called=true;return Promise.resolve(Response.json({}));});
  await assert.rejects(prepareSecureDeployment({bytes:new TextEncoder().encode('{}'),reviewSha256:'0'.repeat(64),root:process.cwd()},endpoints,fake));
  assert.equal(called,false);
 });
});
