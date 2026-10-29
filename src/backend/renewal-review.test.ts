import {fixturePromise} from "../../scripts/test-promise.mjs";
import {describe,it,expect,vi,beforeEach,afterEach} from "vitest";
import {keccak256} from "viem";
import type {Hex} from "viem";
import {observeFactoryForCreation,observeAgreement,buildSimulationSnapshot} from "../../packages/sdk/src/snapshot.js";
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
function agreementFixture(options:{mutate?:(name:string,value:unknown)=>unknown;block?:Record<string,unknown>;recheck?:Record<string,unknown>;chains?:unknown[];clientAddress?:Hex;fail?:string}={}){
 const f=fixture({block:options.block,recheck:options.recheck});
 const terms={...f.terms,startAt:f.now-1800n,periodSeconds:3600n,noticeSeconds:3600n};
 const snap=buildSimulationSnapshot({terms,regularFunded:3000000n,regularPaid:0n,noticePaid:0n,clientRefunded:0n,noticeStartStored:null,noticeReasonStored:null},f.now);
 const raw:Record<string,unknown>={registeredAgreement:true,terms:Object.values(terms),accounting:[3000000n,0n,0n,0n,3000000n,false,0n,0,6000000n],preview:{...snap,phase:1,S:0n,E:0n,reason:0,hasStoredNotice_:false}};
 let chainCalls=0;const reads:Array<{functionName:string;blockNumber:bigint}>=[];
 const rpc={...f.rpc,getChainId:()=>{return fixturePromise(()=>{const i=chainCalls++;return (options.chains?.[Math.min(i,options.chains.length-1)]??31337) as number;});},readContract:async a=>{
  reads.push({functionName:a.functionName,blockNumber:a.blockNumber});if(a.functionName===options.fail)throw Error("Injected RPC failure");
  const value=Object.prototype.hasOwnProperty.call(raw,a.functionName)?raw[a.functionName]:await f.rpc.readContract(a);
  return options.mutate?options.mutate(a.functionName,value):value;
 }} satisfies MinimalPublicClient;
 return {...f,terms,reads,rpc,observe:()=>observeAgreement(rpc,f.dep,G,terms,options.clientAddress??C)};
}

import {prepareApproveForRenewal,prepareFundNextPeriod} from "../../packages/sdk/src/txprep.js";
const A=3000000n,wallet={account:C,chainId:31337n};
function renewalFixture(balance=A,allowance=A){
 const f=agreementFixture();const original=f.rpc.readContract;const requests:Array<Parameters<MinimalPublicClient["readContract"]>[0]>=[];
 f.rpc.readContract=async args=>{
  requests.push(args);
  if(args.functionName==="balanceOf"&&args.args?.[0]===C)return balance;
  if(args.functionName==="allowance"&&args.args?.[1]===G)return allowance;
  return original(args);
 };
 return {...f,requests,observe:(includeClient=true)=>observeAgreement(f.rpc,f.dep,G,f.terms,includeClient?C:undefined),
  approve:(e:Awaited<ReturnType<typeof observeAgreement>>)=>prepareApproveForRenewal(G,f.dep,e,C,f.now,wallet),
  fund:(e:Awaited<ReturnType<typeof observeAgreement>>)=>prepareFundNextPeriod(e.domainSnapshot!.D,G,f.dep,e,C,f.now,wallet),
  minedApproval:()=>{allowance=A;f.rpc.getBlock=()=>(fixturePromise(()=>({number:124n,hash:("0x"+"bb".repeat(32)) as Hex,timestamp:f.now})));}
 };
}

