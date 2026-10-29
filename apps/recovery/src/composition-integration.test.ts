import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {syntheticComposition} from './composition-integration.fixture';
import {JOURNAL_KEY} from './journal';
const clock=Date.now();
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(clock);});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
describe('SYNTHETIC full recovery composition through real verifier and RPC/wallet adapters',()=>{
  it('pins review, journals before sending and canonically confirms the fixed-beneficiary payout',async()=>{
    const h=syntheticComposition(), c=h.makeController();
    expect(h.walletCalls).toEqual([]); expect(h.rpcCalls).toEqual([]);
    await c.connect(); const review=await c.prepare('claim-provider',h.agreement,h.manifest);
    expect(review.recipient).toBe(h.f.terms.provider.toLowerCase());
    expect(review.amount).toBe(String(h.amount)); expect(h.sent).toHaveLength(0);
    h.state.beforeWallet=()=>expect(h.entries().at(-1)?.state).toBe('unknown');
    const entry=await c.confirm(review.id); expect(entry.state).toBe('submitted'); expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({to:h.agreement,from:h.f.terms.provider.toLowerCase(),value:'0x0',nonce:'0x0'});
    const resolved=await c.reconcile(entry.id); expect(resolved.state).toBe('confirmed');
    expect(resolved.proof).toMatchObject({outcome:{kind:'TRANSFER',recipient:h.f.terms.provider,amount:String(h.amount)}});
    expect(h.entries()[0]?.state).toBe('confirmed');
    expect(new Set(h.rpcCalls.map(x=>x.origin)).size).toBe(2);
    expect(h.rpcCalls.some(x=>x.method==='eth_getTransactionReceipt')).toBe(true); c.dispose();
  });
});
describe('SYNTHETIC cancellation, stale review and repeated confirmation',()=>{
  it('requires explicit connection before any claim review',async()=>{
    const h=syntheticComposition(),c=h.makeController();
    await expect(c.prepare('claim-provider',h.agreement,h.manifest)).rejects.toThrow('EXPLICIT_CONNECTION_REQUIRED');
    expect(h.rpcCalls).toHaveLength(0);expect(h.sent).toHaveLength(0);c.dispose();
  });
  it('cancels a review without sending and requires a new deliberate review',async()=>{
    const h=syntheticComposition(),c=h.makeController();await c.connect();
    const r=await c.prepare('claim-provider',h.agreement,h.manifest);c.cancel();
    await expect(c.confirm(r.id)).rejects.toThrow('EXPIRED_OR_MISSING_REVIEW');
    expect(h.entries()).toEqual([]);expect(h.sent).toHaveLength(0);
    const fresh=await c.prepare('claim-provider',h.agreement,h.manifest);expect(fresh.id).not.toBe(r.id);c.dispose();
  });
  it.each(['accountsChanged','chainChanged','disconnect'])('invalidates review after %s',async event=>{
    const h=syntheticComposition(),c=h.makeController();await c.connect();
    const r=await c.prepare('claim-provider',h.agreement,h.manifest);h.emit(event);
    await expect(c.confirm(r.id)).rejects.toThrow('EXPIRED_OR_MISSING_REVIEW');
    await expect(c.prepare('claim-provider',h.agreement,h.manifest)).rejects.toThrow('EXPLICIT_CONNECTION_REQUIRED');
    expect(h.sent).toHaveLength(0);expect(h.entries()).toEqual([]);c.dispose();
  });
  it('expires a review without creating a durable attempt',async()=>{
    const h=syntheticComposition(),c=h.makeController();await c.connect();
    const r=await c.prepare('claim-provider',h.agreement,h.manifest);vi.setSystemTime(clock+30001);
    await expect(c.confirm(r.id)).rejects.toThrow('EXPIRED_OR_MISSING_REVIEW');
    expect(h.sent).toHaveLength(0);expect(h.entries()).toEqual([]);c.dispose();
  });
  it('consumes one deliberate confirmation even when clicked concurrently',async()=>{
    const h=syntheticComposition(),c=h.makeController();await c.connect();
    const r=await c.prepare('claim-provider',h.agreement,h.manifest);
    const results=await Promise.allSettled([c.confirm(r.id),c.confirm(r.id)]);
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(x=>x.status==='rejected')).toHaveLength(1);expect(h.sent).toHaveLength(1);
    await expect(c.confirm(r.id)).rejects.toThrow('EXPIRED_OR_MISSING_REVIEW');c.dispose();
  });
  it('cancellation during nonce reads prevents the wallet request',async()=>{
    const h=syntheticComposition(),c=h.makeController();await c.connect();
    const r=await c.prepare('claim-provider',h.agreement,h.manifest);h.state.beforeNonce=()=>c.cancel();
    await expect(c.confirm(r.id)).rejects.toThrow('STALE_REVIEW');
    expect(h.sent).toHaveLength(0);expect(h.entries()).toEqual([]);c.dispose();
  });
  it('rejects disagreeing pending nonces before journaling or sending',async()=>{
    const h=syntheticComposition(),c=h.makeController();await c.connect();
    const r=await c.prepare('claim-provider',h.agreement,h.manifest);h.state.nonceMismatch=true;
    await expect(c.confirm(r.id)).rejects.toThrow('NETWORK_NONCE_DISAGREEMENT');
    expect(h.sent).toHaveLength(0);expect(h.entries()).toEqual([]);c.dispose();
  });
  it('fresh code disagreement invalidates a previously valid review',async()=>{
    const h=syntheticComposition(),c=h.makeController();await c.connect();
    const r=await c.prepare('claim-provider',h.agreement,h.manifest);h.state.providerMismatch=true;
    await expect(c.confirm(r.id)).rejects.toThrow();expect(h.sent).toHaveLength(0);expect(h.entries()).toEqual([]);c.dispose();
  });
  it('does not let cancellation erase an already-started wallet request',async()=>{
    const h=syntheticComposition(),c=h.makeController();await c.connect();
    const r=await c.prepare('claim-provider',h.agreement,h.manifest);h.state.mode='defer';
    const pending=c.confirm(r.id);
    await vi.waitFor(()=>expect(h.state.deferred).toBeTypeOf('function'));
    expect(h.entries()[0]?.state).toBe('unknown');c.cancel();h.state.deferred!();
    const sent=await pending;expect(sent.state).toBe('submitted');expect(h.sent).toHaveLength(1);
    expect((await c.reconcile(sent.id)).state).toBe('confirmed');c.dispose();
  });
});
describe('SYNTHETIC reload and durable unknown lockouts',()=>{
  it('preserves interrupted submission across reload until canonical evidence resolves it',async()=>{
    const h=syntheticComposition(),c=h.makeController();await c.connect();
    const r=await c.prepare('claim-provider',h.agreement,h.manifest);h.state.mode='interrupt';
    const entry=await c.confirm(r.id);expect(entry.state).toBe('unknown');expect(entry.hash).toBeUndefined();
    expect(h.sent).toHaveLength(1);c.dispose();
    const reloaded=h.makeController();await reloaded.connect();
    const retry=await reloaded.prepare('claim-provider',h.agreement,h.manifest);
    await expect(reloaded.confirm(retry.id)).rejects.toThrow('UNRESOLVED_ATTEMPT');
    expect(h.entries()[0]?.id).toBe(entry.id);expect(h.entries()[0]?.state).toBe('unknown');expect(h.sent).toHaveLength(1);
    h.state.mined=true;const resolved=await reloaded.reconcile(entry.id,h.hash);
    expect(resolved.state).toBe('confirmed');expect(resolved.proof).toMatchObject({outcome:{recipient:h.f.terms.provider}});
    expect(h.sent).toHaveLength(1);reloaded.dispose();
  });
  it('serializes competing controllers and prevents resubmission of an unknown attempt',async()=>{
    const h=syntheticComposition(),a=h.makeController(),b=h.makeController();await a.connect();await b.connect();
    const ar=await a.prepare('claim-provider',h.agreement,h.manifest),br=await b.prepare('claim-provider',h.agreement,h.manifest);
    h.state.mode='interrupt';const results=await Promise.allSettled([a.confirm(ar.id),b.confirm(br.id)]);
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(results.filter(x=>x.status==='rejected')).toHaveLength(1);
    expect(h.sent).toHaveLength(1);expect(h.entries()).toHaveLength(1);expect(h.entries()[0]?.state).toBe('unknown');a.dispose();b.dispose();
  });
  it('allows deliberate retry after a known wallet rejection in the same controller',async()=>{
    const h=syntheticComposition(),c=h.makeController();await c.connect();h.state.mode='reject';
    const r=await c.prepare('claim-provider',h.agreement,h.manifest);expect((await c.confirm(r.id)).state).toBe('rejected');
    h.state.mode='ok';const fresh=await c.prepare('claim-provider',h.agreement,h.manifest);
    const entry=await c.confirm(fresh.id);expect(entry.state).toBe('submitted');expect((await c.reconcile(entry.id)).state).toBe('confirmed');
    expect(h.sent).toHaveLength(2);c.dispose();
  });
  it('does not trust a persisted rejection after reload without canonical proof',async()=>{
    const h=syntheticComposition(),c=h.makeController();await c.connect();h.state.mode='reject';
    const r=await c.prepare('claim-provider',h.agreement,h.manifest);await c.confirm(r.id);c.dispose();
    h.state.mode='ok';const next=h.makeController();await next.connect();const retry=await next.prepare('claim-provider',h.agreement,h.manifest);
    await expect(next.confirm(retry.id)).rejects.toThrow('UNRESOLVED_ATTEMPT');expect(h.sent).toHaveLength(1);
    expect(h.entries()[0]?.state).toBe('unknown');next.dispose();
  });
  it.each(['corrupt','legacy'])('preserves %s journal bytes and blocks sending',async kind=>{
    const h=syntheticComposition(),c=h.makeController();await c.connect();
    const r=await c.prepare('claim-provider',h.agreement,h.manifest);
    const key=kind==='corrupt'?JOURNAL_KEY:'noticevault:attempts:legacy';
    const raw=kind==='corrupt'?'not-json':'{"state":"unknown"}';h.storageMap.set(key,raw);
    await expect(c.confirm(r.id)).rejects.toThrow(kind==='corrupt'?'CORRUPT_JOURNAL_PRESERVED':'LEGACY_UNKNOWN_ATTEMPT');
    expect(h.storageMap.get(key)).toBe(raw);expect(h.sent).toHaveLength(0);c.dispose();
  });
  it('fails before sending if durable journal storage rejects the write',async()=>{
    const h=syntheticComposition(),c=h.makeController();await c.connect();
    const r=await c.prepare('claim-provider',h.agreement,h.manifest);h.state.writeFails=true;
    await expect(c.confirm(r.id)).rejects.toThrow('SYNTHETIC_QUOTA');expect(h.sent).toHaveLength(0);expect(h.entries()).toEqual([]);c.dispose();
  });
  it('does not resolve a forged payout recipient or permit another attempt',async()=>{
    const h=syntheticComposition(),c=h.makeController();await c.connect();
    const r=await c.prepare('claim-provider',h.agreement,h.manifest),entry=await c.confirm(r.id);
    h.state.wrongRecipient=true;expect((await c.reconcile(entry.id)).state).toBe('unknown');
    const retry=await c.prepare('claim-provider',h.agreement,h.manifest);
    await expect(c.confirm(retry.id)).rejects.toThrow('UNRESOLVED_ATTEMPT');expect(h.sent).toHaveLength(1);c.dispose();
  });
  it('keeps the beneficiary fixed when another synthetic wallet triggers the claim',async()=>{
    const h=syntheticComposition();h.state.account=h.f.terms.client;const c=h.makeController();await c.connect();
    const r=await c.prepare('claim-provider',h.agreement,h.manifest);expect(r.recipient).toBe(h.f.terms.provider);
    const entry=await c.confirm(r.id),resolved=await c.reconcile(entry.id);
    expect(resolved.state).toBe('confirmed');expect(resolved.proof).toMatchObject({outcome:{recipient:h.f.terms.provider,amount:String(h.amount)}});
    expect(h.sent[0]?.from).toBe(h.f.terms.client);c.dispose();
  });
});
describe('SYNTHETIC persisted-hash and silent-context checks',()=>{
  it('reconciles a saved submitted hash after reload without another wallet request',async()=>{
    const h=syntheticComposition(),c=h.makeController();await c.connect();
    const r=await c.prepare('claim-provider',h.agreement,h.manifest),entry=await c.confirm(r.id);c.dispose();
    const next=h.makeController();expect((await next.entries())[0]?.hash).toBe(h.hash);
    expect((await next.reconcile(entry.id)).state).toBe('confirmed');
    expect((await next.reconcile(entry.id)).state).toBe('confirmed');expect(h.sent).toHaveLength(1);next.dispose();
  });
  it.each(['account','chain'])('detects silent %s drift before sending',async kind=>{
    const h=syntheticComposition(),c=h.makeController();await c.connect();
    const r=await c.prepare('claim-provider',h.agreement,h.manifest);
    if(kind==='account')h.state.account=h.f.terms.client;else h.state.chainId=1n;
    await expect(c.confirm(r.id)).rejects.toThrow('STALE_REVIEW');expect(h.sent).toHaveLength(0);expect(h.entries()).toEqual([]);c.dispose();
  });
  it('checks the real review-pin expiry before asking the synthetic wallet to connect',async()=>{
    const h=syntheticComposition(),c=h.makeController();vi.setSystemTime(clock+60001);
    await expect(c.connect()).rejects.toThrow('REVIEW_EXPIRED');expect(h.walletCalls).toEqual([]);expect(h.rpcCalls).toEqual([]);c.dispose();
  });
});
