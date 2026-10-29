import {describe,it,expect} from "vitest";
import {keccak256} from "viem";
import type {Hex} from "viem";
import {observeFactoryForCreation} from "./snapshot.js";
import type {MinimalPublicClient} from "./snapshot.js";
import {prepareApproveForCreation,prepareCreateAgreement,prepareInvalidateNonce} from "./txprep.js";
import type {NoticeVaultDeployment,TermsInput} from "./types.js";
import * as publicTypes from "./types.js";
import * as publicSnapshot from "./snapshot.js";
import * as publicSdk from "./index.js";
const F="0x2222222222222222222222222222222222222222",T="0x3333333333333333333333333333333333333333",C="0x1111111111111111111111111111111111111111",P="0x4444444444444444444444444444444444444444",OTHER="0x5555555555555555555555555555555555555555";
const FC="0x60006000" as Hex,TC="0x60016001" as Hex,H=("0x"+"aa".repeat(32)) as Hex;
function fixture(opts:{values?:Record<string,unknown>;fail?:string;block?:Record<string,unknown>;recheck?:Record<string,unknown>;providerCode?:unknown}={}) {
 const now=BigInt(Math.floor(Date.now()/1000));
 const dep:NoticeVaultDeployment={configIdentity:"ARC_TESTNET",chainId:31337n,factoryAddress:F,allowlistedToken:T,expectedFactoryCodeHash:keccak256(FC),expectedTokenCodeHash:keccak256(TC),isLive:false,label:"Synthetic T024"};
 const terms:TermsInput={schemaVersion:1,client:C,provider:P,token:T,amountPerPeriod:3000000n,periodSeconds:2592000n,noticeSeconds:864000n,startAt:now+600n,clientNonce:7n,acceptanceDeadline:now+1000n,termsDocumentHash:H};
 const reads:Array<{functionName:string;address:string;blockNumber:bigint}>=[];
 const block={number:123n,hash:H,timestamp:now,...opts.block};
 const values:Record<string,unknown>={token:T,decimals:6,factoryCap:100000000n,agreementCap:100000000n,outstandingLiability:0n,creationPaused:false,isNonceUnavailable:false,balanceOf:100000000n,allowance:100000000n,...opts.values};
 const rpc:MinimalPublicClient={getChainId:async()=>31337,getBlock:async args=>({...block,...('blockNumber' in args?opts.recheck:{})}) as never,getBytecode:async({address})=>address.toLowerCase()===F?FC:address.toLowerCase()===T?TC:('providerCode' in opts?opts.providerCode:"0x") as Hex,readContract:async args=>{reads.push({functionName:args.functionName,address:args.address,blockNumber:args.blockNumber});if(args.functionName===opts.fail)throw new Error("Injected failure");return values[args.functionName];}};
 return {dep,terms,rpc,reads,now,observe:()=>observeFactoryForCreation(rpc,dep,C,7n,terms)};
}

describe("T025 factory policy and issuer ownership",()=>{
 it.each([{factoryAddress:OTHER},{allowlistedToken:OTHER},{expectedFactoryCodeHash:H},{expectedTokenCodeHash:H},{isLive:true}])("all factory prep paths reject policy substitution %s",async change=>{
  const f=fixture();const e=await f.observe();expect(e.status).toBe("ok");
  expect(prepareApproveForCreation(f.dep,e,C,f.now,{account:C,chainId:f.dep.chainId}).to).toBe(T);
  const altered={...f.dep,...change} as NoticeVaultDeployment;
  expect(()=>prepareApproveForCreation(altered,e,C,f.now,{account:C,chainId:f.dep.chainId})).toThrow(/deployment policy/);
  await expect(prepareCreateAgreement(f.terms,"0x",{} as never,altered,e,C,f.now,{account:C,chainId:f.dep.chainId})).rejects.toThrow(/deployment policy/);
 });
 it("captures policy before awaiting RPC without freezing caller descriptor",async()=>{
  const f=fixture();const original={...f.dep};
  f.rpc.getChainId=async()=>{Object.assign(f.dep,{factoryAddress:OTHER,expectedFactoryCodeHash:H,isLive:true});return 31337;};
  const e=await f.observe();expect(e.status).toBe("ok");
  expect(Object.isFrozen(f.dep)).toBe(false);
  expect(prepareInvalidateNonce(7n,original,e,C,{account:C,chainId:f.dep.chainId}).to).toBe(F);
  expect(()=>prepareInvalidateNonce(7n,f.dep,e,C,{account:C,chainId:f.dep.chainId})).toThrow(/deployment policy/);
 });
 it("retains the issued policy after caller descriptor mutation",async()=>{
  const f=fixture();const original={...f.dep};const e=await f.observe();
  Object.assign(f.dep,{isLive:true});
  expect(prepareInvalidateNonce(7n,original,e,C,{account:C,chainId:f.dep.chainId}).to).toBe(F);
  expect(()=>prepareInvalidateNonce(7n,f.dep,e,C,{account:C,chainId:f.dep.chainId})).toThrow(/deployment policy/);
 });
 it("exposes no arbitrary factory issuer from types, snapshot or package entry",()=>{
  for(const entry of [publicTypes,publicSnapshot,publicSdk]){
   expect((entry as Record<string,unknown>)._brandFactoryObservation).toBeUndefined();
   expect((entry as Record<string,unknown>)._issueFactoryObservation).toBeUndefined();
  }
 });
 it("another observation brand cannot upgrade a copied factory proof",async()=>{
  const f=fixture();const e=await f.observe();expect(e.status).toBe("ok");
  const copy={...e}; const legacyIssuer=(publicTypes as Record<string,unknown>)._brandObservation; if(typeof legacyIssuer==="function") legacyIssuer(copy);
  expect(()=>prepareInvalidateNonce(7n,f.dep,copy,C,{account:C,chainId:f.dep.chainId})).toThrow(/not issued/);
 });
});
