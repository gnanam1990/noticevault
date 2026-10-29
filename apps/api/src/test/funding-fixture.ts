import {encodeFunctionData,encodeEventTopics,encodeAbiParameters,parseAbiParameters,keccak256,erc20Abi} from 'viem';
import type {Hex} from 'viem';
import {AGREEMENT_ABI,FACTORY_ABI} from '@noticevault/sdk';
import {createFundingOutcomeVerifier} from '../funding-outcome.js';
import type {FundingReader} from '../funding-outcome.js';
import type {AttemptPreparation,SyntheticAttemptAdapter} from '../attempt-evidence.js';
export const C=('0x'+'1'.repeat(40)) as Hex,P=('0x'+'2'.repeat(40)) as Hex,T=('0x'+'3'.repeat(40)) as Hex,A=('0x'+'9'.repeat(40)) as Hex,F=('0x'+'5'.repeat(40)) as Hex,H=('0x'+'a'.repeat(64)) as Hex,B=('0x'+'b'.repeat(64)) as Hex,D=('0x'+'c'.repeat(64)) as Hex,code='0x6000' as Hex;
export function fundingFixture(chain=31337){
 const terms=[1,C,P,T,100n,100n,50n,100n,0n,99n,D] as const;
 const termsHash=keccak256(encodeAbiParameters(parseAbiParameters('uint32,address,address,address,uint256,uint64,uint64,uint64,uint256,uint64,bytes32'),terms));
 const p:AttemptPreparation={source:'SYNTHETIC',workspaceId:'w',actor:C,chainId:String(chain),resource:'agreement:'+A,action:'fund-renewal',policyHash:D,cycleKey:'200',networkNonce:'1',target:A,data:encodeFunctionData({abi:AGREEMENT_ABI,functionName:'fundNextPeriod',args:[200n]}),value:'0',issuedAt:Date.now(),funding:{termsHash,agreementCodeHash:keccak256(code),regularFunded:'100',fundedThrough:'200'}};
 const r={hash:H,blockNumber:10n,blockHash:B};
 const state={time:150n,amount:100n,newF:200n,newD:300n,transfer:100n,from:C,to:A,capacityDelta:100n,capacityL:250n,capacityTotal:250n,balance:250n,allowance:0n,registered:true,decimals:6,factory:F,token:T,code,chain,accounting:[200n,0n,0n,0n,50n,false,0n,0,250n] as unknown[],terms:[...terms] as unknown[],factoryL:250n,totalL:250n};
 const rawLogs=()=>[
 {address:F,topics:encodeEventTopics({abi:FACTORY_ABI,eventName:'CapacityChanged',args:{agreement:A}}),data:encodeAbiParameters(parseAbiParameters('int256,uint256,uint256'),[state.capacityDelta,state.capacityL,state.capacityTotal])},
 {address:T,topics:encodeEventTopics({abi:erc20Abi,eventName:'Transfer',args:{from:state.from,to:state.to}}),data:encodeAbiParameters(parseAbiParameters('uint256'),[state.transfer])},
 {address:A,topics:encodeEventTopics({abi:AGREEMENT_ABI,eventName:'RegularFunded'}),data:encodeAbiParameters(parseAbiParameters('uint256,uint64,uint256'),[state.newF,state.newD,state.amount])}
 ].map((l,i)=>({...l,transactionHash:r.hash,blockHash:r.blockHash,blockNumber:r.blockNumber,transactionIndex:0,logIndex:i,removed:false}));
 const reader=():FundingReader=>({getChainId:async()=>state.chain,getTransactionReceipt:async()=>({transactionHash:r.hash,blockHash:r.blockHash,blockNumber:r.blockNumber,transactionIndex:0,from:p.actor,to:p.target,status:'success',logs:rawLogs()}),getBytecode:async()=>state.code,getBlock:async()=>({number:r.blockNumber,hash:r.blockHash,timestamp:state.time,transactions:[r.hash]}),readContract:async a=>{
  if(a.address===A){if(a.functionName==='terms')return state.terms;if(a.functionName==='accounting')return state.accounting;return state.factory;}
  if(a.address===F){if(a.functionName==='registeredAgreement')return state.registered;if(a.functionName==='token')return state.token;if(a.functionName==='perAgreementLiability')return state.factoryL;return state.totalL;}
  if(a.functionName==='decimals')return state.decimals;if(a.functionName==='balanceOf')return state.balance;return state.allowance;
 }});
 const a=reader(),b=reader(),verify=createFundingOutcomeVerifier({chainId:BigInt(chain),factory:F,token:T,factoryCodeHash:keccak256(code),tokenCodeHash:keccak256(code),policyHash:D},[a,b]);
 const adapter:SyntheticAttemptAdapter={source:'SYNTHETIC',prepare:async()=>p,verifyFunding:verify,rpc:{getChainId:async()=>BigInt(chain),findTransaction:async()=>({hash:r.hash,chainId:BigInt(chain),from:p.actor,to:p.target,nonce:BigInt(p.networkNonce),input:p.data,value:0n}),getReceipt:async()=>({hash:r.hash,status:'confirmed',blockNumber:r.blockNumber,blockHash:r.blockHash}),getBlock:async()=>({number:r.blockNumber,hash:r.blockHash,transactions:[r.hash]})}};
 return {p,r,state,a,b,verify,adapter,rawLogs};
}
