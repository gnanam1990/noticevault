import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cloudConfig} from './config';
import {apiShard,forwardApiRequest} from './routing';
const env={PUBLIC_ORIGIN:'https://synthetic.invalid',CONFIG_IDENTITY:'ARC_TESTNET',PGSCHEMA:'synthetic',PGHOST:'database.invalid',PGUSER:'synthetic',PGPASSWORD:'synthetic-unused-password',PGDATABASE:'synthetic',SESSION_SECRET:'synthetic-unused-session-secret-fixture'};
test('deployment config requires exact HTTPS and complete secret bindings; both chains retain TLS',()=>{
 for(const network of ['ARC_TESTNET','ARC_MAINNET']){const c=cloudConfig({...env,CONFIG_IDENTITY:network});assert.equal(c.db.ssl?.rejectUnauthorized,true);assert.equal(c.db.maxConnections,2);assert.equal(c.consentDeployment,undefined);assert.equal(c.deploymentEvidencePath,undefined);}
 for(const PUBLIC_ORIGIN of ['http://synthetic.invalid','https://synthetic.invalid/path','https://user@synthetic.invalid',''])assert.throws(()=>cloudConfig({...env,PUBLIC_ORIGIN}));
 for(const key of ['SESSION_SECRET','PGPASSWORD','PGHOST','PGUSER','PGDATABASE'])assert.throws(()=>cloudConfig({...env,[key]:''}));
 assert.throws(()=>cloudConfig({...env,CONFIG_IDENTITY:'LOCAL_FIXTURE'}));assert.throws(()=>cloudConfig({...env,PGSCHEMA:'bad;sql'}));
});
test('proxy preserves absent/forged/correct Origin, cookies, CSRF, idempotency and exact body',async()=>{
 for(const origin of [undefined,'https://forged.invalid',env.PUBLIC_ORIGIN]){
 const headers={'Content-Type':'application/json',Cookie:'nv_session=synthetic','X-Requested-With':'XMLHttpRequest','Idempotency-Key':'synthetic-key',...(origin?{Origin:origin}:{})};
 const r=new Request(env.PUBLIC_ORIGIN+'/api/auth/verify?x=1',{method:'POST',headers,body:'{"fixture":true}'}),f=forwardApiRequest(r,env.PUBLIC_ORIGIN);
 assert.equal(f.url,env.PUBLIC_ORIGIN+'/auth/verify?x=1');assert.equal(f.method,'POST');assert.deepEqual([...f.headers],[...r.headers]);assert.equal(await f.text(),'{"fixture":true}');
 }
 assert.throws(()=>forwardApiRequest(new Request('https://other.invalid/api/auth/network'),env.PUBLIC_ORIGIN));
 assert.equal(forwardApiRequest(new Request(env.PUBLIC_ORIGIN+'/v1/auth/network'),env.PUBLIC_ORIGIN).url,env.PUBLIC_ORIGIN+'/v1/auth/network');
});
test('routing uses four bounded buckets, never changes request or authorizes identity',()=>{
 const buckets=new Set<number>();for(let i=1;i<=32;i++){const r=new Request(env.PUBLIC_ORIGIN+'/api/auth/me',{headers:{'cf-connecting-ip':'198.51.100.'+i,Cookie:'nv_session=synthetic'}});const before=[...r.headers];const clientKey='edge-ip:198.51.100.'+i;const bucket=apiShard(clientKey);assert.ok(bucket>=0&&bucket<4);assert.equal(bucket,apiShard(clientKey));assert.deepEqual([...r.headers],before);buckets.add(bucket);}assert.equal(buckets.size,4);
});
