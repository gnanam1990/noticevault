import {createBoundedCandidateLocator} from '../../apps/api/src/canonical-discovery';
import {createArcCanonicalAttemptRpc} from '../../apps/api/src/arc-finality';
/** Synthetic composition: real artifact/SDK/API client/controller/outcome, fake durable transport. */
import {describe,it,expect,vi} from 'vitest';
import {operatorFixture} from './operator-approval.fixture';
import {OperatorApprovalController} from '../../src/backend/operator-approval';
import {DurableAttemptClient,type DurableAttempt} from '../../src/backend/durable-attempt';
import {preparationBinding,reconcileCanonical,type AttemptPreparation} from '../../apps/api/src/attempt-evidence';
const ws='11111111-1111-4111-8111-111111111111',draft='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
async function setup(){
 const f=await operatorFixture(),memory=new Map<string,string>(),storage={getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>{memory.set(k,v);}};
 let record:(DurableAttempt&{preparation:AttemptPreparation})|null=null,account=f.account,chain='0x4cef52',sends=0,interrupted=false,claimLost=false,onClaim=()=>{},onSend=()=>{};const events=new Set<()=>void>();
 let queue=Promise.resolve();const locks={request:async<T>(_key:string,fn:()=>Promise<T>)=>{const next=queue.then(fn);queue=next.then(()=>{},()=>{});return next;}};
 const locator=createBoundedCandidateLocator(f.runtime.primary.reader,{fromBlock:10n,toBlock:10n});
 const canonical={...f.composed.adapter,rpc:createArcCanonicalAttemptRpc(f.runtime.finality,f.runtime.primary,f.runtime.verification,locator)};
 const api=new DurableAttemptClient(async(url,init)=>{
  const path=String(url),body=init?.body?JSON.parse(String(init.body)):null;
  if(path.endsWith('/attempts')){if(!record){const p=await f.composed.adapter.prepare({workspaceId:ws,actor:account,chainId:'5042002',resource:body.resource,action:body.action});record={source:p.source,id,workspaceId:ws,account,chainId:p.chainId,resource:p.resource,action:p.action,binding:preparationBinding(p),state:'reserved',revision:0,hash:null,preparation:p};}}
  else if(path.endsWith('/claim')){const p=await f.composed.adapter.prepare(record!.preparation);if(record!.state!=='reserved'||preparationBinding(p)!==record!.binding)return new Response('{}',{status:409});record={...record!,state:'unknown',claimed:true,revision:1};onClaim();if(claimLost)throw Error('Lost claim response');}
  else if(path.endsWith('/cancel')){if(record!.state==='reserved')record={...record!,state:'cancelled'};}
  else if(path.endsWith('/reconcile')){if(!['reserved','cancelled'].includes(record!.state))record={...record!,...await reconcileCanonical(canonical,record!.preparation,null)};}
  return new Response(JSON.stringify(record),{headers:{'content-type':'application/json'}});
 },'OPERATOR_CONFIGURED');
 const provider={request:async({method,params}:{method:string;params?:unknown[]})=>{if(method==='eth_requestAccounts'||method==='eth_accounts')return [account];if(method==='eth_chainId')return chain;if(method==='eth_sendTransaction'){sends++;expect(record!.state).toBe('unknown');expect([...memory.values()].some(v=>JSON.parse(v).stage==='unknown')).toBe(true);onSend();if(interrupted)throw Error('Transport interrupted');return f.send(params![0] as Record<string,unknown>);}throw Error('Unexpected wallet request');},on:(_e:string,fn:()=>void)=>events.add(fn),removeListener:(_e:string,fn:()=>void)=>events.delete(fn)};
 const make=()=>new OperatorApprovalController(ws,draft,{chainId:'5042002',token:f.f.config.deployment.allowlistedToken!,factory:f.f.config.deployment.factoryAddress!,policyHash:f.composed.runtime.policyHash},provider,storage,locks,api);
 return {f,make,storage,memory,controller:make(),sends:()=>sends,record:()=>record!,drift:()=>{account='0x'+'9'.repeat(40);},event:()=>events.forEach(fn=>fn()),interrupt:()=>{interrupted=true;},loseClaim:()=>{claimLost=true;},onClaim:(fn:()=>void)=>{onClaim=fn;},onSend:(fn:()=>void)=>{onSend=fn;},wrongChain:()=>{chain='0x1';}};
}
describe('synthetic connected operator approval',()=>{
 it('requires explicit review, journals before send, canonically confirms allowance',async()=>{const f=await setup(),c=f.controller;await c.prepare();expect(c.snapshot()).toMatchObject({status:'review'});expect(f.sends()).toBe(0);await c.confirm('wrong');expect(f.sends()).toBe(0);await c.confirm(c.snapshot().key!);expect(f.sends()).toBe(1);await c.reconcile();expect(c.snapshot().status,c.snapshot().message).toBe('confirmed');});
 it('blocks repeated concurrent confirmation',async()=>{const f=await setup(),c=f.controller;await c.prepare();const key=c.snapshot().key!;await Promise.all([c.confirm(key),c.confirm(key)]);await c.confirm(key);expect(f.sends()).toBe(1);});
 it('restores submitted uncertainty after reload without resending',async()=>{const f=await setup(),c=f.controller;await c.prepare();await c.confirm(c.snapshot().key!);c.dispose();const restored=f.make();await restored.prepare();expect(f.sends()).toBe(1);await restored.reconcile();expect(restored.snapshot().status,restored.snapshot().message).toBe('confirmed');});
 it('preserves interrupted sends across reload',async()=>{const f=await setup(),c=f.controller;f.interrupt();await c.prepare();await c.confirm(c.snapshot().key!);const restored=f.make();await restored.reconcile();await restored.prepare();expect(restored.snapshot().status).toBe('locked');expect(f.sends()).toBe(1);});
 it('does not send after a lost claim response',async()=>{const f=await setup(),c=f.controller;f.loseClaim();await c.prepare();await c.confirm(c.snapshot().key!);expect(f.sends()).toBe(0);expect(f.record().state).toBe('unknown');await f.make().reconcile();expect(f.sends()).toBe(0);});
 it('cancels an unclaimed reservation',async()=>{const f=await setup(),c=f.controller;await c.prepare();c.invalidate();await c.reconcile(true);expect(c.snapshot().status).toBe('cancelled');expect(f.sends()).toBe(0);});
 it('blocks silent account drift and wrong chain',async()=>{const f=await setup(),c=f.controller;await c.prepare();f.drift();await c.confirm(c.snapshot().key!);expect(f.sends()).toBe(0);const g=await setup();g.wrongChain();await g.controller.prepare();expect(g.controller.snapshot().status).toBe('error');});
 it('locks an interruption after claim',async()=>{const f=await setup(),c=f.controller;await c.prepare();f.onClaim(()=>f.event());await c.confirm(c.snapshot().key!);expect(f.sends()).toBe(0);expect(f.record().state).toBe('unknown');});
 it('blocks stale draft review',async()=>{const f=await setup(),c=f.controller;await c.prepare();f.f.row.version++;await c.confirm(c.snapshot().key!);expect(f.sends()).toBe(0);expect(c.snapshot().status).toBe('locked');});
 it('preserves corrupt journal and blocks another reservation',async()=>{const f=await setup();f.memory.set(f.controller.storageKey,'broken');const c=f.make();await c.prepare();expect(c.snapshot().status).toBe('locked');expect(f.memory.get(c.storageKey)).toBe('broken');const g=await setup();await g.controller.prepare();await g.make().prepare();expect(g.sends()).toBe(0);});
 it('expires review without sending',async()=>{const f=await setup(),c=f.controller;await c.prepare();const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+61000);try{await c.confirm(c.snapshot().key!);expect(f.sends()).toBe(0);}finally{vi.restoreAllMocks();}});
});
describe('terminal approval journal rollover',()=>{
 it('archives cancelled evidence before allowing a fresh review',async()=>{const h=await setup();await h.controller.prepare();await h.controller.reconcile(true);const before=h.storage.getItem(h.controller.storageKey);await h.controller.restart();expect(h.controller.snapshot().status).toBe('idle');expect(h.storage.getItem(h.controller.storageKey)).toBe('');expect([...h.memory.entries()].find(([k])=>k.includes(':history:'))?.[1]).toContain(JSON.parse(before!).requestId);});
 it('preserves active journal on archive quota failure',async()=>{const h=await setup();await h.controller.prepare();await h.controller.reconcile(true);const before=h.storage.getItem(h.controller.storageKey),original=h.storage.setItem;h.storage.setItem=(k,v)=>{if(k.includes(':history:'))throw Error('quota');original(k,v);};await h.controller.restart();expect(h.controller.snapshot().status).toBe('locked');expect(h.storage.getItem(h.controller.storageKey)).toBe(before);});
 it('cannot roll over an unknown wallet interruption',async()=>{const h=await setup();await h.controller.prepare();h.interrupt();await h.controller.confirm(h.controller.snapshot().key!);const before=h.storage.getItem(h.controller.storageKey);await h.controller.restart();expect(h.storage.getItem(h.controller.storageKey)).toBe(before);expect(h.sends()).toBe(1);});
 it('preserves conflicting historical bytes',async()=>{const h=await setup();await h.controller.prepare();await h.controller.reconcile(true);const before=h.storage.getItem(h.controller.storageKey)!;h.storage.setItem(h.controller.storageKey+':history:'+JSON.parse(before).requestId,'prior evidence');await h.controller.restart();expect(h.controller.snapshot().status).toBe('locked');expect(h.storage.getItem(h.controller.storageKey)).toBe(before);});
});
