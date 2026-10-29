import {canonicalCreation} from '../../apps/api/src/agreement-association';
import {mkdir,writeFile} from 'node:fs/promises';
import {loadOperatorApprovalInputs} from '../../apps/api/src/operator-startup';
import {stringify} from '../../apps/api/src/reviewed-artifacts';
/** SYNTHETIC ONLY: real authenticated API/PostgreSQL; fake RPC/wallet/artifacts. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {privateKeyToAccount} from 'viem/accounts';
import type {Hex} from 'viem';
import {createPool,runMigrations,createWorkspace,addMembership} from '../../packages/db/src/index';
import {renewalFixture} from './operator-renewal.fixture';
import {buildConfiguredServer} from '../../apps/api/src/configured-startup';
import {DurableAttemptClient} from '../../src/backend/durable-attempt';
import {OperatorApprovalController} from '../../src/backend/operator-approval';
Reflect.set(process.env,'NODE_ENV','test');
const schema='nv_operator_renewal_it_'+(process.env.RENEWAL_ACTION??'approve')+'_'+(process.env.RENEWAL_CASE??'claim'),db={host:'/tmp/nv-socket',port:5432,user:'postgres',password:'',database:'noticevault_renewal_it',schema};
const cfg={configIdentity:'ARC_TESTNET' as const,port:3001,host:'127.0.0.1',db,sessionSecret:'test_session_secret_32_bytes_xxx!',cookieDomain:'localhost',allowedOrigins:['http://localhost:5173'],sessionTtlSecs:86400,challengeTtlSecs:300,allowedDomains:['localhost']};
const pool=createPool(db),actor=privateKeyToAccount(('0x'+'11'.repeat(32)) as Hex),ws=randomUUID();
let walletAccount=actor.address,walletChain='0x4cef52',lostReserve=false,denied=false,lostWalletResponse=false;
let app:Awaited<ReturnType<typeof buildConfiguredServer>>|undefined,cookie='',sends=0,interrupted=false,lostClaim=false;
const results:{name:string;passed:boolean}[]=[];
const check=async(name:string,fn:()=>Promise<void>)=>{await fn();results.push({name,passed:true});console.log('PASS '+name);};
try{
 const m=await runMigrations(pool,schema,'/home/user/app/packages/db/src/migrations');assert.deepEqual(m.errors,[]);
 await createWorkspace(pool,schema,ws,'Synthetic operator integration',actor.address);await addMembership(pool,schema,ws,actor.address,'owner',5042002n);
 const f=await renewalFixture({account:actor.address,pool,cfg});
 const artifactDir='/tmp/operator-artifacts-'+schema;await mkdir(artifactDir,{mode:0o700});
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
 const api=new DurableAttemptClient(async(url,init)=>{assert.equal(init?.credentials,'same-origin');const path=String(url).slice(4);const r=await app!.inject({method:(init?.method??'GET') as 'GET'|'POST',url:path,headers:{...headers(),'content-type':'application/json'},payload:init?.body?String(init.body):undefined});if(path.endsWith('/attempts')||r.statusCode>=400)console.log('API_REJECT',path,r.statusCode,r.body.slice(0,400));if(lostReserve&&path.endsWith('/attempts')){lostReserve=false;throw Error('Synthetic lost reservation response');}if(lostClaim&&path.endsWith('/claim')){lostClaim=false;throw Error('Synthetic lost claim response');}return new Response(r.body,{status:r.statusCode,headers:{'content-type':'application/json'}});},'OPERATOR_CONFIGURED');
 const memory=new Map<string,string>(),storage={getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>{memory.set(k,v);}};
 let queue=Promise.resolve();const locks={request:<T>(_name:string,fn:()=>Promise<T>)=>{const next=queue.then(fn);queue=next.then(()=>{},()=>{});return next;}};
 const provider={request:async({method,params}:{method:string;params:unknown[]})=>{
  if(method==='eth_requestAccounts'||method==='eth_accounts')return [walletAccount];if(method==='eth_chainId')return walletChain;
  if(method==='eth_sendTransaction'){
   const rows=await pool.query('SELECT state FROM '+schema+'.transaction_attempts WHERE id=$1',[JSON.parse(storage.getItem(current!.storageKey)!).attemptId]);assert.equal(rows.rows[0].state,'unknown');
   assert.equal(JSON.parse(storage.getItem(current!.storageKey)!).stage,'unknown');sends++;if(denied)throw Object.assign(Error('Synthetic denial'),{code:4001});if(interrupted)throw Error('Synthetic wallet interruption');return f.send(params[0] as Record<string,unknown>);
  }throw Error('Unexpected synthetic wallet request');
 }};
 let current:OperatorApprovalController|undefined;
 const pins={chainId:'5042002',token:f.f.config.deployment.allowlistedToken!,factory:f.f.config.deployment.factoryAddress!,policyHash:f.composed.runtime.policyHash};
 const make=(action:'approve-renewal'|'fund-renewal',stream='renewal-stream')=>new OperatorApprovalController(ws,stream+':'+f.A,pins,provider,storage,locks,api,undefined,{agreement:f.A,streamId:stream,action});
 const resource=(address=f.A)=>'agreement:'+address;
 async function associate(stream:string){const dep=f.f.config.deployment,policy={version:1,mode:'SYNTHETIC',chainId:'5042002',factory:dep.factoryAddress,token:dep.allowlistedToken,tokenDecimals:6,factoryCodeHash:dep.expectedFactoryCodeHash,tokenCodeHash:dep.expectedTokenCodeHash};
  await pool.query('INSERT INTO '+schema+'.indexer_streams(stream_id,binding_hash,source,head_number,head_hash,deployment_policy) VALUES($1,$2,$3,10,$4,$5)',[stream,f.hash(900n),'SYNTHETIC',f.hash(10n),policy]);
  await pool.query('INSERT INTO '+schema+'.indexer_blocks(stream_id,block_number,block_hash,content_hash) VALUES($1,10,$2,$3)',[stream,f.hash(10n),f.hash(901n)]);
  const args={agreement:f.A,client:actor.address,provider:f.terms.provider,amountPerPeriod:'3000000',periodSeconds:'3600',noticeSeconds:'3600',startAt:String(f.terms.startAt),noticeReserve:'3000000',initialFunded:'3000000'};
  await pool.query('INSERT INTO '+schema+'.indexer_events(stream_id,block_number,transaction_hash,log_index,payload) VALUES($1,10,$2,0,$3)',[stream,f.hash(902n),{address:dep.factoryAddress,eventName:'AgreementCreated',args}]);
  await pool.query('INSERT INTO '+schema+'.indexed_agreements(stream_id,agreement,created_block,terms) VALUES($1,$2,10,$3)',[stream,f.A,args]);
  const c=await pool.connect();let proof;try{await c.query('BEGIN');proof=await canonicalCreation(c,schema,stream,f.A);await c.query('COMMIT');}finally{c.release();}
  await pool.query('INSERT INTO '+schema+'.workspace_agreement_associations(workspace_id,stream_id,agreement,fingerprint,proof,associated_by,associated_chain,audience) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[ws,stream,f.A,proof.fingerprint,proof,actor.address,'5042002','current-and-future-workspace-members']);
 }
 await associate('renewal-stream');
 await check('authenticated workspace member who is not the client cannot prepare renewal',async()=>{
  const other=privateKeyToAccount(('0x'+'2'.repeat(64)) as Hex),savedCookie=cookie;
  await addMembership(pool,schema,ws,other.address,'member',5042002n);
  const challenge=await app!.inject({method:'POST',url:'/auth/challenge',headers:headers(),payload:{address:other.address,chainId:5042002}});assert.equal(challenge.statusCode,200,challenge.body);const q=challenge.json();
  const verified=await app!.inject({method:'POST',url:'/auth/verify',headers:headers(),payload:{nonce:q.nonce,signature:await other.signMessage({message:q.message}),address:other.address,chainId:5042002}});assert.equal(verified.statusCode,200,verified.body);cookie=String(verified.headers['set-cookie']).split(';')[0]!;
  await assert.rejects(()=>api.reserve(ws,resource(),'approve-renewal',randomUUID()));await assert.rejects(()=>api.reserve(ws,resource(),'fund-renewal',randomUUID()));cookie=savedCookie;assert.equal(sends,0);
 });
 await check('missing association, insufficient balance and allowance fail closed',async()=>{
  await assert.rejects(()=>api.reserve(ws,resource(('0x'+'7'.repeat(40)) as Hex),'approve-renewal',randomUUID()));
  await assert.rejects(()=>api.reserve(ws,resource(),'fund-renewal',randomUUID()));
  await assert.rejects(()=>api.reserve(ws,'agreement:0x'+f.A.slice(2).toUpperCase(),'approve-renewal',randomUUID()));
  const old=f.state().balance;f.mutate({balance:0n});await assert.rejects(()=>api.reserve(ws,resource(),'approve-renewal',randomUUID()));f.mutate({balance:old});assert.equal(sends,0);
 });
 await check('separate deliberate approval and funding repeat safely across two canonical cycles',async()=>{
  for(let cycle=0;cycle<2;cycle++){
   current=make('approve-renewal');await current.prepare();assert.equal(current.snapshot().status,'review',current.snapshot().message);assert.equal(current.snapshot().attempt!.preparation.approval!.amount,'3000000');const before=sends,key=current.snapshot().key!;
   await Promise.all([current.confirm(key),current.confirm(key)]);assert.equal(sends,before+1);await current.reconcile();assert.equal(current.snapshot().status,'confirmed',current.snapshot().message);await current.restart();assert.equal(current.snapshot().status,'idle');
   await assert.rejects(()=>api.reserve(ws,resource(),'approve-renewal',randomUUID()));
   current=make('fund-renewal');await current.prepare();assert.equal(current.snapshot().status,'review',current.snapshot().message);assert.equal(sends,before+1);const expected=current.snapshot().attempt!.preparation.renewal!.expectedD;
   lostWalletResponse=cycle===1;await current.confirm(current.snapshot().key!);assert.equal(sends,before+2);await current.reconcile();assert.equal(current.snapshot().status,'confirmed',current.snapshot().message);
   const out=current.snapshot().attempt!.proof!.outcome!;assert.equal(out.kind,'STATE_CHANGED');assert.equal('previousFundedThrough' in out&&out.previousFundedThrough,expected);assert.equal('fundedAmount' in out&&out.fundedAmount,'3000000');await current.restart();assert.equal(current.snapshot().status,'idle');
  }
 });
 await check('changed wallet chain/account, funded state and deadline block stale handoff',async()=>{
  for(const mode of ['chain','account','funded','deadline']){
   current=make('approve-renewal');await current.prepare();assert.equal(current.snapshot().status,'review',current.snapshot().message);const key=current.snapshot().key!,before=sends,prior=f.state();
   if(mode==='chain')walletChain='0x1';if(mode==='account')walletAccount=('0x'+'9'.repeat(40)) as Hex;
   if(mode==='funded')f.mutate({funded:prior.funded+f.terms.amountPerPeriod});if(mode==='deadline')f.mutate({time:f.terms.startAt+(prior.funded/f.terms.amountPerPeriod)*f.terms.periodSeconds});
   await current.confirm(key);assert.equal(sends,before);walletChain='0x4cef52';walletAccount=actor.address;if(mode==='funded'||mode==='deadline')f.mutate(prior);
   await current.reconcile(true);assert.equal(current.snapshot().status,'cancelled',current.snapshot().message);await current.restart();assert.equal(current.snapshot().status,'idle');
  }
 });
 await check('lost reservation response reloads same durable reservation and can cancel without sending',async()=>{
  current=make('approve-renewal');lostReserve=true;await current.prepare();assert.equal(current.snapshot().status,'locked');const before=sends;current=make('approve-renewal');await current.reconcile(true);assert.equal(current.snapshot().status,'cancelled',current.snapshot().message);assert.equal(sends,before);await current.restart();
 });
 const unknownAction=process.env.RENEWAL_ACTION==='fund'?'fund-renewal':'approve-renewal';
 if(unknownAction==='fund-renewal'){current=make('approve-renewal');await current.prepare();assert.equal(current.snapshot().status,'review',current.snapshot().message);await current.confirm(current.snapshot().key!);await current.reconcile();assert.equal(current.snapshot().status,'confirmed',current.snapshot().message);await current.restart();}
 const scenario=process.env.RENEWAL_CASE??'claim';
 await check('unknown '+unknownAction+' '+scenario+' handoff survives API/browser reload and blocks both renewal actions',async()=>{
  current=make(unknownAction);await current.prepare();assert.equal(current.snapshot().status,'review',current.snapshot().message);const key=current.snapshot().key!,before=sends;
  lostClaim=scenario==='claim';interrupted=scenario==='wallet';denied=scenario==='deny';await current.confirm(key);assert.equal(current.snapshot().status,'locked');assert.equal(sends,before+(scenario==='claim'?0:1));interrupted=false;denied=false;
  const id=JSON.parse(storage.getItem(current.storageKey)!).attemptId as string;assert.equal((await api.get(ws,id)).state,'unknown');
  await app!.close();await start();current=make(unknownAction);await current.prepare();await current.confirm(key);await current.reconcile();await current.restart();assert.equal(current.snapshot().status,'locked');assert.equal(sends,before+(scenario==='claim'?0:1));
  await assert.rejects(()=>api.claim(ws,id));
  await assert.rejects(()=>api.reserve(ws,resource(),'approve-renewal',randomUUID()));await assert.rejects(()=>api.reserve(ws,resource(),'fund-renewal',randomUUID()));
  await writeFile('/tmp/operator-renewal-restart.json',JSON.stringify({schema,workspace:ws,id}));
 });
 const off=await buildConfiguredServer({cfg,pool,skipMigration:true,logger:false});assert.equal((await off.inject({method:'GET',url:'/readiness'})).statusCode,503);await off.close();
 console.log(JSON.stringify({synthetic:true,scenario,unknownAction,passed:results.length,results,sends}));
}finally{await app?.close();await pool.end();}
