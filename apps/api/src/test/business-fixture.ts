import {encodeFunctionData,encodeEventTopics,encodeAbiParameters,parseAbiParameters,keccak256,erc20Abi,hashTypedData} from 'viem';
import type {Abi,Hex} from 'viem';
import {AGREEMENT_ABI,FACTORY_ABI} from '@noticevault/sdk';
import {fundingFixture,C,P,T,A,F,D,code} from './funding-fixture.js';
import {createBusinessOutcomeVerifier} from '../business-outcome.js';
import type {FundingReader} from '../funding-outcome.js';
export type BusinessAction='create-agreement'|'claim-provider'|'claim-client-refund';
export function businessFixture(action:BusinessAction='claim-provider',noop=false){
 const f=fundingFixture(),{p,r,state}=f;p.action=action;p.target=action==='create-agreement'?F:A;
 const terms={schemaVersion:1,client:C,provider:P,token:T,amountPerPeriod:100n,periodSeconds:3600n,noticeSeconds:3600n,startAt:1000n,clientNonce:0n,acceptanceDeadline:900n,termsDocumentHash:D};
 const vals=[1,C,P,T,100n,3600n,3600n,1000n,0n,900n,D] as const;
 const types={AgreementTerms:[{name:'schemaVersion',type:'uint32'},{name:'client',type:'address'},{name:'provider',type:'address'},{name:'token',type:'address'},{name:'amountPerPeriod',type:'uint256'},{name:'periodSeconds',type:'uint64'},{name:'noticeSeconds',type:'uint64'},{name:'startAt',type:'uint64'},{name:'clientNonce',type:'uint256'},{name:'acceptanceDeadline',type:'uint64'},{name:'termsDocumentHash',type:'bytes32'}]};
 const td=hashTypedData({domain:{name:'NoticeVaultAgreement',version:'1',chainId:31337n,verifyingContract:F},types,primaryType:'AgreementTerms',message:terms});
 p.business={termsHash:keccak256(encodeAbiParameters(parseAbiParameters('uint32,address,address,address,uint256,uint64,uint64,uint64,uint256,uint64,bytes32'),vals)),agreementCodeHash:keccak256(code),termsDigest:td};
 p.data=action==='create-agreement'?encodeFunctionData({abi:FACTORY_ABI,functionName:'createAgreement',args:[terms,'0x11']}):encodeFunctionData({abi:AGREEMENT_ABI,functionName:action==='claim-provider'?'claimProvider':'claimClientRefund'});
 state.terms=[...vals];state.time=action==='create-agreement'?500n:2800n;
 state.accounting=action==='create-agreement'?[100n,0n,0n,0n,100n,false,0n,0,200n]:action==='claim-provider'?[100n,50n,0n,0n,100n,false,0n,0,150n]:[100n,0n,0n,50n,100n,true,2800n,1,150n];
 state.balance=BigInt(String(state.accounting[8]));state.factoryL=state.balance;state.totalL=state.balance;
 const control={noop,regularAmount:50n,noticeAmount:0n,capacityL:150n,amount:action==='create-agreement'?200n:50n,recipient:action==='claim-provider'?P:C,nonceUnavailable:true,termsDigest:td,materialize:false,omitTransfer:false,duplicate:false,removed:false,wrongEmitter:false,blockHash:r.blockHash,logsBloom:'0x'+'0'.repeat(512)};
 function log(emitter:Hex,abi:Abi,eventName:string,params:string,values:readonly unknown[],args?:Record<string,unknown>){return {address:control.wrongEmitter?C:emitter,topics:encodeEventTopics({abi,eventName,...(args?{args}:{})}),data:encodeAbiParameters(parseAbiParameters(params),values),transactionHash:r.hash,blockHash:r.blockHash,blockNumber:r.blockNumber,transactionIndex:0,logIndex:0,removed:control.removed};}
 function logs(){const ls:ReturnType<typeof log>[]=[];
 if(control.materialize)ls.push(log(A,AGREEMENT_ABI,'NoticeStarted','uint64,uint8',[4600n,2]));
 if(!control.noop){
 if(action==='create-agreement'){
  if(!control.omitTransfer)ls.push(log(T,erc20Abi,'Transfer','uint256',[control.amount],{from:C,to:A}));
  ls.push(log(F,FACTORY_ABI,'AgreementCreated','uint256,uint64,uint64,uint64,uint256,uint256',[100n,3600n,3600n,1000n,100n,100n],{agreement:A,client:C,provider:P}));
  ls.push(log(F,FACTORY_ABI,'CapacityChanged','int256,uint256,uint256',[200n,200n,200n],{agreement:A}));
 }else{
  ls.push(log(F,FACTORY_ABI,'CapacityChanged','int256,uint256,uint256',[-control.amount,control.capacityL,control.capacityL],{agreement:A}));
  if(!control.omitTransfer)ls.push(log(T,erc20Abi,'Transfer','uint256',[control.amount],{from:A,to:control.recipient}));
  ls.push(action==='claim-provider'?log(A,AGREEMENT_ABI,'ProviderClaimed','uint256,uint256,uint256',[control.regularAmount,control.noticeAmount,control.amount]):log(A,AGREEMENT_ABI,'ClientRefunded','uint256',[control.amount]));
 }}
 if(control.duplicate&&ls[0])ls.push({...ls[0]});return ls.map((l,i)=>({...l,logIndex:i}));}
 function reader(base:FundingReader):FundingReader{return {...base,getTransactionReceipt:async()=>({transactionHash:r.hash,from:p.actor,to:p.target,status:'success',blockNumber:r.blockNumber,blockHash:r.blockHash,transactionIndex:0,logsBloom:control.logsBloom,logs:logs()}),getBlock:async()=>({number:r.blockNumber,hash:control.blockHash,timestamp:state.time,transactions:[r.hash]}),readContract:async a=>a.address===F&&a.functionName==='isNonceUnavailable'?control.nonceUnavailable:a.address===F&&a.functionName==='termsDigest'?control.termsDigest:base.readContract(a)};}
 const a=reader(f.a),b=reader(f.b),verify=createBusinessOutcomeVerifier({chainId:31337n,factory:F,token:T,factoryCodeHash:keccak256(code),tokenCodeHash:keccak256(code),policyHash:D},[a,b]);
 const adapter={...f.adapter,verifyBusiness:verify};return {...f,a,b,verify,adapter,control,logs,terms};
}
