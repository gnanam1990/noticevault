/** Isolated synthetic identities/documents only; actual API and PostgreSQL. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {keccak256,toHex} from 'viem';
import {createPool,runMigrations,createSession,createWorkspace,addMembership,createDraft} from '../../packages/db/src/index';
import {LOCAL_FIXTURE_DEPLOYMENT} from '../../packages/sdk/src/index';
import {buildServer} from '../../apps/api/src/server';
import {revisionAccess} from '../../apps/api/src/private-revisions';
Reflect.set(process.env,'NODE_ENV','test');
const deployment={...LOCAL_FIXTURE_DEPLOYMENT,factoryAddress:('0x'+'3'.repeat(40)) as import('viem').Hex};
const schema='nv_revisions',db={host:process.env.NOTICEVAULT_TEST_SOCKET??'/tmp/nv-socket',port:5432,user:'postgres',password:'',database:process.env.NOTICEVAULT_TEST_DB??'noticevault_identity_it',schema};
const cfg={configIdentity:'LOCAL_FIXTURE' as const,consentDeployment:deployment,port:3001,host:'127.0.0.1',db,sessionSecret:'synthetic_only_fixture_secret_32_bytes',cookieDomain:'localhost',allowedOrigins:['http://localhost:5173'],sessionTtlSecs:86400,challengeTtlSecs:300,allowedDomains:['localhost']};
const pool=createPool(db),ws=randomUUID(),draftId=randomUUID(),owner='0x'+'1'.repeat(40),provider='0x'+'2'.repeat(40),sid=randomUUID(),psid=randomUUID(),wrong=randomUUID(),chain=LOCAL_FIXTURE_DEPLOYMENT.chainId;
const document='Synthetic private agreement — preserve exact UTF-8 bytes.';
const terms={schemaVersion:1,client:owner,provider,token:'0x'+'4'.repeat(40),amountPerPeriod:'3000000000',periodSeconds:'2592000',noticeSeconds:'2592000',startAt:String(Math.floor(Date.now()/1000)+7200),clientNonce:'0',acceptanceDeadline:String(Math.floor(Date.now()/1000)+3600),termsDocumentHash:keccak256(toHex(document))};
let app:Awaited<ReturnType<typeof buildServer>>|undefined;
try{
 assert.deepEqual((await runMigrations(pool,schema,'/home/user/app/packages/db/src/migrations')).errors,[]);
 await createWorkspace(pool,schema,ws,'Synthetic private revisions',owner);await addMembership(pool,schema,ws,owner,'owner',chain);
 for(const [id,address,ch] of [[sid,owner,chain],[psid,provider,chain],[wrong,provider,1n]] as const)await createSession(pool,schema,id,address,ch,new Date(Date.now()+3600000));
 await createDraft(pool,schema,draftId,ws,owner,terms,'0x'+'0'.repeat(64));
 app=await buildServer({cfg,pool,skipMigration:true,logger:false});await app.ready();
 const request=async(method:'GET'|'POST'|'DELETE'|'PUT',path:string,body?:Record<string,unknown>,session=sid,key=randomUUID())=>app!.inject({method,url:path,headers:{origin:'http://localhost:5173','x-requested-with':'XMLHttpRequest','idempotency-key':key,cookie:'nv_session='+session},...(body===undefined?{}:{payload:body})});
 const path='/workspaces/'+ws+'/drafts/'+draftId+'/revisions',payload={termsJson:terms,documentText:document,expectedRevisionNumber:0},key=randomUUID();
 const created=await request('POST',path,payload,sid,key);assert.equal(created.statusCode,201,created.body);const revision=created.json().id;
 await addMembership(pool,schema,ws,provider,'member',chain);
 const consentConnection=await pool.connect(),revocationConnection=await pool.connect();
 try {
  await consentConnection.query('BEGIN');await revisionAccess(consentConnection,schema,psid,ws,revision,true,deployment);
  await revocationConnection.query('BEGIN');await revocationConnection.query("SET LOCAL lock_timeout='100ms'");
  await assert.rejects(revocationConnection.query('DELETE FROM '+schema+'.workspace_memberships WHERE workspace_id=$1 AND member_address=$2 AND chain_id=$3',[ws,provider,String(chain)]),(error:unknown)=>typeof error==='object'&&error!==null&&'code' in error&&error.code==='55P03');
  await revocationConnection.query('ROLLBACK');await consentConnection.query('COMMIT');
  await revocationConnection.query('DELETE FROM '+schema+'.workspace_memberships WHERE workspace_id=$1 AND member_address=$2 AND chain_id=$3',[ws,provider,String(chain)]);
  await consentConnection.query('BEGIN');await assert.rejects(()=>revisionAccess(consentConnection,schema,psid,ws,revision,true,deployment));await consentConnection.query('ROLLBACK');
  console.log('PASS membership revocation serializes with consent and revoked provider cannot accept without grant');
 }finally{await consentConnection.query('ROLLBACK');await revocationConnection.query('ROLLBACK');consentConnection.release();revocationConnection.release();}

 assert.equal((await request('POST',path,payload,sid,key)).json().id,revision);
 assert.equal((await request('POST',path,{...payload,documentText:'tampered'},sid)).statusCode,409);
 assert.equal((await request('POST',path,payload)).statusCode,409);
 const original=(await pool.query('SELECT * FROM '+schema+'.terms_drafts WHERE id=$1',[draftId])).rows[0];assert.equal(original.doc_hash,'0x'+'0'.repeat(64));
 await assert.rejects(()=>pool.query('UPDATE '+schema+'.terms_drafts SET version=version+1 WHERE id=$1',[revision]),/new immutable revision/);
 await assert.rejects(()=>pool.query('UPDATE '+schema+'.draft_revisions SET document_bytes=$2 WHERE id=$1',[revision,Buffer.from('tampered')]),/Immutable revision/);
 assert.equal((await request('PUT','/workspaces/'+ws+'/drafts/'+revision,{expectedVersion:1,termsJson:terms})).statusCode,409);
 console.log('PASS exact bytes/hash, immutable storage, legacy preservation, stale-head rejection and idempotent retries');
 const packet='/workspaces/'+ws+'/revisions/'+revision+'/acceptance-packet',grants='/workspaces/'+ws+'/revisions/'+revision+'/provider-grants';
 const ownerPacket=await request('GET',packet);assert.equal(ownerPacket.statusCode,200,ownerPacket.body);assert.equal(ownerPacket.json().documentText,document);assert.ok(ownerPacket.json().domain);
 assert.equal((await request('GET',packet,undefined,psid)).statusCode,403);
 assert.equal((await request('POST',grants,{provider:owner})).statusCode,400);
 assert.equal((await request('POST',grants,{expiresAt:new Date(Date.now()+86400000).toISOString()})).statusCode,400);
 const grant=await request('POST',grants,{});assert.equal(grant.statusCode,201,grant.body);assert.equal(grant.json().provider_address,provider);assert.equal(String(grant.json().chain_id),String(chain));
 assert.equal((await request('GET',packet,undefined,psid)).json().documentText,document);
 assert.equal((await request('GET',packet,undefined,wrong)).statusCode,403);
 assert.equal((await request('GET','/workspaces/'+ws+'/drafts/'+revision,undefined,psid)).statusCode,403);
 const c=await pool.connect();try{await c.query('BEGIN');assert.ok(await revisionAccess(c,schema,psid,ws,revision,true,deployment));await c.query('COMMIT');}finally{c.release();}
 const next=await request('POST',path,{...payload,expectedRevisionNumber:1});assert.equal(next.statusCode,201,next.body);assert.notEqual(next.json().id,revision);
 assert.equal((await request('GET','/workspaces/'+ws+'/revisions/'+next.json().id+'/acceptance-packet',undefined,psid)).statusCode,403);
 assert.equal((await request('DELETE',grants+'/'+grant.json().id)).statusCode,204);
 assert.equal((await request('GET',packet,undefined,psid)).statusCode,403);
 const expired=await request('POST',grants,{expiresAt:new Date(Date.now()-1000).toISOString()});assert.equal(expired.statusCode,409);
 const fresh=await request('POST',grants,{});assert.equal(fresh.statusCode,201,fresh.body);await pool.query('UPDATE '+schema+'.revision_provider_grants SET expires_at=$2 WHERE id=$1',[fresh.json().id,new Date(Date.now()-1000)]);assert.equal((await request('GET',packet,undefined,psid)).statusCode,403);
 const recheck=await pool.connect();try{await recheck.query('BEGIN');await assert.rejects(()=>revisionAccess(recheck,schema,psid,ws,revision,true,deployment),/grant required/);await recheck.query('ROLLBACK');}finally{recheck.release();}
 console.log('PASS exact provider/chain grant, bounded expiry, private packet, consent authorization, no workspace rights, no cross-revision inheritance and revocation');
 assert.equal((await app.inject({method:'GET',url:'/readiness'})).statusCode,503);
}finally{await app?.close();await pool.end();}
