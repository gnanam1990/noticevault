import {describe,it,expect} from 'vitest';
import {join,resolve,relative,sep} from 'node:path';
import {artifactFixture} from './artifact-verifier.fixture';
import {agreementFixture} from './fixture';
import {loadHostedOperatorInputs} from '../../cloudflare/src/operator-inputs';
import {buildHostedApi} from '../../cloudflare/src/api-composition';
import {cloudConfig} from '../../cloudflare/src/config';
import {loadOperatorApprovalInputs} from '../../api/src/operator-startup';
import type {RuntimeReader} from '../../api/src/configured-runtime';
const cfg=cloudConfig({PUBLIC_ORIGIN:'https://synthetic.invalid',CONFIG_IDENTITY:'ARC_TESTNET',PGSCHEMA:'synthetic',PGHOST:'db.invalid',PGUSER:'synthetic',PGPASSWORD:'synthetic',PGDATABASE:'synthetic',SESSION_SECRET:'synthetic-only-000000000000000000000'});
function fixture(){
 const f=artifactFixture(),rpc=agreementFixture().rpc,files:Record<string,string>={},artifacts:Record<string,unknown>={};
 for(const name of ['review','record','source','lock','build'] as const){artifacts[name]=name;files[name]=Buffer.from(f.bundle[name]).toString('base64');}
 artifacts.evidence=Object.fromEntries(Object.entries(f.bundle.evidence).map(([id,bytes])=>{const name='evidence/'+id;files[name]=Buffer.from(bytes).toString('base64');return [id,name];}));
 const document={schemaVersion:1,config:f.config,finality:{...f.finality,chainId:String(f.finality.chainId)},artifacts};
 const bundle={config:JSON.stringify(document,(_,v)=>typeof v==='bigint'?String(v):v),files};
 let calls=0;const reader=()=>{calls++;return {...rpc,getBlockNumber:async()=>123n,getTransaction:async()=>null,getTransactionReceipt:async()=>null} as unknown as RuntimeReader;};
 return {f,bundle,document,reader,calls:()=>calls};
}
describe('Cloudflare reviewed operator startup (synthetic bytes/providers only)',()=>{
 it('missing configuration stays disabled; partial configuration cannot silently fall back',async()=>{
  expect(await loadHostedOperatorInputs(null,undefined)).toBeUndefined();
  await expect(loadHostedOperatorInputs(null,'0x'+'11'.repeat(32))).rejects.toThrow('INPUTS_REQUIRED');
  await expect(loadHostedOperatorInputs(fixture().bundle,undefined)).rejects.toThrow('INPUTS_REQUIRED');
 });
 it('actual shared verifier and paired runtime compose host routes; Node loader remains equivalent',async()=>{
  const x=fixture(),deps={reader:x.reader};
  const hosted=await loadHostedOperatorInputs(x.bundle,x.f.anchor.reviewSha256,deps);expect(hosted?.config).toEqual(x.f.config);expect(x.calls()).toBe(2);
  const syntheticRoot=resolve('synthetic-cloudflare-fixture'),configPath=join(syntheticRoot,'config.json');
  const node=await loadOperatorApprovalInputs({NOTICEVAULT_OPERATOR_APPROVAL_CONFIG:configPath,NOTICEVAULT_OPERATOR_REVIEW_SHA256:x.f.anchor.reviewSha256},{...deps,read:async path=>path===configPath?Buffer.from(x.bundle.config):Buffer.from(x.bundle.files[relative(syntheticRoot,path).split(sep).join('/')]!,'base64')});expect(node?.config).toEqual(hosted?.config);
  const pool={query:()=>{throw Error('UNEXPECTED_DATABASE_USE');}} as unknown as Parameters<typeof buildHostedApi>[1];
  const app=await buildHostedApi(cfg,pool,x.bundle,x.f.anchor.reviewSha256,deps);try{await app.ready();const r=await app.inject({url:'/readiness'});expect(r.statusCode).toBe(503);expect(r.json().state).toBe('READ_ONLY_COMPOSED');expect(r.json().executionEnabled).toBe(false);const n=await app.inject({url:'/auth/network'});expect(n.json().chainId).toBe('5042002');const auth=await app.inject({method:'POST',url:'/auth/logout',payload:{}});expect(auth.statusCode).toBe(403);}finally{await app.close();}
 });
 it('rejects tampered bytes, untrusted review, missing files, traversal and extra files',async()=>{
  for(const mutate of [(x:ReturnType<typeof fixture>)=>{x.bundle.files={...x.bundle.files,source:Buffer.from('tampered').toString('base64')};},(x:ReturnType<typeof fixture>)=>{delete (x.bundle.files as Record<string,string>).record;},(x:ReturnType<typeof fixture>)=>{x.document.artifacts.review='../review';x.bundle.config=JSON.stringify(x.document,(_,v)=>typeof v==='bigint'?String(v):v);},(x:ReturnType<typeof fixture>)=>{x.bundle.files={...x.bundle.files,extra:'eA=='};}]){const x=fixture();mutate(x);await expect(loadHostedOperatorInputs(x.bundle,x.f.anchor.reviewSha256,{reader:x.reader})).rejects.toThrow();}
  const x=fixture();await expect(loadHostedOperatorInputs(x.bundle,'0x'+'00'.repeat(32),{reader:x.reader})).rejects.toThrow('UNTRUSTED_REVIEW');expect(x.calls()).toBe(0);
 });
 it('wrong deployment network and disagreeing providers cannot start the operator host',async()=>{
  const x=fixture(),pool={} as Parameters<typeof buildHostedApi>[1];await expect(buildHostedApi({...cfg,configIdentity:'ARC_MAINNET'},pool,x.bundle,x.f.anchor.reviewSha256,{reader:x.reader})).rejects.toThrow();
  let n=0;await expect(buildHostedApi(cfg,pool,x.bundle,x.f.anchor.reviewSha256,{reader:()=>({...x.reader(),getChainId:async()=>++n===1?5042002:5042})})).rejects.toThrow();
 });
});
