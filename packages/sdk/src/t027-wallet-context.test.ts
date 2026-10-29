import {describe,it,expect,vi,beforeEach,afterEach} from "vitest";
import {keccak256} from "viem";
import type {Hex} from "viem";
import {observeFactoryForCreation,observeAgreement,buildSimulationSnapshot} from "./snapshot.js";
import type {MinimalPublicClient} from "./snapshot.js";
import type {NoticeVaultDeployment,TermsInput} from "./types.js";
import {issueProviderConsent} from "./eip712.js";
import * as prep from "./txprep.js";
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

const TEST_MS=1800000000000, SIG="0x1234" as Hex, G="0x6666666666666666666666666666666666666666" as Hex;
beforeEach(()=>vi.spyOn(Date,"now").mockReturnValue(TEST_MS));
afterEach(()=>vi.restoreAllMocks());
async function setup(){
 const f=fixture({providerCode:"0x6000",values:{isValidSignature:"0x1626ba7e"}});const factory=await f.observe();expect(factory.status).toBe("ok");
 const {consent}=await issueProviderConsent(f.rpc,f.terms,f.dep,SIG,factory);expect(consent).not.toBeNull();
 const terms={...f.terms,startAt:f.now-3599n,periodSeconds:3600n,noticeSeconds:3600n};
 const state={terms,regularFunded:3000000n,regularPaid:0n,noticePaid:0n,clientRefunded:0n,noticeStartStored:null,noticeReasonStored:null};
 const snap=buildSimulationSnapshot(state,f.now);
 const rpc={...f.rpc,readContract:async (a:Parameters<MinimalPublicClient["readContract"]>[0])=>{
  if(a.functionName==="registeredAgreement")return true;
  if(a.functionName==="terms")return Object.values(terms);
  if(a.functionName==="accounting")return [3000000n,0n,0n,0n,3000000n,false,0n,0,6000000n];
  if(a.functionName==="preview")return {...snap,phase:1,S:0n,E:0n,reason:0,hasStoredNotice_:false};
  return f.rpc.readContract(a);
 }};
 const agreement=await observeAgreement(rpc,f.dep,G,undefined,C);expect(agreement.status).toBe("ok");
 const args={
  prepareApproveForCreation:[f.dep,factory,C,f.now],
  prepareCreateAgreement:[f.terms,SIG,consent,f.dep,factory,C,f.now],
  prepareInvalidateNonce:[7n,f.dep,factory,C],
  prepareApproveForRenewal:[G,f.dep,agreement,C,f.now],
  prepareFundNextPeriod:[snap.D,G,f.dep,agreement,C,f.now],
  prepareStartNotice:[G,f.dep,agreement,C],
  prepareMaterializeNotice:[G,f.dep,agreement],
  prepareClaimProvider:[G,f.dep,agreement],
  prepareClaimClientRefund:[G,f.dep,agreement],
 };
 return {...f,factory,agreement,consent,args,call:async(name:keyof typeof args,wallet:unknown)=>Reflect.apply(prep[name],undefined,[...args[name],wallet])};
}
const METHODS=["prepareApproveForCreation","prepareCreateAgreement","prepareInvalidateNonce","prepareApproveForRenewal","prepareFundNextPeriod","prepareStartNotice","prepareMaterializeNotice","prepareClaimProvider","prepareClaimClientRefund"] as const;
const WALLET={account:C,chainId:31337n};

describe("T027 connected wallet context and trusted clock",()=>{
 it.each(METHODS)("valid context reaches %s",async name=>{const f=await setup();expect((await f.call(name,WALLET)).functionName).toBeTruthy();});
 it.each(METHODS)("%s rejects missing, wrong-chain and malformed wallet context",async name=>{
  const f=await setup();await f.call(name,WALLET);
  for(const bad of [undefined,{account:C,chainId:999n},{account:"0x"+"00".repeat(20),chainId:31337n}])await expect(f.call(name,bad)).rejects.toThrow(/wallet/i);
 });
 it.each(METHODS.slice(0,6))("%s rejects a wallet account different from requested actor",async name=>{const f=await setup();await expect(f.call(name,{account:OTHER,chainId:31337n})).rejects.toThrow(/wallet/i);});
 it.each(["prepareApproveForCreation","prepareCreateAgreement"] as const)("%s cannot backdate an expired acceptance",async name=>{
  const f=await setup();f.terms.acceptanceDeadline=f.now+10n;const e=await f.observe();const {consent}=await issueProviderConsent(f.rpc,f.terms,f.dep,SIG,e);expect(consent).not.toBeNull();
  vi.mocked(Date.now).mockReturnValue(TEST_MS+11000);
  const args=name==="prepareApproveForCreation"?[f.dep,e,C,f.now,WALLET]:[f.terms,SIG,consent,f.dep,e,C,f.now,WALLET];
  await expect((async()=>Reflect.apply(prep[name],undefined,args))()).rejects.toThrow(/deadline/i);
 });
 it.each(["prepareApproveForRenewal","prepareFundNextPeriod"] as const)("%s cannot backdate a closed funding window",async name=>{const f=await setup();vi.mocked(Date.now).mockReturnValue(TEST_MS+2000);await expect(f.call(name,WALLET)).rejects.toThrow(/window|funding/i);});
 it("cannot move caller time forward to admit an excessive creation horizon",async()=>{
  const f=await setup();f.terms.startAt=f.now+604900n;f.terms.acceptanceDeadline=f.now+10000n;const e=await f.observe();const {consent}=await issueProviderConsent(f.rpc,f.terms,f.dep,SIG,e);expect(consent).not.toBeNull();
  await expect((async()=>Reflect.apply(prep.prepareCreateAgreement,undefined,[f.terms,SIG,consent,f.dep,e,C,f.now+1000n,WALLET]))()).rejects.toThrow(/creation window/i);
 });
});
