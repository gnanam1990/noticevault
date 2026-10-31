/** Deterministic injected RPC fixtures; no network, wallets or chain writes. */
import {describe,it,expect} from "vitest";
import {keccak256} from "viem";
import type {Hex} from "viem";
import {observeFactoryForCreation} from "./snapshot.js";
import type {MinimalPublicClient} from "./snapshot.js";
import {prepareApproveForCreation,prepareInvalidateNonce} from "./txprep.js";
import type {NoticeVaultDeployment,TermsInput} from "./types.js";
import * as publicTypes from "./types.js";
const F="0x2222222222222222222222222222222222222222",T="0x3333333333333333333333333333333333333333",C="0x1111111111111111111111111111111111111111",P="0x4444444444444444444444444444444444444444",OTHER="0x5555555555555555555555555555555555555555";
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
describe("T024 factory evidence boundaries",()=>{
 it("valid issued evidence supports approval and reads token+decimals at the pinned block",async()=>{const f=fixture();const e=await f.observe();expect(e.status).toBe("ok");expect(prepareApproveForCreation(f.dep,e,C,f.now,{account:C,chainId:f.dep.chainId}).to).toBe(T);expect(f.reads).toContainEqual({functionName:"token",address:F,blockNumber:123n});expect(f.reads).toContainEqual({functionName:"decimals",address:T,blockNumber:123n});});
 it.each([['token',OTHER],['token',undefined],['token',17],['decimals',18],['decimals',undefined],['decimals',6n],['factoryCap','100'],['factoryCap',-1n],['factoryCap',1n<<256n],['agreementCap',null],['outstandingLiability',undefined],['creationPaused','false'],['isNonceUnavailable',0],['balanceOf',-1n],['allowance',undefined]])("rejects malformed/mismatched required read %s=%s",async(name,value)=>{expect((await fixture({values:{[String(name)]:value}}).observe()).status).not.toBe("ok");});
 it.each(['token','decimals','factoryCap','allowance'])("fails closed when %s read fails",async fail=>{expect((await fixture({fail}).observe()).status).not.toBe("ok");});
 it.each([{number:-1n},{hash:"0x01"},{timestamp:undefined}])("rejects invalid block proof %s",async block=>{expect((await fixture({block}).observe()).status).not.toBe("ok");});
 it.each([{hash:("0x"+"bb".repeat(32))},{number:124n},{timestamp:1n}])("rejects changed recheck proof %s",async recheck=>{expect((await fixture({recheck}).observe()).status).not.toBe("ok");});
 it("freezes owned copies, not caller terms",async()=>{const f=fixture();const e=await f.observe();expect(e.status).toBe("ok");expect(e.requestedTerms).not.toBe(f.terms);expect(Object.isFrozen(e.requestedTerms)).toBe(true);f.terms.amountPerPeriod=999n;expect(e.requestedTerms?.amountPerPeriod).toBe(3000000n);});
 it.each([{factoryAddress:OTHER},{allowlistedToken:OTHER},{expectedFactoryCodeHash:H},{expectedTokenCodeHash:H},{isLive:true}])("rejects a deployment policy swap on issued evidence %s",async change=>{const f=fixture();const e=await f.observe();expect(e.status).toBe("ok");expect(prepareInvalidateNonce(7n,f.dep,e,C,{account:C,chainId:f.dep.chainId}).to).toBe(F);expect(()=>prepareInvalidateNonce(7n,{...f.dep,...change} as NoticeVaultDeployment,e,C,{account:C,chainId:f.dep.chainId})).toThrow();});
 it.each(['client','nonce','token'])("rejects caller/terms %s mismatch at issuance",async kind=>{const f=fixture();if(kind==='client')f.terms.client=OTHER;if(kind==='nonce')f.terms.clientNonce=8n;if(kind==='token')f.terms.token=OTHER;expect((await f.observe()).status).not.toBe("ok");});
 it("does not expose arbitrary factory brand issuance",()=>{expect((publicTypes as Record<string,unknown>)._brandFactoryObservation).toBeUndefined();});
 it("rejects a copied valid proof",async()=>{const f=fixture();const e=await f.observe();expect(e.status).toBe("ok");expect(()=>prepareInvalidateNonce(7n,f.dep,{...e},C,{account:C,chainId:f.dep.chainId})).toThrow();});
});