import {decodeFunctionData} from 'viem';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {UnitLifecycleController as ReviewLifecycleController} from './durable-unit-support.js';
import type {SyntheticExecutor} from './transaction-review.js';
import {syntheticRenewalLoader,renewalAttemptStore} from './renewal-review.js';
import type {RenewalAction,RenewalReview,SyntheticRenewalContext} from './renewal-review.js';
import {AgreementRenewalReview} from './AgreementRenewalReview.js';
function setup(allowance=A){
 const f=renewalFixture(A,allowance);let context:SyntheticRenewalContext={source:'SYNTHETIC',authorizationKey:'synthetic-workspace-member-v1',sessionAccount:C,sessionChainId:'31337',sessionExpiresAt:TEST_MS+3600000,agreement:G,terms:f.terms,policy:f.dep};
 const ctx=vi.fn(()=>fixturePromise(()=>(structuredClone(context))));const walletRead=vi.fn(()=>(fixturePromise(()=>({...wallet}))));const deps={source:'SYNTHETIC' as const,rpc:f.rpc,context:ctx,wallet:walletRead};
 const values=new Map<string,string>();const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);}};const txHash=('0x'+'bc'.repeat(32)) as Hex;
 const executor={source:'SYNTHETIC',submit:vi.fn<SyntheticExecutor<RenewalReview>["submit"]>(()=>(fixturePromise(()=>({source:'SYNTHETIC' as const,hash:txHash})))),receipt:vi.fn<SyntheticExecutor<RenewalReview>["receipt"]>((hash,chainId)=>(fixturePromise(()=>({source:'SYNTHETIC' as const,hash,chainId,status:'confirmed' as const,blockHash:H}))))} satisfies SyntheticExecutor<RenewalReview>;
 const loader=(action:RenewalAction)=>syntheticRenewalLoader(action,deps);const control=(action:RenewalAction)=>new ReviewLifecycleController(loader(action),renewalAttemptStore(storage,'test-agreement',action),executor);
 return {f,ctx,context,walletRead,deps,storage,values,executor,loader,control};
}
const signal=()=>new AbortController().signal;
describe('SDK-backed renewal reviews',()=>{
 it('approves exact A to agreement with zero allowance and never funds',async()=>{const f=setup(0n),r=await f.loader('approve-renewal')(signal());expect(r.target).toBe(T);expect(r.spender).toBe(G);expect(r.amount).toBe(String(A));expect(r.effect).toContain('Does not fund');const tx=f.f.approve(await f.f.observe());expect(decodeFunctionData({abi:tx.abi,data:r.data as Hex}).args).toEqual([G,A]);expect(f.f.requests.every(a=>a.blockNumber===123n)).toBe(true);});
 it('funding requires agreement allowance despite large factory allowance',async()=>{const f=setup(0n);await expect(f.loader('fund-renewal')(signal())).rejects.toThrow(/allowance/);});
 it('funding targets agreement and pins expected deadline',async()=>{const f=setup(),r=await f.loader('fund-renewal')(signal());expect(r.target).toBe(G);expect(r.spender).toBeNull();expect(r.amount).toBe(String(A));expect(r.effect).toContain('No approval');const tx=f.f.fund(await f.f.observe());expect(decodeFunctionData({abi:tx.abi,data:r.data as Hex}).args).toEqual([BigInt(r.expectedD)]);});
 it('provider session cannot prepare client renewal',async()=>{const f=setup();f.context.sessionAccount=P;f.walletRead.mockResolvedValue({account:P,chainId:31337n});await expect(f.loader('fund-renewal')(signal())).rejects.toThrow();});
 it('rejects wallet account change while observing',async()=>{const f=setup();f.walletRead.mockResolvedValueOnce({...wallet}).mockResolvedValue({...wallet,account:P});await expect(f.loader('approve-renewal')(signal())).rejects.toThrow(/Wallet/);});
 it('rejects wallet chain mismatch',async()=>{const f=setup();f.walletRead.mockResolvedValue({...wallet,chainId:1n});await expect(f.loader('fund-renewal')(signal())).rejects.toThrow();});
 it('rejects RPC on wrong chain',async()=>{const f=setup();f.f.rpc.getChainId=()=>fixturePromise(()=>(1));await expect(f.loader('fund-renewal')(signal())).rejects.toThrow();});
 it('rejects live policy at synthetic boundary',async()=>{const f=setup();f.context.policy={...f.context.policy,isLive:true};await expect(f.loader('fund-renewal')(signal())).rejects.toThrow(/non-live/);});
 it('rejects changed policy after observation',async()=>{const f=setup();f.ctx.mockResolvedValueOnce(structuredClone(f.context)).mockResolvedValue({...f.context,policy:{...f.context.policy,expectedFactoryCodeHash:H}});await expect(f.loader('fund-renewal')(signal())).rejects.toThrow(/policy changed/);});
 it('rejects changed authorized context after observation',async()=>{const f=setup();f.ctx.mockResolvedValueOnce(structuredClone(f.context)).mockResolvedValue({...f.context,authorizationKey:'revoked'});await expect(f.loader('fund-renewal')(signal())).rejects.toThrow(/Authorization/);});
 it('rejects missing or expired session',async()=>{const f=setup();f.context.sessionExpiresAt=TEST_MS;await expect(f.loader('fund-renewal')(signal())).rejects.toThrow(/expired/);});
 it('rejects revoked authorization',async()=>{const f=setup();f.ctx.mockRejectedValue(new Error('Forbidden'));await expect(f.loader('fund-renewal')(signal())).rejects.toThrow('Forbidden');});
 it('rejects incomplete RPC evidence',async()=>{const f=setup();f.f.rpc.getBytecode=()=>fixturePromise(()=>(undefined as never));await expect(f.loader('fund-renewal')(signal())).rejects.toThrow();});
 it('rejects canonical reorg before review completes',async()=>{const f=setup();let reads=0;f.f.rpc.getBlock=()=>(fixturePromise(()=>({number:123n,hash:(++reads>=2?'0x'+'dd'.repeat(32):H) as Hex,timestamp:f.f.now})));await expect(f.loader('fund-renewal')(signal())).rejects.toThrow();});
 it('rejects closed renewal window with actual trusted clock',async()=>{const f=setup();vi.spyOn(Date,'now').mockReturnValue(TEST_MS+1800000);await expect(f.loader('fund-renewal')(signal())).rejects.toThrow();});
 it('rejects aborted observation',async()=>{const f=setup(),a=new AbortController();a.abort();await expect(f.loader('fund-renewal')(a.signal)).rejects.toThrow();});
 it('does not accept indexed projections as preparation evidence',async()=>{const f=setup();f.ctx.mockResolvedValue({source:'INDEXED',agreement:G,financial:{amountPerPeriod:String(A)}} as never);await expect(f.loader('fund-renewal')(signal())).rejects.toThrow();});
 it('approval confirmation never automatically funds; fresh funding is separate',async()=>{const f=setup(0n),approve=f.control('approve-renewal');await approve.prepare();expect(approve.snapshot().status).toBe('review');await approve.confirm(false);expect(f.executor.submit).not.toHaveBeenCalled();await Promise.all([approve.confirm(true),approve.confirm(true)]);expect(f.executor.submit).toHaveBeenCalledTimes(1);await approve.checkReceipt();expect(approve.snapshot().status).toBe('confirmed');await expect(f.loader('fund-renewal')(signal())).rejects.toThrow(/allowance/);f.f.minedApproval();const fund=f.control('fund-renewal');await fund.prepare();expect(fund.snapshot().review?.blockNumber).toBe('124');await fund.confirm(true);expect(f.executor.submit).toHaveBeenCalledTimes(2);});
 it('uncertain approval locks funding across controller reconstruction',async()=>{const f=setup(0n);vi.mocked(f.executor.submit).mockRejectedValue(new Error('disconnected'));const a=f.control('approve-renewal');await a.prepare();await a.confirm(true);const b=f.control('fund-renewal');await b.prepare();await b.confirm(true);expect(b.snapshot().status).toBe('unknown');expect(f.executor.submit).toHaveBeenCalledTimes(1);});
 it('changed block between review and confirmation requires review again',async()=>{const f=setup(),c=f.control('fund-renewal');await c.prepare();f.f.minedApproval();await c.confirm(true);expect(c.snapshot().status).toBe('invalidated');expect(f.executor.submit).not.toHaveBeenCalled();});
 it.each(['approve-renewal','fund-renewal'] as const)('renders explicit %s effect and unconfirmed disabled control',async action=>{const f=setup(),c=f.control(action);await c.prepare();const html=renderToStaticMarkup(createElement(AgreementRenewalReview,{agreement:G,chainId:'31337',syntheticController:c}));expect(html).toContain('Synthetic action review');expect(html).toContain(String(A));expect(html).toContain(action);expect(html).toMatch(/disabled=""[^>]*>Confirm reviewed action/);});
 it('preserves corrupt journal without overwriting',()=>{const f=setup();f.storage.setItem('noticevault:synthetic-renewal:v1:test-agreement','broken');const c=f.control('fund-renewal');expect(c.snapshot().status).toBe('unknown');expect(f.values.get('noticevault:synthetic-renewal:v1:test-agreement')).toBe('broken');});
});

it('default production screen tolerates unavailable storage without requesting a wallet',()=>{const html=renderToStaticMarkup(createElement(AgreementRenewalReview,{agreement:G,chainId:'31337'}));expect(html).toContain('Live execution unavailable');expect(html).toContain('unknown');});
it('malformed historical journal record blocks another action and remains unchanged',()=>{const f=setup();const raw=JSON.stringify([{action:'approve-renewal',attempt:{source:'SYNTHETIC',key:'bad',status:'confirmed'}}]);f.storage.setItem('noticevault:synthetic-renewal:v1:test-agreement',raw);expect(f.control('fund-renewal').snapshot().status).toBe('unknown');expect(f.values.get('noticevault:synthetic-renewal:v1:test-agreement')).toBe(raw);});
