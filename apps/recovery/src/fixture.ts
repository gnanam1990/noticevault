
import {keccak256} from "viem";
import type {Hex} from "viem";
import {observeFactoryForCreation,observeAgreement,buildSimulationSnapshot} from "../../../packages/sdk/src/snapshot.js";
import type {MinimalPublicClient} from "../../../packages/sdk/src/snapshot.js";
import type {NoticeVaultDeployment,TermsInput} from "../../../packages/sdk/src/types.js";


const F="0x2222222222222222222222222222222222222222",T="0x3333333333333333333333333333333333333333",C="0x1111111111111111111111111111111111111111",P="0x4444444444444444444444444444444444444444";
const FC="0x60006000" as Hex,TC="0x60016001" as Hex,H=("0x"+"aa".repeat(32)) as Hex;
function fixture(opts:{values?:Record<string,unknown>;fail?:string;block?:Record<string,unknown>;recheck?:Record<string,unknown>;providerCode?:unknown}={}) {
 const now=BigInt(Math.floor(Date.now()/1000));
 const dep:NoticeVaultDeployment={configIdentity:"ARC_TESTNET",chainId:5042002n,factoryAddress:F,allowlistedToken:T,expectedFactoryCodeHash:keccak256(FC),expectedTokenCodeHash:keccak256(TC),isLive:false,label:"Synthetic T024"};
 const terms:TermsInput={schemaVersion:1,client:C,provider:P,token:T,amountPerPeriod:3000000n,periodSeconds:2592000n,noticeSeconds:864000n,startAt:now+600n,clientNonce:7n,acceptanceDeadline:now+1000n,termsDocumentHash:H};
 const reads:Array<{functionName:string;address:string;blockNumber:bigint}>=[];
 const block={number:123n,hash:H,timestamp:now,...opts.block};
 const values:Record<string,unknown>={token:T,decimals:6,factoryCap:100000000n,agreementCap:100000000n,outstandingLiability:0n,creationPaused:false,isNonceUnavailable:false,balanceOf:100000000n,allowance:100000000n,...opts.values};
 const rpc:MinimalPublicClient={getChainId:async()=>5042002,getBlock:async args=>({...block,...('blockNumber' in args?opts.recheck:{})}) as never,getBytecode:async({address})=>address.toLowerCase()===F?FC:address.toLowerCase()===T?TC:('providerCode' in opts?opts.providerCode:"0x") as Hex,readContract:async args=>{reads.push({functionName:args.functionName,address:args.address,blockNumber:args.blockNumber});if(args.functionName===opts.fail)throw new Error("Injected failure");return values[args.functionName];}};
 return {dep,terms,rpc,reads,now,observe:()=>observeFactoryForCreation(rpc,dep,C,7n,terms)};
}


const G="0x6666666666666666666666666666666666666666" as Hex;
export function agreementFixture(options:{mutate?:(name:string,value:unknown)=>unknown;block?:Record<string,unknown>;recheck?:Record<string,unknown>;chains?:unknown[];clientAddress?:Hex;fail?:string}={}){
 const f=fixture({block:options.block,recheck:options.recheck});
 const terms={...f.terms,startAt:f.now-1800n,periodSeconds:86400n,noticeSeconds:86400n};
 const snap=buildSimulationSnapshot({terms,regularFunded:3000000n,regularPaid:0n,noticePaid:0n,clientRefunded:0n,noticeStartStored:null,noticeReasonStored:null},f.now);
 const raw:Record<string,unknown>={registeredAgreement:true,terms:Object.values(terms),accounting:[3000000n,0n,0n,0n,3000000n,false,0n,0,6000000n],preview:{...snap,phase:1,S:0n,E:0n,reason:0,hasStoredNotice_:false}};
 let chainCalls=0;const reads:Array<{functionName:string;blockNumber:bigint}>=[];
 const rpc:MinimalPublicClient={...f.rpc,getChainId:async()=>{const i=chainCalls++;return (options.chains?.[Math.min(i,options.chains.length-1)]??5042002) as number;},readContract:async a=>{
  reads.push({functionName:a.functionName,blockNumber:a.blockNumber});if(a.functionName===options.fail)throw Error("Injected RPC failure");
  const value=Object.prototype.hasOwnProperty.call(raw,a.functionName)?raw[a.functionName]:await f.rpc.readContract(a);
  return options.mutate?options.mutate(a.functionName,value):value;
 }};
 return {...f,terms,reads,rpc,observe:()=>observeAgreement(rpc,f.dep,G,terms,options.clientAddress??C)};
}

export {G,F,T,C,P,FC,TC,H};
