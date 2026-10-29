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
import {settlementFixture} from './operator-settlement.fixture';
import {buildConfiguredServer} from '../../apps/api/src/configured-startup';
import {DurableAttemptClient} from '../../src/backend/durable-attempt';
import {OperatorApprovalController} from '../../src/backend/operator-approval';
Reflect.set(process.env,'NODE_ENV','test');
const action=(process.env.SETTLEMENT_ACTION??'start-notice') as 'start-notice'|'materialize-notice'|'claim-provider'|'claim-client-refund',scenario=process.env.SETTLEMENT_CASE??'positive';
const schema='nv_settlement_'+action.replaceAll('-','_')+'_'+scenario,db={host:process.env.NOTICEVAULT_TEST_SOCKET??'/tmp/nv-socket',port:5432,user:'postgres',password:'',database:process.env.NOTICEVAULT_TEST_DB??'noticevault_settlement_it',schema};
const cfg={configIdentity:'ARC_TESTNET' as const,port:3001,host:'127.0.0.1',db,sessionSecret:'test_session_secret_32_bytes_xxx!',cookieDomain:'localhost',allowedOrigins:['http://localhost:5173'],sessionTtlSecs:86400,challengeTtlSecs:300,allowedDomains:['localhost']};
const pool=createPool(db),actor=privateKeyToAccount(('0x'+'11'.repeat(32)) as Hex),ws=randomUUID();
let walletAccount=actor.address,walletChain='0x4cef52',lostReserve=false,denied=false,lostWalletResponse=false;
let app:Awaited<ReturnType<typeof buildConfiguredServer>>|undefined,cookie='',sends=0,interrupted=false,lostClaim=false,competingPayout=false;
const results:{name:string;passed:boolean}[]=[];
const check=async(name:string,fn:()=>Promise<void>)=>{await fn();results.push({name,passed:true});console.log('PASS '+name);};
try{
 const m=await runMigrations(pool,schema,'/home/user/app/packages/db/src/migrations');assert.deepEqual(m.errors,[]);
 await createWorkspace(pool,schema,ws,'Synthetic operator integration',actor.address);await addMembership(pool,schema,ws,actor.address,'owner',5042002n);
 const f=await settlementFixture({account:actor.address,pool,cfg});
 const artifactDir='/tmp/operator-artifacts-'+schema+'-'+ws;await mkdir(artifactDir,{mode:0o700});
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
   assert.equal(JSON.parse(storage.getItem(current!.storageKey)!).stage,'unknown');sends++;if(denied)throw Object.assign(Error('Synthetic denial'),{code:4001});if(interrupted)throw Error('Synthetic wallet interruption');if(competingPayout){competingPayout=false;f.noPayment();}if(scenario==='positive')f.mutate({time:f.state().time+1n});return f.send(params[0] as Record<string,unknown>);
  }throw Error('Unexpected synthetic wallet request');
 }};
 let current:OperatorApprovalController|undefined;
 const pins={chainId:'5042002',token:f.f.config.deployment.allowlistedToken!,factory:f.f.config.deployment.factoryAddress!,policyHash:f.composed.runtime.policyHash};
 const make=(requested=action,stream='settlement-stream')=>new OperatorApprovalController(ws,stream+':'+f.A,pins,provider,storage,locks,api,undefined,{agreement:f.A,streamId:stream,action:requested});
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
 await associate('settlement-stream');
 await check('authenticated roles and immutable beneficiaries',async()=>{
  const savedCookie=cookie,other=privateKeyToAccount(('0x'+'22'.repeat(32)) as Hex);await addMembership(pool,schema,ws,other.address,'member',5042002n);
  const challenge=await app!.inject({method:'POST',url:'/auth/challenge',headers:headers(),payload:{address:other.address,chainId:5042002}}),nonce=challenge.json();
  const verified=await app!.inject({method:'POST',url:'/auth/verify',headers:headers(),payload:{nonce:nonce.nonce,signature:await other.signMessage({message:nonce.message}),address:other.address,chainId:5042002}});assert.equal(verified.statusCode,200,verified.body);cookie=String(verified.headers['set-cookie']).split(';')[0]!;
  if(action==='start-notice')await assert.rejects(()=>api.reserve(ws,resource(),action,randomUUID()));
  else {const r=await api.reserve(ws,resource(),action,randomUUID());assert.equal(r.preparation.settlement!.callerRule,'PERMISSIONLESS_IMMUTABLE_BENEFICIARY');assert.equal(r.preparation.settlement!.recipient,action==='claim-provider'?f.terms.provider:action==='claim-client-refund'?f.terms.client:null);await api.cancel(ws,r.id);}
  cookie=savedCookie;assert.equal(sends,0);
 });
 await check('missing association and zero-effect preparation fail closed',async()=>{
  await assert.rejects(()=>api.reserve(ws,resource(('0x'+'7'.repeat(40)) as Hex),action,randomUUID()));
  const prior=f.state(),v=f.preview();
  if(action==='claim-provider')f.mutate({regularPaid:v.V,noticePaid:v.W});
  else if(action==='claim-client-refund')f.mutate({refunded:prior.refunded+v.clientRefundable});
  else f.mutate({notice:true,start:prior.time,reason:1});
  await assert.rejects(()=>api.reserve(ws,resource(),action,randomUUID()));f.mutate(prior);assert.equal(sends,0);
 });
 await check('account chain and accounting changes prevent stale handoff',async()=>{
  for(const mode of ['chain','account','state']){
   current=make();await current.prepare();assert.equal(current.snapshot().status,'review',current.snapshot().message);const key=current.snapshot().key!,before=sends,prior=f.state();
   if(mode==='chain')walletChain='0x1';if(mode==='account')walletAccount=('0x'+'9'.repeat(40)) as Hex;if(mode==='state')f.mutate({funded:prior.funded+3000000n});
   await current.confirm(key);assert.equal(sends,before);walletChain='0x4cef52';walletAccount=actor.address;if(mode==='state')f.mutate(prior);
   await current.reconcile(true);assert.equal(current.snapshot().status,'cancelled',current.snapshot().message);await current.restart();assert.equal(current.snapshot().status,'idle');
  }
 });
 await check('deliberate cancellation and lost reservation response survive reload without send',async()=>{
  current=make();await current.prepare();assert.equal(current.snapshot().status,'review',current.snapshot().message);await current.reconcile(true);assert.equal(current.snapshot().status,'cancelled');await current.restart();
  lostReserve=true;await current.prepare();assert.equal(current.snapshot().status,'locked');const before=sends;current=make();await current.reconcile(true);assert.equal(current.snapshot().status,'cancelled',current.snapshot().message);assert.equal(sends,before);await current.restart();
 });
 await check('canonical '+action+' '+scenario+' with durable no-repeat journal',async()=>{
  current=make();await current.prepare();assert.equal(current.snapshot().status,'review',current.snapshot().message);const key=current.snapshot().key!,before=sends;
  lostClaim=scenario==='claim';interrupted=scenario==='wallet';denied=scenario==='deny';lostWalletResponse=scenario==='positive';competingPayout=scenario==='noop';const reviewed=f.preview(),reviewTime=f.state().time;if(scenario==='positive')f.mutate({time:reviewTime+1n});
  await Promise.all([current.confirm(key),current.confirm(key)]);assert.equal(sends,before+(scenario==='claim'?0:1),JSON.stringify(current.snapshot()));interrupted=false;denied=false;
  if(scenario==='positive'||scenario==='noop'){
   for(let n=0;n<3&&current.snapshot().status!=='confirmed';n++)await current.reconcile();if(current.snapshot().status!=='confirmed')console.log('FAILED_EVIDENCE',JSON.stringify((await pool.query('SELECT * FROM '+schema+'.transaction_attempt_events ORDER BY id DESC LIMIT 3')).rows));assert.equal(current.snapshot().status,'confirmed',current.snapshot().message+' '+JSON.stringify(current.snapshot().attempt?.proof));
   const out=current.snapshot().attempt!.proof!.outcome;assert.ok(out);assert.equal(out.kind,scenario==='noop'?'NO_CHANGE':action.startsWith('claim-')?'TRANSFER':'STATE_CHANGED');
   if(out.kind==='TRANSFER'){assert.equal('recipient' in out&&out.recipient,(action==='claim-provider'?f.terms.provider:f.terms.client).toLowerCase());assert.ok('amount' in out&&BigInt(out.amount)>0n);}
   if(scenario==='positive'&&action==='claim-provider'){assert.ok('amount' in out&&BigInt(out.amount)>reviewed.providerClaimable);assert.ok(f.state().time>reviewTime);console.log('PASS later canonical payout exceeds reviewed estimate');}if(scenario==='noop'){assert.ok(current.snapshot().message.includes('No payment occurred'));assert.equal('amount' in out&&out.amount,'0');}
   await current.restart();assert.equal(current.snapshot().status,'idle');await assert.rejects(()=>api.reserve(ws,resource(),action,randomUUID()));
  }else{
   assert.equal(current.snapshot().status,'locked',current.snapshot().message);const id=JSON.parse(storage.getItem(current.storageKey)!).attemptId as string;assert.equal((await api.get(ws,id)).state,'unknown');
   await app!.close();await start();current=make();await current.prepare();await current.confirm(key);await current.reconcile();await current.restart();assert.equal(current.snapshot().status,'locked');assert.equal(sends,before+(scenario==='claim'?0:1));
   await assert.rejects(()=>api.claim(ws,id));await assert.rejects(()=>api.reserve(ws,resource(),action,randomUUID()));
  }
 });
 const off=await buildConfiguredServer({cfg,pool,skipMigration:true,logger:false});assert.equal((await off.inject({method:'GET',url:'/readiness'})).statusCode,503);await off.close();
 console.log(JSON.stringify({synthetic:true,action,scenario,passed:results.length,results,sends}));
}finally{await app?.close();await pool.end();}
