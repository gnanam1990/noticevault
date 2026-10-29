import {fixturePromise} from "../../scripts/test-promise.mjs";
import {describe,it,expect,vi,beforeEach,afterEach} from "vitest";
import {keccak256} from "viem";
import type {Hex} from "viem";
import {observeFactoryForCreation,buildSimulationSnapshot} from "../../packages/sdk/src/snapshot.js";
import type {MinimalPublicClient} from "../../packages/sdk/src/snapshot.js";
import type {NoticeVaultDeployment,TermsInput} from "../../packages/sdk/src/types.js";


const F="0x2222222222222222222222222222222222222222",T="0x3333333333333333333333333333333333333333",C="0x1111111111111111111111111111111111111111",P="0x4444444444444444444444444444444444444444";
const FC="0x60006000" as Hex,TC="0x60016001" as Hex,H=("0x"+"aa".repeat(32)) as Hex;
function fixture(opts:{values?:Record<string,unknown>;fail?:string;block?:Record<string,unknown>;recheck?:Record<string,unknown>;providerCode?:unknown}={}) {
 const now=BigInt(Math.floor(Date.now()/1000));
 const dep:NoticeVaultDeployment={configIdentity:"ARC_TESTNET",chainId:31337n,factoryAddress:F,allowlistedToken:T,expectedFactoryCodeHash:keccak256(FC),expectedTokenCodeHash:keccak256(TC),isLive:false,label:"Synthetic T024"};
 const terms:TermsInput={schemaVersion:1,client:C,provider:P,token:T,amountPerPeriod:3000000n,periodSeconds:2592000n,noticeSeconds:864000n,startAt:now+600n,clientNonce:7n,acceptanceDeadline:now+1000n,termsDocumentHash:H};
 const reads:Array<{functionName:string;address:string;blockNumber:bigint}>=[];
 const block={number:123n,hash:H,timestamp:now,...opts.block};
 const values:Record<string,unknown>={token:T,decimals:6,factoryCap:100000000n,agreementCap:100000000n,outstandingLiability:0n,creationPaused:false,isNonceUnavailable:false,balanceOf:100000000n,allowance:100000000n,...opts.values};
 const rpc={getChainId:()=>fixturePromise(()=>(31337)),getBlock:args=>fixturePromise(()=>(({...block,...('blockNumber' in args?opts.recheck:{})}))),getBytecode:({address})=>fixturePromise(()=>(address.toLowerCase()===F?FC:address.toLowerCase()===T?TC:('providerCode' in opts?opts.providerCode:"0x") as Hex)),readContract:args=>{return fixturePromise(()=>{reads.push({functionName:args.functionName,address:args.address,blockNumber:args.blockNumber});if(args.functionName===opts.fail)throw new Error("Injected failure");return values[args.functionName];});}} satisfies MinimalPublicClient;
 return {dep,terms,rpc,reads,now,observe:()=>observeFactoryForCreation(rpc,dep,C,7n,terms)};
}


const TEST_MS=1800000000000,G="0x6666666666666666666666666666666666666666" as Hex;
beforeEach(()=>vi.spyOn(Date,"now").mockReturnValue(TEST_MS));
afterEach(()=>vi.restoreAllMocks());

