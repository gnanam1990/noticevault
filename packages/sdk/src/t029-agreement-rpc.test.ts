import {describe,it,expect,vi,beforeEach,afterEach} from "vitest";
import {keccak256} from "viem";
import type {Hex} from "viem";
import {observeFactoryForCreation,observeAgreement,buildSimulationSnapshot} from "./snapshot.js";
import type {MinimalPublicClient} from "./snapshot.js";
import type {NoticeVaultDeployment,TermsInput} from "./types.js";


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
const change=(name:string,value:unknown)=>(n:string,v:unknown)=>n===name?value:v;
const field=(name:string,key:string|number,value:unknown)=>(n:string,v:unknown)=>n===name?(Array.isArray(v)?v.map((x,i)=>i===key?value:x):{...(v as object),[key]:value}):v;

describe("T029 agreement RPC validation",()=>{
 it("accepts valid pinned reads and cross-checked preview",async()=>{const f=agreementFixture();expect((await f.observe()).status).toBe("ok");expect(f.reads.every(r=>r.blockNumber===123n)).toBe(true);});
 it.each([
  ["registered string",change("registeredAgreement","false")],
  ["cap string",change("factoryCap","100000000")],
  ["negative cap",change("agreementCap",-1n)],
  ["overflow liability",change("outstandingLiability",1n<<256n)],
  ["pause string",change("creationPaused","false")],
  ["nonce number",change("isNonceUnavailable",0)],
  ["token malformed",change("token",null)],
  ["terms missing",change("terms",[])],
  ["terms schema string",field("terms",0,"1")],
  ["terms amount number",field("terms",4,3000000)],
  ["terms hash malformed",field("terms",10,"0x12")],
  ["accounting string",field("accounting",0,"3000000")],
  ["accounting bool number",field("accounting",5,0)],
  ["accounting reason string",field("accounting",7,"0")],
  ["preview string",field("preview","R","3000000")],
  ["preview bool number",field("preview","hasStoredNotice_",0)],
  ["preview missing timestamp",field("preview","observationTimestamp",undefined)],
  ["preview wrong timestamp",field("preview","observationTimestamp",1n)],
  ["preview reason mismatch",field("preview","reason",1)],
  ["preview notice mismatch",field("preview","hasStoredNotice_",true)],
  ["balance string",change("balanceOf","100000000")],
  ["allowance negative",change("allowance",-1n)],
 ] as const)("fails closed: %s",async(_name,mutate)=>{expect((await agreementFixture({mutate}).observe()).status).not.toBe("ok");});
 it("rejects allowance reads for a different client",async()=>{expect((await agreementFixture({clientAddress:OTHER}).observe()).status).not.toBe("ok");});
});

describe("T029 pinned proof and chain recheck",()=>{
 it.each([{number:-1n},{number:123},{hash:"0x12"},{hash:"0x"+"00".repeat(32)},{timestamp:"1800000000"}])("rejects malformed initial block %s",async block=>{expect((await agreementFixture({block}).observe()).status).not.toBe("ok");});
 it.each([{number:124n},{timestamp:1800000001n},{hash:"0x"+"bb".repeat(32)},{number:123}])("rejects changed or malformed recheck %s",async recheck=>{expect((await agreementFixture({recheck}).observe()).status).not.toBe("ok");});
 it.each([["31337"],[31337.5],[31337,1]])("rejects invalid or changed RPC chain %s",async(...chains)=>{expect((await agreementFixture({chains}).observe()).status).not.toBe("ok");});
 it("fails closed on required read failure",async()=>{expect((await agreementFixture({fail:"preview"}).observe()).status).toBe("rpc_failure");});
});
