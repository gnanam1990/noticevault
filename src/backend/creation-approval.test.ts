import {fixturePromise} from "../../scripts/test-promise.mjs";
/** Deterministic injected RPC fixtures; no network, wallets or chain writes. */
import {describe,it,expect} from "vitest";
import {keccak256} from "viem";
import type {Hex} from "viem";
import {observeFactoryForCreation} from "../../packages/sdk/src/snapshot.js";
import type {MinimalPublicClient} from "../../packages/sdk/src/snapshot.js";

import type {NoticeVaultDeployment,TermsInput} from "../../packages/sdk/src/types.js";

const F="0x2222222222222222222222222222222222222222",T="0x3333333333333333333333333333333333333333",C="0x1111111111111111111111111111111111111111",P="0x4444444444444444444444444444444444444444",OTHER="0x5555555555555555555555555555555555555555";
const FC="0x60006000" as Hex,TC="0x60016001" as Hex,H=("0x"+"aa".repeat(32)) as Hex;
function fixture(opts:{values?:Record<string,unknown>;fail?:string;block?:Record<string,unknown>;recheck?:Record<string,unknown>;providerCode?:unknown}={}) {
 const now=BigInt(Math.floor(Date.now()/1000));
 const dep:NoticeVaultDeployment={configIdentity:"ARC_TESTNET",chainId:31337n,factoryAddress:F,allowlistedToken:T,expectedFactoryCodeHash:keccak256(FC),expectedTokenCodeHash:keccak256(TC),isLive:false,label:"Synthetic T024"};
 const terms:TermsInput={schemaVersion:1,client:C,provider:P,token:T,amountPerPeriod:3000000n,periodSeconds:2592000n,noticeSeconds:864000n,startAt:now+600n,clientNonce:7n,acceptanceDeadline:now+1000n,termsDocumentHash:H};
 const reads:Array<{functionName:string;address:string;blockNumber:bigint}>=[];
 const block={number:123n,hash:H,timestamp:now,...opts.block};
 const values:Record<string,unknown>={token:T,decimals:6,factoryCap:100000000n,agreementCap:100000000n,outstandingLiability:0n,creationPaused:false,isNonceUnavailable:false,balanceOf:100000000n,allowance:100000000n,...opts.values};
 const rpc:MinimalPublicClient={getChainId:()=>fixturePromise(()=>(31337)),getBlock:args=>fixturePromise(()=>(({...block,...('blockNumber' in args?opts.recheck:{})}) as never)),getBytecode:({address})=>fixturePromise(()=>(address.toLowerCase()===F?FC:address.toLowerCase()===T?TC:('providerCode' in opts?opts.providerCode:"0x") as Hex)),readContract:args=>{return fixturePromise(()=>{reads.push({functionName:args.functionName,address:args.address,blockNumber:args.blockNumber});if(args.functionName===opts.fail)throw new Error("Injected failure");return values[args.functionName];});}};
 return {dep,terms,rpc,reads,now,observe:()=>observeFactoryForCreation(rpc,dep,C,7n,terms)};
}

import {syntheticCreationApprovalLoader} from './creation-approval.js';
import {decodeFunctionData} from 'viem';
import {erc20Abi as ERC20_ABI} from 'viem';
function setup(opts:Parameters<typeof fixture>[0]={}){const f=fixture(opts);const context={source:'SYNTHETIC' as const,workspaceId:'ws',draftId:'draft',version:1,documentHash:H,authorizationKey:'authorized',sessionAccount:C,sessionChainId:'31337',sessionExpiresAt:Date.now()+60000,terms:f.terms,policy:f.dep};const deps={source:'SYNTHETIC' as const,rpc:f.rpc,context:()=>fixturePromise(()=>(context)),wallet:()=>(fixturePromise(()=>({account:C,chainId:31337n})))};return {f,context,deps,load:syntheticCreationApprovalLoader(deps)};}
describe('creation approval review',()=>{
 it('approves exactly A plus reserve to factory with zero existing allowance',async()=>{const x=setup({values:{allowance:0n}}),r=await x.load(new AbortController().signal);expect(r.amount).toBe('4000000');expect(r.reserve).toBe('1000000');expect(r.target).toBe(T);expect(r.spender).toBe(F);const d=decodeFunctionData({abi:ERC20_ABI,data:r.data as Hex});expect(d.functionName).toBe('approve');expect(d.args).toEqual([F,4000000n]);expect(Object.isFrozen(r)).toBe(true);});
 it.each([{balanceOf:1n},{creationPaused:true},{isNonceUnavailable:true},{factoryCap:1n}])('retains SDK failure %s',async values=>{await expect(setup({values}).load(new AbortController().signal)).rejects.toThrow();});
 it('rejects account, session and draft changes',async()=>{const x=setup();x.context.sessionAccount=OTHER;await expect(x.load(new AbortController().signal)).rejects.toThrow();x.context.sessionAccount=C;x.context.sessionExpiresAt=0;await expect(x.load(new AbortController().signal)).rejects.toThrow();});
 it('rejects concurrent draft edit and policy mutation',async()=>{const x=setup();let calls=0;x.deps.context=()=>(fixturePromise(()=>({...x.context,version:++calls})));await expect(syntheticCreationApprovalLoader(x.deps)(new AbortController().signal)).rejects.toThrow();});
 it('has a different scope for different drafts and versions',async()=>{const x=setup(),a=await x.load(new AbortController().signal);x.context.version++;const b=await x.load(new AbortController().signal);expect(a.scopeKey).not.toBe(b.scopeKey);});
});

import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CreationApprovalReview} from './CreationApprovalReview.js';
import {ReviewLifecycleController} from './transaction-review.js';
it('renders exact approval scope and a separate deliberate confirmation',async()=>{const x=setup(),c=new ReviewLifecycleController(x.load,{read:()=>null,write:()=>{}});await c.prepare();const html=renderToStaticMarkup(createElement(CreationApprovalReview,{workspaceId:'ws',draftId:'draft',chainId:'31337',syntheticController:c}));expect(html).toContain('4000000');expect(html).toContain('Factory spender');expect(html).toContain('Confirm exact creation approval');expect(html).toContain('No unlimited allowance or automatic funding');});
