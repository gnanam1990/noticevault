/** Fake chain only. No RPC network, wallet extension or production deployment evidence. */
import {decodeFunctionData,encodeEventTopics,encodeAbiParameters,parseAbiParameters,erc20Abi,keccak256,toHex,type Hex,type Abi} from 'viem';
import {FACTORY_ABI,computeTermsDigest,type TermsInput} from '../../packages/sdk/src/index';
import {operatorFixture} from './operator-approval.fixture';
import type {RuntimeReader} from '../../apps/api/src/configured-runtime';
export async function creationFixture(options:Parameters<typeof operatorFixture>[0]){
 const f=await operatorFixture(options),dep=f.f.config.deployment,A=('0x'+'8'.repeat(40)) as Hex,H=('0x'+'a'.repeat(64)) as Hex;
 let sent:Record<string,unknown>|null=null,terms:TermsInput=f.terms,omitTransfer=false;const hash=('0x'+'d'.repeat(64)) as Hex;
 const reserve=()=>((terms.amountPerPeriod*terms.noticeSeconds)+terms.periodSeconds-1n)/terms.periodSeconds;
 const logs=()=>{
  const rows:Record<string,unknown>[]=[];const push=(address:Hex,abi:Abi,eventName:string,params:string,values:readonly unknown[],args:Record<string,unknown>)=>rows.push({address,topics:encodeEventTopics({abi,eventName,args}),data:encodeAbiParameters(parseAbiParameters(params),values),blockNumber:10n,blockHash:H,transactionHash:hash,transactionIndex:0,logIndex:rows.length,removed:false});
  const amount=terms.amountPerPeriod+reserve();
  if(!omitTransfer)push(dep.allowlistedToken! as Hex,erc20Abi,'Transfer','uint256',[amount],{from:terms.client,to:A});
  push(dep.factoryAddress! as Hex,FACTORY_ABI,'AgreementCreated','uint256,uint64,uint64,uint64,uint256,uint256',[terms.amountPerPeriod,terms.periodSeconds,terms.noticeSeconds,terms.startAt,reserve(),terms.amountPerPeriod],{agreement:A,client:terms.client,provider:terms.provider});
  push(dep.factoryAddress! as Hex,FACTORY_ABI,'CapacityChanged','int256,uint256,uint256',[amount,amount,amount],{agreement:A});return rows;
 };
 const reader=(base:RuntimeReader):RuntimeReader=>({...base,
  getBlock:async()=>({number:10n,hash:H,parentHash:'0x'+'b'.repeat(64),timestamp:f.terms.startAt-600n,transactions:sent?[hash]:[]}),
  getBytecode:async a=>String(a.address).toLowerCase()===A.toLowerCase()?'0x6002':base.getBytecode(a),
  getTransaction:async()=>sent,
  getTransactionReceipt:async()=>sent?{transactionHash:hash,from:terms.client,to:dep.factoryAddress,status:'success',blockNumber:10n,blockHash:H,transactionIndex:0,logs:logs()}:null,
  readContract:async a=>{
   const v=a as {address:string;functionName:string;args?:unknown[]};
   if(v.functionName==='terms')return [terms.schemaVersion,terms.client,terms.provider,terms.token,terms.amountPerPeriod,terms.periodSeconds,terms.noticeSeconds,terms.startAt,terms.clientNonce,terms.acceptanceDeadline,terms.termsDocumentHash];
   if(v.functionName==='accounting')return [terms.amountPerPeriod,0n,0n,0n,reserve(),false,0n,0,terms.amountPerPeriod+reserve()];
   if(v.functionName==='factory')return dep.factoryAddress;if(v.functionName==='registeredAgreement')return Boolean(sent);
   if(v.functionName==='perAgreementLiability'||v.functionName==='outstandingLiability')return sent?terms.amountPerPeriod+reserve():0n;
   if(v.functionName==='balanceOf'&&String(v.args?.[0]).toLowerCase()===A.toLowerCase())return terms.amountPerPeriod+reserve();
   if(v.functionName==='isNonceUnavailable')return Boolean(sent)&&String(v.args?.[1])===String(terms.clientNonce);
   if(v.functionName==='termsDigest')return computeTermsDigest(terms,dep);
   if(v.functionName==='allowance')return 100000000n;
   return base.readContract(a);
  }
 } as RuntimeReader);
 const runtime={...f.runtime,primary:{id:f.runtime.primary.id,reader:reader(f.runtime.primary.reader)},verification:{id:f.runtime.verification.id,reader:reader(f.runtime.verification.reader)}};
 return {...f,runtime,A,hash,send:(tx:Record<string,unknown>)=>{const call=decodeFunctionData({abi:FACTORY_ABI,data:tx.data as Hex});if(call.functionName!=='createAgreement')throw Error('Wrong fake send');terms=call.args[0] as TermsInput;sent={...tx,hash,chainId:5042002,nonce:Number(BigInt(String(tx.nonce))),input:tx.data,value:0n,blockNumber:10n,blockHash:H,transactionIndex:0};return hash;},omitTransfer:()=>{omitTransfer=true;},restoreTransfer:()=>{omitTransfer=false;},fingerprint:keccak256(toHex('synthetic creation'))};
}
