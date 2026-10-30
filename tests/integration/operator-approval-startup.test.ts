import {describe,it,expect,vi} from 'vitest';
import {join,resolve} from 'node:path';
const syntheticRoot=resolve('synthetic-operator-fixture');
import {artifactFixture} from '../../apps/recovery/src/artifact-verifier.fixture';
import {loadOperatorApprovalInputs} from '../../apps/api/src/operator-startup';
import {stringify} from '../../apps/api/src/reviewed-artifacts';
import type {RuntimeReader} from '../../apps/api/src/configured-runtime';
export function startupFixture(){
 const f=artifactFixture(),files=new Map<string,Uint8Array>(),artifacts:Record<string,unknown>={evidence:{}};
 for(const name of ['review','record','source','lock','build'] as const){artifacts[name]=name;files.set(join(syntheticRoot,name),f.bundle[name]);}
 for(const [id,bytes] of Object.entries(f.bundle.evidence)){const name='evidence-'+Object.keys(artifacts.evidence as object).length;(artifacts.evidence as Record<string,string>)[id]=name;files.set(join(syntheticRoot,name),bytes);}
 const descriptor={schemaVersion:1,config:f.config,finality:f.finality,artifacts};
 const refresh=()=>files.set(join(syntheticRoot,'config.json'),new TextEncoder().encode(stringify(descriptor)));refresh();
 const read=vi.fn(async(path:string)=>{const b=files.get(path);if(!b)throw Error('missing synthetic file');return b;});
 const reader=vi.fn(()=>({}) as RuntimeReader),env={NOTICEVAULT_OPERATOR_APPROVAL_CONFIG:join(syntheticRoot,'config.json'),NOTICEVAULT_OPERATOR_REVIEW_SHA256:f.anchor.reviewSha256};
 return {f,files,descriptor,refresh,read,reader,env};
}
describe('operator startup local reviewed bytes',()=>{
 it('absent config stays disabled without file or RPC access',async()=>{const f=startupFixture();expect(await loadOperatorApprovalInputs({},f)).toBeUndefined();expect(f.read).not.toHaveBeenCalled();expect(f.reader).not.toHaveBeenCalled();});
 it('loads exact reviewed bytes before constructing two read-only readers',async()=>{const f=startupFixture(),r=await loadOperatorApprovalInputs(f.env,f);expect(r?.config).toEqual(f.f.config);expect(f.reader).toHaveBeenCalledTimes(2);await expect(r!.runtime.readWallet()).rejects.toThrow('SERVER_HAS_NO_WALLET');});
 it.each(['missing pin','wrong pin','missing artifact','forged artifact','path escape','credential origin','unexpected config'])('rejects %s before RPC construction',async(kind)=>{
  const f=startupFixture();if(kind==='missing pin')Reflect.deleteProperty(f.env,'NOTICEVAULT_OPERATOR_REVIEW_SHA256');if(kind==='wrong pin')f.env.NOTICEVAULT_OPERATOR_REVIEW_SHA256=('0x'+'0'.repeat(64)) as typeof f.env.NOTICEVAULT_OPERATOR_REVIEW_SHA256;
  if(kind==='missing artifact')f.files.delete(join(syntheticRoot,'source'));if(kind==='forged artifact')f.files.set(join(syntheticRoot,'source'),new Uint8Array([1]));if(kind==='path escape')f.descriptor.artifacts.source='../escape';
  if(kind==='credential origin')f.descriptor.config={...f.descriptor.config,primaryRpcOrigin:'https://secret@example.com'};if(kind==='unexpected config')Object.assign(f.descriptor,{unexpected:true});f.refresh();
  await expect(loadOperatorApprovalInputs(f.env,f)).rejects.toThrow();expect(f.reader).not.toHaveBeenCalled();
 });
});
