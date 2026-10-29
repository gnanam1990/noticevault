import {composeOperatorApproval} from '../../apps/api/src/operator-approval';
import type {AttemptPreparation} from '../../apps/api/src/attempt-evidence';
import {mkdir,writeFile} from 'node:fs/promises';
import {loadOperatorApprovalInputs} from '../../apps/api/src/operator-startup';
import {stringify} from '../../apps/api/src/reviewed-artifacts';
/** SYNTHETIC ONLY: real authenticated API/PostgreSQL; fake RPC/wallet/artifacts. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {privateKeyToAccount} from 'viem/accounts';
import type {Hex} from 'viem';
import {createPool,runMigrations,createWorkspace,addMembership,createDraft} from '../../packages/db/src/index';
import {creationFixture} from './operator-creation.fixture';
import {OperatorConsentController,OperatorConsentClient} from '../../src/backend/operator-consent';
import {serializeTerms} from '../../packages/sdk/src/index';
import {buildConfiguredServer} from '../../apps/api/src/configured-startup';
import {DurableAttemptClient} from '../../src/backend/durable-attempt';
import {OperatorApprovalController} from '../../src/backend/operator-approval';
Reflect.set(process.env,'NODE_ENV','test');
const schema='nv_operator_creation_it',db={host:'/tmp/nv-socket',port:5432,user:'postgres',password:'',database:'noticevault_creation_it',schema};
const cfg={configIdentity:'ARC_TESTNET' as const,port:3001,host:'127.0.0.1',db,sessionSecret:'test_session_secret_32_bytes_xxx!',cookieDomain:'localhost',allowedOrigins:['http://localhost:5173'],sessionTtlSecs:86400,challengeTtlSecs:300,allowedDomains:['localhost']};
const pool=createPool(db),actor=privateKeyToAccount(('0x'+'11'.repeat(32)) as Hex),ws=randomUUID(),providerKey=privateKeyToAccount(('0x'+'22'.repeat(32)) as Hex);
let consentLost=false,signatureMode='ok',walletAccount='',walletChain='0x4cef52',signatureRequests=0;
let app:Awaited<ReturnType<typeof buildConfiguredServer>>|undefined,cookie='',sends=0,interrupted=false,lostClaim=false;
const results:{name:string;passed:boolean}[]=[];
const check=async(name:string,fn:()=>Promise<void>)=>{await fn();results.push({name,passed:true});console.log('PASS '+name);};
try{
 const m=await runMigrations(pool,schema,'/home/user/app/packages/db/src/migrations');assert.deepEqual(m.errors,[]);
 await createWorkspace(pool,schema,ws,'Synthetic operator integration',actor.address);await addMembership(pool,schema,ws,actor.address,'owner',5042002n);
 await addMembership(pool,schema,ws,providerKey.address,'member',5042002n);
 const f=await creationFixture({account:actor.address,provider:providerKey.address,pool,cfg});
 const artifactDir='/tmp/operator-artifacts';await mkdir(artifactDir,{mode:0o700});
 const artifacts:Record<string,unknown>={evidence:{}};
 for(const name of ['review','record','source','lock','build'] as const){artifacts[name]=name;await writeFile(artifactDir+'/'+name,f.f.bundle[name]);}
 for(const [id,bytes] of Object.entries(f.f.bundle.evidence)){const name='evidence-'+Object.keys(artifacts.evidence as object).length;(artifacts.evidence as Record<string,string>)[id]=name;await writeFile(artifactDir+'/'+name,bytes);}
 await writeFile(artifactDir+'/config.json',stringify({schemaVersion:1,config:f.f.config,finality:f.f.finality,artifacts}));
 const loaded=await loadOperatorApprovalInputs({NOTICEVAULT_OPERATOR_APPROVAL_CONFIG:artifactDir+'/config.json',NOTICEVAULT_OPERATOR_REVIEW_SHA256:f.f.anchor.reviewSha256},{reader:origin=>origin===f.f.config.primaryRpcOrigin?f.runtime.primary.reader:f.runtime.verification.reader});assert.ok(loaded);
 const creationComposed=await composeOperatorApproval({...loaded,cfg:{...cfg,consentDeployment:loaded.config.deployment},pool});
 const start=async()=>{app=await buildConfiguredServer({cfg,pool,skipMigration:true,logger:false,operatorInputs:loaded});app.addHook('onError',async(_request,_reply,error)=>{console.error('API_ERROR',error.message);});await app.ready();};await start();
 const headers=()=>({origin:'http://localhost:5173','x-requested-with':'XMLHttpRequest',cookie});
 await check('real signature challenge creates authenticated session and rejects replay',async()=>{
  const c=await app!.inject({method:'POST',url:'/auth/challenge',headers:headers(),payload:{address:actor.address,chainId:5042002}});assert.equal(c.statusCode,200,c.body);const q=c.json();
  const payload={nonce:q.nonce,signature:await actor.signMessage({message:q.message}),address:actor.address,chainId:5042002};
  const r=await app!.inject({method:'POST',url:'/auth/verify',headers:headers(),payload});assert.equal(r.statusCode,200,r.body);cookie=String(r.headers['set-cookie']).split(';')[0];assert.match(cookie,/nv_session=/);
  assert.notEqual((await app!.inject({method:'POST',url:'/auth/verify',headers:headers(),payload})).statusCode,200);
 });
 const clientCookie=cookie;
 const challenge=await app!.inject({method:'POST',url:'/auth/challenge',headers:headers(),payload:{address:providerKey.address,chainId:5042002}});assert.equal(challenge.statusCode,200,challenge.body);const q=challenge.json();
 const verified=await app!.inject({method:'POST',url:'/auth/verify',headers:headers(),payload:{nonce:q.nonce,signature:await providerKey.signMessage({message:q.message}),address:providerKey.address,chainId:5042002}});assert.equal(verified.statusCode,200,verified.body);const providerCookie=String(verified.headers['set-cookie']).split(';')[0];
 const transport=async(url:RequestInfo|URL,init?:RequestInit)=>{const path=String(url).slice(4);const r=await app!.inject({method:(init?.method??'GET') as 'GET'|'POST',url:path,headers:{...headers(),...(init?.body?{'content-type':'application/json'}:{})},payload:init?.body?String(init.body):undefined});if(r.statusCode>=400)console.log('API_REJECT',r.statusCode,r.body.slice(0,200));if(lostClaim&&path.endsWith('/claim')){lostClaim=false;throw Error('Synthetic lost claim response');}if(consentLost&&path.endsWith('/provider-consent')&&init?.method==='POST'){consentLost=false;throw Error('Synthetic lost consent response');}return new Response(r.body,{status:r.statusCode,headers:{'content-type':'application/json'}});};
 const api=new DurableAttemptClient(transport,'OPERATOR_CONFIGURED'),consentApi=new OperatorConsentClient(transport);
 const memory=new Map<string,string>(),storage={getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>{memory.set(k,v);}};
 let queue=Promise.resolve();const locks={request:<T>(_name:string,fn:()=>Promise<T>)=>{const next=queue.then(fn);queue=next.then(()=>{},()=>{});return next;}};
 const provider={request:async({method,params}:{method:string;params:unknown[]})=>{
  if(method==='eth_requestAccounts'||method==='eth_accounts')return [walletAccount];if(method==='eth_chainId')return walletChain;
  if(method==='eth_signTypedData_v4'){
   signatureRequests++;assert.ok([...memory.values()].some(v=>v&&JSON.parse(v).binding));if(signatureMode==='denied')throw Object.assign(Error('Synthetic denial'),{code:4001});if(signatureMode==='interrupted')throw Error('Synthetic signature transport interrupted');
   const typed=JSON.parse(String(params[1])),signature=await providerKey.signTypedData(typed);if(signatureMode==='changed')walletAccount=actor.address;return signature;
  }
  if(method==='eth_sendTransaction'){
   const id=JSON.parse(storage.getItem(current!.storageKey)!).attemptId;assert.equal((await api.get(ws,id)).state,'unknown');assert.equal(JSON.parse(storage.getItem(current!.storageKey)!).stage,'unknown');sends++;if(interrupted)throw Error('Synthetic wallet interruption');return f.send(params[0] as Record<string,unknown>);
  }throw Error('Unexpected synthetic wallet request');
 }};
 const pins={chainId:'5042002',token:f.f.config.deployment.allowlistedToken!,factory:f.f.config.deployment.factoryAddress!,policyHash:f.composed.runtime.policyHash};
 const asProvider=()=>{cookie=providerCookie;walletAccount=providerKey.address;walletChain='0x4cef52';};const asClient=()=>{cookie=clientCookie;walletAccount=actor.address;walletChain='0x4cef52';};
 const consent=(id:string)=>new OperatorConsentController(ws,id,pins,provider,storage,locks,consentApi);
 const drafts=new Map<string,{terms:ReturnType<typeof serializeTerms>;version:number;docHash:string}>();let clientNonce=20n;
 const draft=async()=>{const id=randomUUID(),terms=serializeTerms({...f.terms,clientNonce:clientNonce++});await createDraft(pool,schema,id,ws,actor.address,terms,f.row.doc_hash);drafts.set(id,{terms,version:1,docHash:f.row.doc_hash});return id;};
 const make=(id:string)=>new OperatorApprovalController(ws,id,pins,provider,storage,locks,api,drafts.get(id)!);let current:OperatorApprovalController|undefined;
 const accept=async(id:string)=>{asProvider();const c=consent(id);await c.prepare();assert.equal(c.snapshot().status,'review',c.snapshot().message);await c.confirm(c.snapshot().context!.binding);assert.equal(c.snapshot().status,'accepted',c.snapshot().message);c.dispose();};
 await check('authenticated provider/client role boundaries and missing consent fail closed',async()=>{
  const id=await draft();asClient();await assert.rejects(()=>consentApi.request(ws,id));await assert.rejects(()=>api.reserve(ws,'draft:'+id,'create-agreement',randomUUID()));asProvider();await assert.rejects(()=>api.reserve(ws,'draft:'+id,'create-agreement',randomUUID()));
 });
 await check('changed draft, chain and account prevent signature handoff',async()=>{
  for(const change of ['draft','chain','account']){const id=await draft();asProvider();const c=consent(id);await c.prepare();assert.equal(c.snapshot().status,'review',c.snapshot().message);const key=c.snapshot().context!.binding,before=signatureRequests;
   if(change==='draft')await pool.query('UPDATE '+schema+'.terms_drafts SET version=version+1 WHERE id=$1',[id]);if(change==='chain')walletChain='0x1';if(change==='account')walletAccount=actor.address;
   await c.confirm(key);assert.equal(signatureRequests,before);assert.equal(c.snapshot().status,'locked');c.dispose();
  }
 });
 await check('denied signature allows only a new explicit review; duplicate accepted consent is idempotent',async()=>{
  const id=await draft();asProvider();const c=consent(id);await c.prepare();signatureMode='denied';await c.confirm(c.snapshot().context!.binding);assert.equal(c.snapshot().status,'idle',c.snapshot().message);signatureMode='ok';await c.prepare();await c.confirm(c.snapshot().context!.binding);assert.equal(c.snapshot().status,'accepted',c.snapshot().message);
  const j=JSON.parse(storage.getItem(c.storageKey)!);const before=signatureRequests;await consentApi.request(ws,id,{binding:j.binding,signature:j.signature});assert.equal(signatureRequests,before);const count=await pool.query('SELECT count(*)::int AS n FROM '+schema+'.accepted_consents WHERE draft_id=$1',[id]);assert.equal(count.rows[0].n,1);c.dispose();
 });
 await check('interrupted signature stays locked through reload and cannot automatically repeat',async()=>{
  const id=await draft();asProvider();let c=consent(id);await c.prepare();signatureMode='interrupted';await c.confirm(c.snapshot().context!.binding);signatureMode='ok';assert.equal(c.snapshot().status,'locked');const before=signatureRequests;c.dispose();c=consent(id);await c.prepare();await c.confirm('anything');await c.reconcile();assert.equal(c.snapshot().status,'locked');assert.equal(signatureRequests,before);c.dispose();
 });
 await check('account change after signature stores it without submitting and explicit reconciliation reuses it',async()=>{
  const id=await draft();asProvider();const c=consent(id);await c.prepare();signatureMode='changed';await c.confirm(c.snapshot().context!.binding);signatureMode='ok';assert.equal(c.snapshot().status,'locked');assert.equal((await pool.query('SELECT count(*)::int AS n FROM '+schema+'.accepted_consents WHERE draft_id=$1',[id])).rows[0].n,0);
  const before=signatureRequests;asProvider();await c.reconcile();assert.equal(c.snapshot().status,'accepted',c.snapshot().message);assert.equal(signatureRequests,before);c.dispose();
 });
 let first='';
 await check('lost consent response recovers the persisted signature without another wallet request',async()=>{
  first=await draft();asProvider();let c=consent(first);await c.prepare();consentLost=true;await c.confirm(c.snapshot().context!.binding);assert.equal(c.snapshot().status,'locked');const before=signatureRequests;c.dispose();c=consent(first);await c.reconcile();assert.equal(c.snapshot().status,'accepted',c.snapshot().message);assert.equal(signatureRequests,before);c.dispose();
 });
 await check('creation handoff commits unknown first and requires canonical creation plus exact funding evidence',async()=>{
  asClient();current=make(first);await current.prepare();assert.equal(current.snapshot().status,'review',current.snapshot().message);const key=current.snapshot().key!;await Promise.all([current.confirm(key),current.confirm(key)]);assert.equal(sends,1,current.snapshot().message);
  const saved=(await pool.query('SELECT preparation FROM '+schema+'.transaction_attempts WHERE id=$1',[JSON.parse(storage.getItem(current.storageKey)!).attemptId])).rows[0].preparation as AttemptPreparation;f.omitTransfer();await assert.rejects(()=>creationComposed.adapter.verifyBusiness!(saved,{hash:f.hash,blockNumber:10n,blockHash:'0x'+'a'.repeat(64)}));f.restoreTransfer();await creationComposed.adapter.verifyBusiness!(saved,{hash:f.hash,blockNumber:10n,blockHash:'0x'+'a'.repeat(64)});await current.reconcile();assert.equal(current.snapshot().status,'confirmed',current.snapshot().message);
  const outcome=current.snapshot().attempt!.proof!.outcome!;assert.equal(outcome.kind,'STATE_CHANGED');assert.equal('agreement' in outcome&&outcome.agreement.toLowerCase(),f.A.toLowerCase());assert.equal('depositedAmount' in outcome&&outcome.depositedAmount,'4000000');
  await current.restart();assert.equal(current.snapshot().status,'idle',current.snapshot().message);await assert.rejects(()=>api.reserve(ws,'draft:'+first,'create-agreement',randomUUID()));
 });
 await check('changed draft, chain and account block creation before wallet send',async()=>{
  f.setNonce(1n);for(const change of ['draft','chain','account']){const id=await draft();await accept(id);asClient();current=make(id);await current.prepare();assert.equal(current.snapshot().status,'review',current.snapshot().message);const key=current.snapshot().key!;
   if(change==='draft')await pool.query('UPDATE '+schema+'.terms_drafts SET version=version+1 WHERE id=$1',[id]);if(change==='chain')walletChain='0x1';if(change==='account')walletAccount=providerKey.address;
   await current.confirm(key);assert.equal(sends,1);assert.equal(current.snapshot().status,'locked');asClient();await current.reconcile(true);
  }
 });
 let unknownId='',unknownDraft='';
 await check('lost creation claim survives API and browser reload and remains non-repeatable',async()=>{
  unknownDraft=await draft();await accept(unknownDraft);asClient();current=make(unknownDraft);await current.prepare();assert.equal(current.snapshot().status,'review',current.snapshot().message);unknownId=current.snapshot().attempt!.id;lostClaim=true;await current.confirm(current.snapshot().key!);assert.equal(sends,1);assert.equal((await api.get(ws,unknownId)).state,'unknown');current.dispose();await app!.close();await start();current=make(unknownDraft);await current.reconcile();assert.equal(current.snapshot().attempt!.state,'unknown');await current.restart();assert.equal(current.snapshot().status,'locked');await assert.rejects(()=>api.claim(ws,unknownId));await assert.rejects(()=>api.reserve(ws,'draft:'+unknownDraft,'create-agreement',randomUUID()));
 });
 await check('interrupted creation wallet and competing API claims preserve unknown locks',async()=>{
  f.setNonce(2n);const id=await draft();await accept(id);asClient();current=make(id);await current.prepare();assert.equal(current.snapshot().status,'review',current.snapshot().message);interrupted=true;await current.confirm(current.snapshot().key!);interrupted=false;assert.equal(sends,2);await current.reconcile();assert.equal(current.snapshot().attempt!.state,'unknown');await current.restart();assert.equal(current.snapshot().status,'locked');
  f.setNonce(3n);const other=await draft();await accept(other);asClient();const r=await api.reserve(ws,'draft:'+other,'create-agreement',randomUUID());const claims=await Promise.allSettled([api.claim(ws,r.id),api.claim(ws,r.id)]);assert.equal(claims.filter(c=>c.status==='fulfilled').length,1);assert.equal((await api.get(ws,r.id)).state,'unknown');
 });
 await check('revoked authenticated session blocks creation handoff and default readiness remains disabled',async()=>{
  f.setNonce(4n);const id=await draft();await accept(id);asClient();current=make(id);await current.prepare();assert.equal(current.snapshot().status,'review',current.snapshot().message);await pool.query('UPDATE '+schema+'.sessions SET revoked_at=clock_timestamp() WHERE lower(member_address)=lower($1)',[actor.address]);await current.confirm(current.snapshot().key!);assert.equal(sends,2);assert.equal(current.snapshot().status,'locked');assert.equal((await app!.inject('/readiness')).statusCode,503);
 });
 await writeFile('/tmp/operator-restart.json',JSON.stringify({schema,unknownId,unknownDraft,workspace:ws}));console.log(JSON.stringify({synthetic:true,passed:results.length,results,signatureRequests,sends}));
}finally{await app?.close();await pool.end();}
