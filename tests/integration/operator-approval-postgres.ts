import {mkdir,writeFile} from 'node:fs/promises';
import {loadOperatorApprovalInputs} from '../../apps/api/src/operator-startup';
import {stringify} from '../../apps/api/src/reviewed-artifacts';
/** SYNTHETIC ONLY: real authenticated API/PostgreSQL; fake RPC/wallet/artifacts. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {privateKeyToAccount} from 'viem/accounts';
import type {Hex} from 'viem';
import {createPool,runMigrations,createWorkspace,addMembership,createDraft} from '../../packages/db/src/index';
import {operatorFixture} from './operator-approval.fixture';
import {buildConfiguredServer} from '../../apps/api/src/configured-startup';
import {DurableAttemptClient} from '../../src/backend/durable-attempt';
import {OperatorApprovalController} from '../../src/backend/operator-approval';
Reflect.set(process.env,'NODE_ENV','test');
const schema='nv_operator_it',db={host:process.env.NOTICEVAULT_TEST_SOCKET??'/tmp/nv-socket',port:5432,user:'postgres',password:'',database:process.env.NOTICEVAULT_TEST_DB??'noticevault_operator_it',schema};
const cfg={configIdentity:'ARC_TESTNET' as const,port:3001,host:'127.0.0.1',db,sessionSecret:'test_session_secret_32_bytes_xxx!',cookieDomain:'localhost',allowedOrigins:['http://localhost:5173'],sessionTtlSecs:86400,challengeTtlSecs:300,allowedDomains:['localhost']};
const pool=createPool(db),actor=privateKeyToAccount(('0x'+'11'.repeat(32)) as Hex),ws=randomUUID();
let app:Awaited<ReturnType<typeof buildConfiguredServer>>|undefined,cookie='',sends=0,interrupted=false,lostClaim=false;
const results:{name:string;passed:boolean}[]=[];
const check=async(name:string,fn:()=>Promise<void>)=>{await fn();results.push({name,passed:true});console.log('PASS '+name);};
try{
 const m=await runMigrations(pool,schema,'/home/user/app/packages/db/src/migrations');assert.deepEqual(m.errors,[]);
 await createWorkspace(pool,schema,ws,'Synthetic operator integration',actor.address);await addMembership(pool,schema,ws,actor.address,'owner',5042002n);
 const f=await operatorFixture({account:actor.address,pool,cfg});
 const artifactDir='/tmp/operator-artifacts';await mkdir(artifactDir,{mode:0o700});
 const artifacts:Record<string,unknown>={evidence:{}};
 for(const name of ['review','record','source','lock','build'] as const){artifacts[name]=name;await writeFile(artifactDir+'/'+name,f.f.bundle[name]);}
 for(const [id,bytes] of Object.entries(f.f.bundle.evidence)){const name='evidence-'+Object.keys(artifacts.evidence as object).length;(artifacts.evidence as Record<string,string>)[id]=name;await writeFile(artifactDir+'/'+name,bytes);}
 await writeFile(artifactDir+'/config.json',stringify({schemaVersion:1,config:f.f.config,finality:f.f.finality,artifacts}));
 const loaded=await loadOperatorApprovalInputs({NOTICEVAULT_OPERATOR_APPROVAL_CONFIG:artifactDir+'/config.json',NOTICEVAULT_OPERATOR_REVIEW_SHA256:f.f.anchor.reviewSha256},{reader:origin=>origin===f.f.config.primaryRpcOrigin?f.runtime.primary.reader:f.runtime.verification.reader});assert.ok(loaded);
 const start=async()=>{app=await buildConfiguredServer({cfg,pool,skipMigration:true,logger:false,operatorInputs:loaded});app.addHook('onError',async(_request,_reply,error)=>{console.error('API_ERROR',error.message);});await app.ready();};await start();
 const headers=()=>({origin:'http://localhost:5173','x-requested-with':'XMLHttpRequest',cookie});
 await check('real signature challenge creates authenticated session and rejects replay',async()=>{
  const c=await app!.inject({method:'POST',url:'/auth/challenge',headers:headers(),payload:{address:actor.address,chainId:5042002}});assert.equal(c.statusCode,200,c.body);const q=c.json();
  const payload={nonce:q.nonce,signature:await actor.signMessage({message:q.message}),address:actor.address,chainId:5042002};
  const r=await app!.inject({method:'POST',url:'/auth/verify',headers:headers(),payload});assert.equal(r.statusCode,200,r.body);cookie=String(r.headers['set-cookie']).split(';')[0];assert.match(cookie,/nv_session=/);
  assert.notEqual((await app!.inject({method:'POST',url:'/auth/verify',headers:headers(),payload})).statusCode,200);
 });
 const api=new DurableAttemptClient(async(url,init)=>{assert.equal(init?.credentials,'same-origin');const path=String(url).slice(4);const r=await app!.inject({method:(init?.method??'GET') as 'GET'|'POST',url:path,headers:{...headers(),'content-type':'application/json'},payload:init?.body?String(init.body):undefined});if(path.endsWith('/attempts')||r.statusCode>=400)console.log('API_REJECT',path,r.statusCode,r.body.slice(0,400));if(lostClaim&&path.endsWith('/claim')){lostClaim=false;throw Error('Synthetic lost claim response');}return new Response(r.body,{status:r.statusCode,headers:{'content-type':'application/json'}});},'OPERATOR_CONFIGURED');
 const memory=new Map<string,string>(),storage={getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>{memory.set(k,v);}};
 let queue=Promise.resolve();const locks={request:<T>(_name:string,fn:()=>Promise<T>)=>{const next=queue.then(fn);queue=next.then(()=>{},()=>{});return next;}};
 const provider={request:async({method,params}:{method:string;params:unknown[]})=>{
  if(method==='eth_requestAccounts'||method==='eth_accounts')return [actor.address];if(method==='eth_chainId')return '0x4cef52';
  if(method==='eth_sendTransaction'){
   const rows=await pool.query('SELECT state FROM '+schema+'.transaction_attempts WHERE id=$1',[JSON.parse(storage.getItem(current!.storageKey)!).attemptId]);assert.equal(rows.rows[0].state,'unknown');
   assert.equal(JSON.parse(storage.getItem(current!.storageKey)!).stage,'unknown');sends++;if(interrupted)throw Error('Synthetic wallet interruption');return f.send(params[0] as Record<string,unknown>);
  }throw Error('Unexpected synthetic wallet request');
 }};
 let current:OperatorApprovalController|undefined;
 const make=(draft:string)=>new OperatorApprovalController(ws,draft,{chainId:'5042002',token:f.f.config.deployment.allowlistedToken!,factory:f.f.config.deployment.factoryAddress!,policyHash:f.composed.runtime.policyHash},provider,storage,locks,api,undefined,undefined,{terms:f.row.terms_json,version:1,docHash:f.row.doc_hash});
 const draft=async()=>{const id=randomUUID();await createDraft(pool,schema,id,ws,actor.address,f.row.terms_json,f.row.doc_hash);return id;};
 let first='';
 await check('authenticated API and real DB reserve claim before fake send and canonical reconciliation',async()=>{
  first=await draft();current=make(first);await current.prepare();assert.equal(current.snapshot().status,'review',current.snapshot().message);
  const key=current.snapshot().key!;f.advanceBlock();await Promise.all([current.confirm(key),current.confirm(key)]);assert.equal(sends,1,current.snapshot().message);assert.equal(current.snapshot().status,'locked');
  await current.reconcile();assert.equal(current.snapshot().status,'confirmed',current.snapshot().message);
 });
 await check('terminal journal archive preserves evidence and API prevents same-cycle repeat',async()=>{
  const id=current!.snapshot().attempt!.id;await current!.restart();assert.equal(current!.snapshot().status,'idle',current!.snapshot().message);assert.ok([...memory.keys()].some(k=>k.includes(':history:')));
  assert.equal((await api.get(ws,id)).state,'confirmed');f.setAllowance(0n);await assert.rejects(()=>api.reserve(ws,'draft:'+first,'approve-creation',randomUUID()));
 });
 await check('cancelled unclaimed attempt can roll over to a fresh request with history retained',async()=>{
  f.setNonce(1n);const id=await draft();current=make(id);await current.prepare();assert.equal(current.snapshot().status,'review',current.snapshot().message);
  const old=current.snapshot().attempt!.id;await current.reconcile(true);assert.equal(current.snapshot().status,'cancelled');await current.restart();assert.equal(current.snapshot().status,'idle');
  await current.prepare();assert.equal(current.snapshot().status,'review',current.snapshot().message);assert.notEqual(current.snapshot().attempt!.id,old);await current.reconcile(true);
 });
 await check('stale real draft blocks claim without a wallet send',async()=>{
  const id=await draft();current=make(id);await current.prepare();assert.equal(current.snapshot().status,'review');
  await pool.query('UPDATE '+schema+'.terms_drafts SET version=version+1 WHERE id=$1',[id]);await current.confirm(current.snapshot().key!);assert.equal(sends,1,current.snapshot().message);assert.equal(current.snapshot().status,'locked');await current.reconcile(true);
 });
 let unknownDraft='',unknownId='';
 await check('lost claim response persists unknown across controller and API restart with no repeat',async()=>{
  unknownDraft=await draft();current=make(unknownDraft);await current.prepare();assert.equal(current.snapshot().status,'review',current.snapshot().message);unknownId=current.snapshot().attempt!.id;
  lostClaim=true;await current.confirm(current.snapshot().key!);assert.equal(sends,1);assert.equal((await api.get(ws,unknownId)).state,'unknown');current.dispose();await app!.close();await start();
  current=make(unknownDraft);assert.equal(current.snapshot().status,'locked');await current.reconcile();assert.equal(current.snapshot().attempt!.state,'unknown');await current.restart();assert.equal(current.snapshot().status,'locked');
  await assert.rejects(()=>api.claim(ws,unknownId));await assert.rejects(()=>api.reserve(ws,'draft:'+unknownDraft,'approve-creation',randomUUID()));assert.equal(sends,1);
 });
 await check('wallet interruption after durable claim remains unknown',async()=>{
  f.setNonce(2n);const id=await draft();current=make(id);await current.prepare();assert.equal(current.snapshot().status,'review',current.snapshot().message);interrupted=true;await current.confirm(current.snapshot().key!);assert.equal(sends,2);
  await current.reconcile();assert.equal(current.snapshot().attempt!.state,'unknown');await current.restart();assert.equal(current.snapshot().status,'locked');
 });
 await check('two actual API claims race atomically and only one acquires handoff',async()=>{
  f.setNonce(3n);const id=await draft(),r=await api.reserve(ws,'draft:'+id,'approve-creation',randomUUID());
  const claims=await Promise.allSettled([api.claim(ws,r.id),api.claim(ws,r.id)]);assert.equal(claims.filter(c=>c.status==='fulfilled').length,1);assert.equal((await api.get(ws,r.id)).state,'unknown');assert.equal(sends,2);
 });
 await check('anonymous attempt access denied and readiness stays disabled',async()=>{
  const saved=cookie;cookie='';await assert.rejects(()=>api.get(ws,unknownId));cookie=saved;const r=await app!.inject('/readiness');assert.equal(r.statusCode,503);assert.equal(r.json().executionEnabled,false);
 });
 await writeFile(process.env.NOTICEVAULT_TEST_RESTART??'/tmp/operator-restart.json',JSON.stringify({schema,unknownId,unknownDraft,workspace:ws}));
 console.log(JSON.stringify({synthetic:true,passed:results.length,results}));
}finally{await app?.close();await pool.end();}
