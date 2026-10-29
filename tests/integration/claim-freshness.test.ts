import {describe,it,expect} from 'bun:test';
import {serializeTerms} from '../../packages/sdk/src/index';
import {operatorFixture} from './operator-approval.fixture';
import {assertClaimFreshness,settlementCycleKey} from '../../apps/api/src/attempt-freshness';
import {preparationBinding,type AttemptPreparation} from '../../apps/api/src/attempt-evidence';
const input=(actor:string)=>({workspaceId:crypto.randomUUID(),actor,chainId:'5042002',resource:'draft:'+crypto.randomUUID(),action:'approve-creation'});
async function pair(){const f=await operatorFixture();const i=input(f.account);const old=await f.composed.adapter.prepare(i);f.advanceBlock();const fresh=await f.composed.adapter.prepare(i);return {f,old,fresh};}
async function settlement(action='claim-provider'){
 const {f,old,fresh}=await pair(),now=BigInt(Math.floor(Date.now()/1000));
 const terms=serializeTerms({...f.terms,startAt:now-1800n,periodSeconds:3600n,noticeSeconds:3600n});
 const make=(base:AttemptPreparation,time:bigint):AttemptPreparation=>{const {approval: _approval,...rest}=base;const p:AttemptPreparation={...rest,resource:'agreement:0x'+'8'.repeat(40),action,target:'0x'+'8'.repeat(40),business:{termsHash:'0x'+'7'.repeat(64),agreementCodeHash:'0x'+'6'.repeat(64)},settlement:{agreement:'0x'+'8'.repeat(40),streamId:'synthetic',fingerprint:'7'.repeat(64),terms,recipient:action==='claim-provider'?terms.provider:null,amount:action==='claim-provider'?String(3000000n*(time-(now-1800n))/3600n):'0',noticeStart:action==='start-notice'?String(time):null,noticeEnd:action==='start-notice'?String(time+3600n):null,noticeReason:action==='start-notice'?'CLIENT_CANCELLED':'NONE',callerRule:action==='start-notice'?'CLIENT_ONLY':'PERMISSIONLESS_IMMUTABLE_BENEFICIARY',accounting:{regularFunded:'3000000',regularPaid:'0',noticePaid:'0',clientRefunded:'0',noticeReserve:'3000000',liability:'6000000',fundedThrough:String(now+1800n),observedAt:String(time)}}};p.cycleKey=settlementCycleKey(p);return p;};
 return {f,old:make(old,now),fresh:make(fresh,now+1n)};
}
describe('canonical passage of time preserves original durable review',()=>{
 it('accepts an unchanged SDK approval after a block while retaining the original binding',async()=>{const {f,old,fresh}=await pair();const saved=structuredClone(old),binding=preparationBinding(old);expect(preparationBinding(fresh)).not.toBe(binding);await assertClaimFreshness(f.composed.adapter,old,fresh);expect(old).toEqual(saved);expect(preparationBinding(old)).toBe(binding);});
 it('rejects expired original reviews even when fresh preparation is current',async()=>{const {f,old,fresh}=await pair();old.issuedAt=Date.now()-60001;await expect(assertClaimFreshness(f.composed.adapter,old,fresh)).rejects.toThrow();});
 it('rejects a reorg of the original anchor',async()=>{const {f,old,fresh}=await pair();const a=f.composed.adapter;await expect(assertClaimFreshness({...a,rpc:{...a.rpc,getBlock:async n=>({...await a.rpc.getBlock(n),hash:'0x'+'f'.repeat(64)})}},old,fresh)).rejects.toThrow();});
 it('rejects changed nonce, calldata, allowance, policy and backward block',async()=>{const {f,old,fresh}=await pair();for(const change of [{networkNonce:'1'},{data:'0x12345678'},{approval:{spender:fresh.approval!.spender,amount:'1'}},{policyHash:'0x'+'e'.repeat(64)},{discoveryAnchor:{blockNumber:'9',blockHash:'0x'+'9'.repeat(64)}}])await expect(assertClaimFreshness(f.composed.adapter,old,{...fresh,...change})).rejects.toThrow();});
 it('accepts only mathematically verified provider accrual as time advances',async()=>{const {f,old,fresh}=await settlement();await assertClaimFreshness(f.composed.adapter,old,fresh);const bad=structuredClone(fresh);bad.settlement!.amount='5999999';bad.cycleKey=settlementCycleKey(bad);await expect(assertClaimFreshness(f.composed.adapter,old,bad)).rejects.toThrow();});
 it('rejects changed paid state, beneficiary and forged cycle key',async()=>{const {f,old,fresh}=await settlement();for(const field of ['regularPaid','liability']){const p=structuredClone(fresh);p.settlement!.accounting[field]='1';p.cycleKey=settlementCycleKey(p);await expect(assertClaimFreshness(f.composed.adapter,old,p)).rejects.toThrow();}const p=structuredClone(fresh);p.settlement!.recipient=old.actor;p.cycleKey=settlementCycleKey(p);await expect(assertClaimFreshness(f.composed.adapter,old,p)).rejects.toThrow();await expect(assertClaimFreshness(f.composed.adapter,old,{...fresh,cycleKey:'0x'+'f'.repeat(64)})).rejects.toThrow();});
 it('accepts estimated cancellation timing but rejects deadline crossing',async()=>{const {f,old,fresh}=await settlement('start-notice');await assertClaimFreshness(f.composed.adapter,old,fresh);const p=structuredClone(fresh);p.settlement!.noticeReason='MISSED_CHECKPOINT';p.cycleKey=settlementCycleKey(p);await expect(assertClaimFreshness(f.composed.adapter,old,p)).rejects.toThrow();});
});

it('retains the historical cycle identity after nested JSON object key reordering',async()=>{
 const {f,old,fresh}=await settlement();
 const reorder=(v:unknown):unknown=>Array.isArray(v)?v.map(reorder):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reorder(x)])):v;
 const stored=JSON.parse(JSON.stringify(reorder(old))) as AttemptPreparation;
 expect(settlementCycleKey(stored)).toBe(old.cycleKey);
 await assertClaimFreshness(f.composed.adapter,stored,fresh);
 expect(stored.cycleKey).toBe(old.cycleKey);
});
it('rejects a different hash at the same height before consulting providers',async()=>{
 const {f,old,fresh}=await pair();fresh.discoveryAnchor={...old.discoveryAnchor!,blockHash:'0x'+'9'.repeat(64)};
 await expect(assertClaimFreshness(f.composed.adapter,old,fresh)).rejects.toThrow();
});
it('rejects backward observed time with an otherwise valid cycle hash',async()=>{
 const {f,old,fresh}=await settlement();fresh.settlement!.accounting.observedAt=String(BigInt(old.settlement!.accounting.observedAt!)-1n);fresh.cycleKey=settlementCycleKey(fresh);
 await expect(assertClaimFreshness(f.composed.adapter,old,fresh)).rejects.toThrow();
});
