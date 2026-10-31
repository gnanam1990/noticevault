import {describe,it,expect,vi,beforeEach,afterEach} from "vitest";
import {keccak256} from "viem";
import type {Hex} from "viem";
import {observeFactoryForCreation,observeAgreement,buildSimulationSnapshot} from "./snapshot.js";
import type {MinimalPublicClient} from "./snapshot.js";
import type {NoticeVaultDeployment,TermsInput} from "./types.js";


const F="0x2222222222222222222222222222222222222222",T="0x3333333333333333333333333333333333333333",C="0x1111111111111111111111111111111111111111",P="0x4444444444444444444444444444444444444444";
const FC="0x60006000" as Hex,TC="0x60016001" as Hex,H=("0x"+"aa".repeat(32)) as Hex;
function fixture(opts:{values?:Record<string,unknown>;fail?:string;block?:Record<string,unknown>;recheck?:Record<string,unknown>;providerCode?:unknown}={}) {
 const now=BigInt(Math.floor(Date.now()/1000));
 const dep:NoticeVaultDeployment={configIdentity:"ARC_TESTNET",chainId:31337n,factoryAddress:F,allowlistedToken:T,expectedFactoryCodeHash:keccak256(FC),expectedTokenCodeHash:keccak256(TC),isLive:false,label:"Synthetic T024"};
 const terms:TermsInput={schemaVersion:1,client:C,provider:P,token:T,amountPerPeriod:3000000n,periodSeconds:2592000n,noticeSeconds:864000n,startAt:now+600n,clientNonce:7n,acceptanceDeadline:now+1000n,termsDocumentHash:H};
 const reads:Array<{functionName:string;address:string;blockNumber:bigint}>=[];
 const block={number:123n,hash:H,timestamp:now,...opts.block};
 const values:Record<string,unknown>={token:T,decimals:6,factoryCap:100000000n,agreementCap:100000000n,outstandingLiability:0n,allocatedCapacity:0n,perAgreementAllocation:100000000n,creationPaused:false,isNonceUnavailable:false,balanceOf:100000000n,allowance:100000000n,...opts.values};
 const rpc:MinimalPublicClient={getChainId:async()=>31337,getBlock:async args=>({...block,...('blockNumber' in args?opts.recheck:{})}) as never,getBytecode:async({address})=>address.toLowerCase()===F?FC:address.toLowerCase()===T?TC:('providerCode' in opts?opts.providerCode:"0x") as Hex,readContract:async args=>{reads.push({functionName:args.functionName,address:args.address,blockNumber:args.blockNumber});if(args.functionName===opts.fail)throw new Error("Injected failure");return values[args.functionName];}};
 return {dep,terms,rpc,reads,now,observe:()=>observeFactoryForCreation(rpc,dep,C,7n,terms)};
}


const TEST_MS=1800000000000,G="0x6666666666666666666666666666666666666666" as Hex;
beforeEach(()=>vi.spyOn(Date,"now").mockReturnValue(TEST_MS));
afterEach(()=>vi.restoreAllMocks());
function agreementFixture(options:{mutate?:(name:string,value:unknown)=>unknown;block?:Record<string,unknown>;recheck?:Record<string,unknown>;chains?:unknown[];clientAddress?:Hex;fail?:string}={}){
 const f=fixture({block:options.block,recheck:options.recheck});
 const terms={...f.terms,startAt:f.now-1800n,periodSeconds:3600n,noticeSeconds:3600n};
 const snap=buildSimulationSnapshot({terms,regularFunded:3000000n,regularPaid:0n,noticePaid:0n,clientRefunded:0n,noticeStartStored:null,noticeReasonStored:null},f.now);
 const raw:Record<string,unknown>={allocatedCapacity:100000000n,registeredAgreement:true,terms:Object.values(terms),accounting:[3000000n,0n,0n,0n,3000000n,false,0n,0,6000000n],preview:{...snap,phase:1,S:0n,E:0n,reason:0,hasStoredNotice_:false}};
 let chainCalls=0;const reads:Array<{functionName:string;blockNumber:bigint}>=[];
 const rpc:MinimalPublicClient={...f.rpc,getChainId:async()=>{const i=chainCalls++;return (options.chains?.[Math.min(i,options.chains.length-1)]??31337) as number;},readContract:async a=>{
  reads.push({functionName:a.functionName,blockNumber:a.blockNumber});if(a.functionName===options.fail)throw Error("Injected RPC failure");
  const value=Object.prototype.hasOwnProperty.call(raw,a.functionName)?raw[a.functionName]:await f.rpc.readContract(a);
  return options.mutate?options.mutate(a.functionName,value):value;
 }};
 return {...f,terms,reads,rpc,observe:()=>observeAgreement(rpc,f.dep,G,terms,options.clientAddress??C)};
}

import {prepareApproveForRenewal,prepareFundNextPeriod} from "./txprep.js";
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
  minedApproval:()=>{allowance=A;f.rpc.getBlock=async()=>({number:124n,hash:("0x"+"bb".repeat(32)) as Hex,timestamp:f.now});}
 };
}
describe("T030 renewal balance and agreement allowance",()=>{
 it("retains pinned client balance distinct from agreement funds",async()=>{const f=renewalFixture(A);const e=await f.observe();expect(e.status).toBe("ok");expect((e as unknown as {clientTokenBalance:bigint}).clientTokenBalance).toBe(A);expect(e.tokenBalance).toBe(100000000n);expect(f.requests.filter(r=>r.functionName==="balanceOf"||r.functionName==="allowance").every(r=>r.blockNumber===123n)).toBe(true);});
 it("allows exact-A approval with zero allowance, spender agreement",async()=>{const f=renewalFixture(A,0n);const tx=f.approve(await f.observe());expect(tx.to).toBe(T);expect(tx.args).toEqual([G,A]);});
 it("funds with exact-A client balance and agreement allowance",async()=>{const f=renewalFixture();expect(f.fund(await f.observe()).functionName).toBe("fundNextPeriod");});
 it.each([0n,A-1n])("rejects inadequate client balance %s for approval and funding",async balance=>{const f=renewalFixture(balance);const e=await f.observe();expect(e.status).toBe("ok");expect(()=>f.approve(e)).toThrow(/balance/);expect(()=>f.fund(e)).toThrow(/balance/);});
 it.each([0n,A-1n])("rejects inadequate agreement allowance %s despite factory approval",async allowance=>{const f=renewalFixture(A,allowance);const e=await f.observe();expect(e.clientAllowanceToFactory).toBe(100000000n);expect(()=>f.fund(e)).toThrow(/allowance/);});
 it("fails closed when client funds were not observed",async()=>{const f=renewalFixture();const e=await f.observe(false);expect(e.status).toBe("ok");expect(()=>f.approve(e)).toThrow(/balance/);expect(()=>f.fund(e)).toThrow(/balance/);});
 it("uses fresh observation after approval without a circular gate",async()=>{const f=renewalFixture(A,0n);const before=await f.observe();expect(f.approve(before).args).toEqual([G,A]);expect(()=>f.fund(before)).toThrow(/allowance/);f.minedApproval();const after=await f.observe();expect(after.block.blockNumber).toBe(124n);expect(f.fund(after).functionName).toBe("fundNextPeriod");expect(()=>f.fund(before)).toThrow(/allowance/);});
});
