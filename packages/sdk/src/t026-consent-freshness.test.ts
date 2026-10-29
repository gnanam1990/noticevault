import {describe,it,expect,vi,afterEach} from "vitest";
import {keccak256} from "viem";
import type {Hex} from "viem";
import {observeFactoryForCreation} from "./snapshot.js";
import type {MinimalPublicClient} from "./snapshot.js";
import {prepareCreateAgreement} from "./txprep.js";
import {issueProviderConsent} from "./eip712.js";
import type {NoticeVaultDeployment,TermsInput} from "./types.js";
const F="0x2222222222222222222222222222222222222222",T="0x3333333333333333333333333333333333333333",C="0x1111111111111111111111111111111111111111",P="0x4444444444444444444444444444444444444444";
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

const SIG="0x1234" as Hex;
function contractFixture(){return fixture({providerCode:"0x6000",values:{isValidSignature:"0x1626ba7e"}});}
afterEach(()=>vi.restoreAllMocks());
describe("T026 consent factory freshness and canonicality",()=>{
 it("issues usable consent with every provider read and recheck pinned",async()=>{
  const f=contractFixture();const e=await f.observe();const pins:unknown[]=[];const getBlock=f.rpc.getBlock;
  f.rpc.getBlock=async args=>{pins.push(args);return getBlock(args as never);};
  const {consent,verifyResult}=await issueProviderConsent(f.rpc,f.terms,f.dep,SIG,e);
  expect(verifyResult.status).toBe("valid");expect(consent).not.toBeNull();
  expect(pins).toContainEqual({blockNumber:123n});expect(f.reads.filter(r=>r.functionName==="isValidSignature")).toEqual([{functionName:"isValidSignature",address:P,blockNumber:123n}]);
  expect((await prepareCreateAgreement(f.terms,SIG,consent!,f.dep,e,C,f.now,{account:C,chainId:f.dep.chainId})).to).toBe(F);
 });
 it("rejects a copied factory proof before provider verification",async()=>{
  const f=contractFixture();const e=await f.observe();f.reads.length=0;
  expect((await issueProviderConsent(f.rpc,f.terms,f.dep,SIG,{...e})).consent).toBeNull();
  expect(f.reads).toHaveLength(0);
 });
 it("rejects stale issued factory evidence",async()=>{
  const f=contractFixture();const e=await f.observe();vi.spyOn(Date,"now").mockReturnValue(e.block.observedAt+61000);
  expect((await issueProviderConsent(f.rpc,f.terms,f.dep,SIG,e)).consent).toBeNull();
 });
 it("rejects terms different from those observed",async()=>{
  const f=contractFixture();const e=await f.observe();
  expect((await issueProviderConsent(f.rpc,{...f.terms,amountPerPeriod:4000000n},f.dep,SIG,e)).consent).toBeNull();
 });
 it("rejects changed deployment code policy",async()=>{
  const f=contractFixture();const e=await f.observe();
  expect((await issueProviderConsent(f.rpc,f.terms,{...f.dep,expectedFactoryCodeHash:H},SIG,e)).consent).toBeNull();
 });
 it.each([{hash:("0x"+"bb".repeat(32))},{number:124n},{timestamp:1n}])("rejects changed pinned block proof %s",async change=>{
  const f=contractFixture();const e=await f.observe();f.rpc.getBlock=async()=>({number:123n,hash:H,timestamp:f.now,...change}) as never;
  expect((await issueProviderConsent(f.rpc,f.terms,f.dep,SIG,e)).consent).toBeNull();
 });
 it("fails closed when pinned recheck is unavailable",async()=>{
  const f=contractFixture();const e=await f.observe();f.rpc.getBlock=async()=>{throw new Error("unavailable");};
  expect((await issueProviderConsent(f.rpc,f.terms,f.dep,SIG,e)).consent).toBeNull();
 });
 it("rechecks freshness after verification completes",async()=>{
  const f=contractFixture();const e=await f.observe();const read=f.rpc.readContract;
  f.rpc.readContract=async args=>{const value=await read(args);if(args.functionName==="isValidSignature")vi.spyOn(Date,"now").mockReturnValue(e.block.observedAt+61000);return value;};
  expect((await issueProviderConsent(f.rpc,f.terms,f.dep,SIG,e)).consent).toBeNull();
 });
 it("rejects expired acceptance using actual time",async()=>{
  const f=contractFixture();f.terms.acceptanceDeadline=f.now+10n;const e=await f.observe();vi.spyOn(Date,"now").mockReturnValue(Number(f.now+11n)*1000);
  expect((await issueProviderConsent(f.rpc,f.terms,f.dep,SIG,e)).consent).toBeNull();
 });
 it("rejects a verification RPC on another chain",async()=>{
  const f=contractFixture();const e=await f.observe();f.rpc.getChainId=async()=>999;
  expect((await issueProviderConsent(f.rpc,f.terms,f.dep,SIG,e)).consent).toBeNull();
 });
 it("cannot reuse consent at a different block hash with the same height",async()=>{
  const f=contractFixture();const e=await f.observe();const result=await issueProviderConsent(f.rpc,f.terms,f.dep,SIG,e);expect(result.consent).not.toBeNull();
  const other=contractFixture();Object.assign(other.terms,f.terms);other.rpc.getBlock=async()=>({number:123n,hash:("0x"+"bb".repeat(32)) as Hex,timestamp:f.now});
  const replacement=await other.observe();expect(replacement.status).toBe("ok");
  await expect(prepareCreateAgreement(f.terms,SIG,result.consent!,f.dep,replacement,C,f.now,{account:C,chainId:f.dep.chainId})).rejects.toThrow(/factory evidence/);
 });
});
