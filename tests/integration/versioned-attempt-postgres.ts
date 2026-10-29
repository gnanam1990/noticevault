import {preparationBinding} from '../../apps/api/src/attempt-evidence';
import {fundingFixture} from '../../apps/api/src/test/funding-fixture.js';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPool,runMigrations,createWorkspace,addMembership,createSession} from '../../packages/db/src/index.js';
import {buildServer} from '../../apps/api/src/server.js';
import {DurableAttemptClient} from '../../src/backend/durable-attempt.js';
import type {SyntheticAttemptAdapter} from '../../apps/api/src/attempt-evidence.js';
Reflect.set(process.env,'NODE_ENV','test');
const baseFunding=fundingFixture(),fundingData=baseFunding.p.data;
const schema='nv_versioned_attempt',db={host:'/tmp/nv-socket',port:5432,user:'postgres',password:'',database:'noticevault_it_20261023',schema};
const pool=createPool(db),A='0x'+'1'.repeat(40),T='0x'+'9'.repeat(40),B='0x'+'a'.repeat(64),H='0x'+'b'.repeat(64),policy='0x'+'c'.repeat(64);
const ws=randomUUID(),other=randomUUID(),sid=randomUUID();let preparationAge=0,nonce=1n,cycle='1',target=T,receiptStatus='confirmed',canonical=B,txPresent=true,txData=fundingData,passed=0,failed=0;
const cfg={configIdentity:'LOCAL_FIXTURE' as const,port:3001,host:'127.0.0.1',db,sessionSecret:'test_session_secret_32_bytes_xxx!',cookieDomain:'localhost',allowedOrigins:['http://localhost:5173'],sessionTtlSecs:86400,challengeTtlSecs:300,allowedDomains:['localhost']};
const adapter:SyntheticAttemptAdapter={source:'SYNTHETIC',prepare:async input=>({...input,source:'SYNTHETIC',policyHash:policy,cycleKey:cycle,networkNonce:String(nonce),target,data:fundingData,value:'0',issuedAt:Date.now()+preparationAge,...(input.action==='fund-renewal'?{funding:baseFunding.p.funding}:{})}),verifyFunding:async(p,r)=>{const f=fundingFixture();Object.assign(f.r,r);return f.verify(p,r);},rpc:{getChainId:async()=>31337n,findTransaction:async p=>txPresent?{hash:BigInt(p.networkNonce)===1n?H:'0x'+'d'.repeat(64),chainId:31337n,from:A,to:target,nonce:BigInt(p.networkNonce),input:txData,value:0n}:null,getReceipt:async hash=>({hash,status:receiptStatus,blockNumber:10n,blockHash:B}),getBlock:async()=>({number:10n,hash:canonical,transactions:[H,'0x'+'d'.repeat(64)]})}};
let app!:Awaited<ReturnType<typeof buildServer>>,app2!:Awaited<ReturnType<typeof buildServer>>;
const headers={cookie:'nv_session='+sid,origin:'http://localhost:5173','x-requested-with':'XMLHttpRequest'};
function fetcher(server:typeof app){return async(path:string,init:RequestInit={})=>{assert(path.startsWith('/api/'));assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');const r=await server.inject({method:(init.method??'GET') as never,url:path.slice(4),headers,...(init.body?{payload:JSON.parse(String(init.body))}:{})});return new Response(r.body,{status:r.statusCode,headers:{'content-type':String(r.headers['content-type'])}});};}
const fail=(status:number)=>(e:unknown)=>!!e&&typeof e==='object'&&'status' in e&&e.status===status;
async function check(name:string,fn:()=>Promise<void>){try{await fn();passed++;console.log('PASS',name);}catch(e){failed++;console.error('FAIL',name,e);}}
let first!:{id:string};
try{
assert.deepEqual((await runMigrations(pool,schema,'/home/user/app/packages/db/src/migrations')).errors,[]);await createWorkspace(pool,schema,ws,'Synthetic versioned attempts',A);await addMembership(pool,schema,ws,A,'owner',31337n);await pool.query('INSERT INTO '+schema+'.sessions(id,member_address,chain_id,expires_at) VALUES($1,$2,$3,$4)',[sid,A,'31337',new Date(Date.now()+3600000)]);
app=await buildServer({cfg,pool,skipMigration:true,logger:false,syntheticAttempts:adapter});await app.ready();
const call=(method:'GET'|'POST',url:string,payload?:object,key='synthetic-reviewed-key')=>app.inject({method,url,headers:{...headers,'idempotency-key':key},...(payload?{payload}:{})});
const resource='agreement:'+T,prepared=await adapter.prepare({workspaceId:ws,actor:A,chainId:'31337',resource,action:'fund-renewal'}),binding=preparationBinding(prepared),url='/v1/chain/31337/agreements/'+T+'/intents';
let r=await call('POST',url,{workspaceId:ws,action:'RENEW',expectedBinding:'0'.repeat(64)});assert.equal(r.statusCode,409,r.body);assert.equal((await pool.query('SELECT count(*) AS n FROM '+schema+'.transaction_attempts')).rows[0].n,'0');
r=await call('POST',url,{workspaceId:ws,action:'RENEW',expectedBinding:binding});assert.equal(r.statusCode,201,r.body);const intentId=r.json().data.intentId;assert.ok(intentId);
r=await call('POST',url,{workspaceId:ws,action:'RENEW',expectedBinding:binding});assert.equal(r.json().data.intentId,intentId);
r=await call('POST',url,{workspaceId:ws,action:'RENEW',expectedBinding:'0'.repeat(64)});assert.equal(r.statusCode,409,r.body);
r=await call('POST','/v1/intents/'+intentId+'/claim',{});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().data.state,'unknown');
r=await call('POST','/v1/intents/'+intentId+'/claim',{});assert.equal(r.statusCode,409,r.body);
txPresent=false;r=await call('POST','/v1/intents/'+intentId+'/attempts',{transactionHash:H});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().data.state,'unknown');
r=await call('POST','/v1/intents/'+intentId+'/attempts',{transactionHash:H,status:'confirmed',receipt:{}});assert.equal(r.statusCode,400,r.body);
r=await call('POST',url,{workspaceId:ws,action:'RENEW',expectedBinding:binding},'repeat-unknown');assert.equal(r.statusCode,409,r.body);
await app.close();app=await buildServer({cfg,pool,skipMigration:true,logger:false,syntheticAttempts:adapter});await app.ready();r=await call('GET','/v1/intents/'+intentId);assert.equal(r.json().data.state,'unknown');
txPresent=true;r=await call('POST','/v1/intents/'+intentId+'/reconcile',{});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().data.state,'confirmed');
r=await call('POST','/v1/intents/'+intentId+'/attempts',{transactionHash:'0x'+'e'.repeat(64)});assert.equal(r.statusCode,409,r.body);
const viewer='0x'+'2'.repeat(40),viewerSession=randomUUID();await addMembership(pool,schema,ws,viewer,'viewer',31337n);await createSession(pool,schema,viewerSession,viewer,31337n,new Date(Date.now()+3600000));
let shared=await app.inject({url:'/v1/intents/'+intentId,headers:{...headers,cookie:'nv_session='+viewerSession}});assert.equal(shared.statusCode,200,shared.body);assert.equal(shared.json().data.preparation,undefined);
shared=await app.inject({method:'POST',url:'/v1/intents/'+intentId+'/claim',headers:{...headers,cookie:'nv_session='+viewerSession},payload:{}});assert.equal(shared.statusCode,403,shared.body);
console.log('PASS /v1 durable reservation stale-binding refusal, idempotency, explicit claim-before-handoff, unknown/no-repeat/reload, canonical reconciliation and forged hash/receipt rejection');
}finally{await app?.close();await pool.end();}