import {decodeFunctionData} from 'viem';
import {AGREEMENT_ABI} from '../../packages/sdk/src/index.js';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {syntheticSettlementLoader} from './settlement-review.js';
import type {SettlementAction,SettlementReview} from './settlement-review.js';
import {renewalAttemptStore,syntheticRenewalLoader} from './renewal-review.js';
import type {SyntheticRenewalContext} from './renewal-review.js';
import {UnitLifecycleController as ReviewLifecycleController} from './durable-unit-support.js';
import type {SyntheticExecutor} from './transaction-review.js';
import {AgreementSettlementReview} from './AgreementSettlementReview.js';
const A=3000000n;
function setup(opts:{stored?:boolean;elapsed?:bigint;paid?:bigint;refund?:bigint;noticePaid?:bigint;balance?:bigint}={}){
 const f=fixture();const terms={...f.terms,startAt:f.now-(opts.elapsed??1800n),periodSeconds:3600n,noticeSeconds:3600n};const S=opts.stored?f.now-600n:null;
 const state={terms,regularFunded:A,regularPaid:opts.paid??0n,noticePaid:opts.noticePaid??0n,clientRefunded:opts.refund??0n,noticeStartStored:S,noticeReasonStored:S===null?null:'CLIENT_CANCELLED' as const};
 const snap=buildSimulationSnapshot(state,f.now);const reason=snap.reason==='CLIENT_CANCELLED'?1:snap.reason==='MISSED_CHECKPOINT'?2:0;
 const raw:Record<string,unknown>={registeredAgreement:true,terms:Object.values(terms),accounting:[A,state.regularPaid,state.noticePaid,state.clientRefunded,A,!!opts.stored,S??0n,opts.stored?1:0,snap.L],preview:{...snap,phase:['SCHEDULED','ACTIVE','NOTICE_SCHEDULED','NOTICE','ENDED_CLAIMABLE','CLOSED'].indexOf(snap.phase),S:snap.S??0n,E:snap.E??0n,reason,hasStoredNotice_:!!opts.stored}};
 const original=f.rpc.readContract;f.rpc.readContract=a=>{return fixturePromise(()=>{if(a.functionName==='balanceOf'&&a.args?.[0]===G&&opts.balance!==undefined)return opts.balance;return Object.prototype.hasOwnProperty.call(raw,a.functionName)?raw[a.functionName]:original(a);});};
 const context:SyntheticRenewalContext={source:'SYNTHETIC',authorizationKey:'synthetic-authorized-workspace',sessionAccount:C,sessionChainId:'31337',sessionExpiresAt:TEST_MS+3600000,agreement:G,terms,policy:f.dep};
 const ctx=vi.fn(()=>fixturePromise(()=>(structuredClone(context)))),wallet=vi.fn(()=>(fixturePromise(()=>({account:C,chainId:31337n}))));const deps={source:'SYNTHETIC' as const,rpc:f.rpc,context:ctx,wallet};const values=new Map<string,string>();const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);}};
 const executor={source:'SYNTHETIC',submit:vi.fn<SyntheticExecutor<SettlementReview>["submit"]>(()=>(fixturePromise(()=>({source:'SYNTHETIC' as const,hash:'0x'+'bc'.repeat(32)})))),receipt:vi.fn<SyntheticExecutor<SettlementReview>["receipt"]>((hash,chainId)=>(fixturePromise(()=>({source:'SYNTHETIC' as const,hash,chainId,status:'confirmed' as const,blockHash:H}))))} satisfies SyntheticExecutor<SettlementReview>;
 const loader=(action:SettlementAction)=>syntheticSettlementLoader(action,deps);const control=(action:SettlementAction)=>new ReviewLifecycleController(loader(action),renewalAttemptStore(storage,'shared-agreement',action),executor);
 return {f,terms,snap,raw,context,ctx,wallet,deps,storage,executor,loader,control};
}
const signal=()=>new AbortController().signal;
describe('issued-evidence notice and payout review',()=>{
 it('provider claim previews exact earnings to immutable provider with no destination argument',async()=>{const f=setup(),r=await f.loader('claim-provider')(signal());expect(r.amount).toBe('1500000');expect(r.recipient).toBe(P);expect(r.callerRule).toContain('Permissionless');expect(r.effect).toContain('not a fixed payout guarantee');expect(decodeFunctionData({abi:AGREEMENT_ABI,data:r.data as Hex}).functionName).toBe('claimProvider');expect(decodeFunctionData({abi:AGREEMENT_ABI,data:r.data as Hex}).args??[]).toEqual([]);});
 it('client refund is unearned regular funding, not notice reserve',async()=>{const f=setup({stored:true});f.context.sessionAccount=P;f.wallet.mockResolvedValue({account:P,chainId:31337n});const r=await f.loader('claim-client-refund')(signal());expect(r.recipient).toBe(C);expect(r.amount).toBe('2000000');expect(r.effect).toContain('does not return the provider notice reserve');expect(decodeFunctionData({abi:AGREEMENT_ABI,data:r.data as Hex}).args??[]).toEqual([]);});
 it('active client cancellation previews current block notice time',async()=>{const f=setup(),r=await f.loader('start-notice')(signal());expect(r.noticeReason).toBe('CLIENT_CANCELLED');expect(r.noticeStart).toBe(String(f.f.now));expect(r.noticeEnd).toBe(String(f.f.now+3600n));expect(r.amount).toBe('0');expect(r.recipient).toBeNull();});
 it('scheduled cancellation starts no earlier than agreement start',async()=>{const f=setup({elapsed:-600n}),r=await f.loader('start-notice')(signal());expect(r.noticeStart).toBe(String(f.terms.startAt));});
 it('client start after missed checkpoint uses default deadline',async()=>{const f=setup({elapsed:4000n}),r=await f.loader('start-notice')(signal());expect(r.noticeReason).toBe('MISSED_CHECKPOINT');expect(r.noticeStart).toBe(String(f.snap.D));});
 it('materialization is permissionless only when default is derived',async()=>{const f=setup({elapsed:4000n});f.context.sessionAccount=P;f.wallet.mockResolvedValue({account:P,chainId:31337n});const r=await f.loader('materialize-notice')(signal());expect(r.noticeStart).toBe(String(f.snap.D));expect(r.amount).toBe('0');});
 it('blocks premature default materialization',async()=>{await expect(setup().loader('materialize-notice')(signal())).rejects.toThrow(/default notice/);});
 it.each(['start-notice','materialize-notice'] as const)('blocks already stored %s',async a=>{await expect(setup({stored:true}).loader(a)(signal())).rejects.toThrow();});
 it('provider cannot initiate client cancellation',async()=>{const f=setup();f.context.sessionAccount=P;f.wallet.mockResolvedValue({account:P,chainId:31337n});await expect(f.loader('start-notice')(signal())).rejects.toThrow();});
 it('zero provider claim before start does not offer a no-op payout',async()=>{await expect(setup({elapsed:-600n}).loader('claim-provider')(signal())).rejects.toThrow(/positive payable/);});
 it('zero refund without notice is blocked',async()=>{await expect(setup().loader('claim-client-refund')(signal())).rejects.toThrow(/positive payable/);});
 it('already-paid earnings cannot be claimed again',async()=>{await expect(setup({stored:true,paid:1000000n,noticePaid:500000n}).loader('claim-provider')(signal())).rejects.toThrow(/positive payable/);});
 it('observed contract balance must cover the payout',async()=>{await expect(setup({balance:1n}).loader('claim-provider')(signal())).rejects.toThrow();});
 it('mismatched accounting/preview fails conservation verification',async()=>{const f=setup();f.raw.preview={...(f.raw.preview as object),providerClaimable:999999999n};await expect(f.loader('claim-provider')(signal())).rejects.toThrow();});
 it('session expiry blocks payout preparation',async()=>{const f=setup();f.context.sessionExpiresAt=TEST_MS;await expect(f.loader('claim-provider')(signal())).rejects.toThrow();});
 it('wallet switch invalidates a payout review',async()=>{const f=setup();f.wallet.mockResolvedValueOnce({account:C,chainId:31337n}).mockResolvedValue({account:P,chainId:31337n});await expect(f.loader('claim-provider')(signal())).rejects.toThrow();});
 it('changed authorization invalidates preparation',async()=>{const f=setup();f.ctx.mockResolvedValueOnce(structuredClone(f.context)).mockResolvedValue({...f.context,authorizationKey:'revoked'});await expect(f.loader('claim-provider')(signal())).rejects.toThrow();});
 it('canonical reorg fails closed',async()=>{const f=setup();let n=0;f.f.rpc.getBlock=()=>(fixturePromise(()=>({number:123n,hash:(++n>1?'0x'+'dd'.repeat(32):H) as Hex,timestamp:f.f.now})));await expect(f.loader('claim-provider')(signal())).rejects.toThrow();});
 it('crossed deadline cannot retain a cancellation preview',async()=>{const f=setup();vi.spyOn(Date,'now').mockReturnValue(TEST_MS+1800000);await expect(f.loader('start-notice')(signal())).rejects.toThrow();});
 it('claim requires deliberate confirmation and sends once',async()=>{const f=setup(),c=f.control('claim-provider');await c.prepare();await c.confirm(false);expect(f.executor.submit).not.toHaveBeenCalled();await Promise.all([c.confirm(true),c.confirm(true)]);expect(f.executor.submit).toHaveBeenCalledTimes(1);await c.checkReceipt();expect(c.snapshot().status).toBe('confirmed');});
 it('unknown payout locks renewal and notice actions across reconstruction',async()=>{const f=setup();vi.mocked(f.executor.submit).mockRejectedValue(new Error('disconnected'));const c=f.control('claim-provider');await c.prepare();await c.confirm(true);expect(f.control('start-notice').snapshot().status).toBe('unknown');const renewal=new ReviewLifecycleController(syntheticRenewalLoader('fund-renewal',f.deps),renewalAttemptStore(f.storage,'shared-agreement','fund-renewal'));await renewal.prepare();expect(renewal.snapshot().status).toBe('unknown');expect(f.executor.submit).toHaveBeenCalledTimes(1);});
 it.each(['start-notice','materialize-notice','claim-provider','claim-client-refund'] as const)('renders explicit %s recipient/effect and confirmation',async a=>{const f=setup(a==='materialize-notice'?{elapsed:4000n}:a==='claim-client-refund'?{stored:true}:{}),c=f.control(a);await c.prepare();expect(c.snapshot().status).toBe('review');const html=renderToStaticMarkup(createElement(AgreementSettlementReview,{agreement:G,chainId:'31337',syntheticController:c}));expect(html).toContain('Synthetic action review');expect(html).toContain('Immutable recipient');expect(html).toContain(a);expect(html).toMatch(/disabled=""[^>]*>Confirm reviewed action/);});
});
