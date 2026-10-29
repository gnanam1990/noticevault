// SYNTHETIC ONLY: all RPC and wallet requests terminate in this fixture.
import {vi} from 'vitest';
import {decodeFunctionData,encodeFunctionResult,encodeEventTopics,encodeAbiParameters,parseAbiParameters,erc20Abi,toHex,type Hex,type Abi} from 'viem';
import {AGREEMENT_ABI,FACTORY_ABI,computeTermsDigest,buildSimulationSnapshot} from '../../../packages/sdk/src/index';
import {agreementFixture} from './fixture';
import {stringify} from './recovery';
import {artifactFixture} from './artifact-verifier.fixture';
import {createReviewedArtifactVerifier} from './artifact-verifier';
import {composeRecoveryClaims} from './composition';
import {browserClaimJournal,JOURNAL_KEY,type ClaimEntry} from './journal';
import type {Eip1193} from './wallet';
export function syntheticComposition() {
  const f=agreementFixture(), artifact=artifactFixture();
  const agreement='0x6666666666666666666666666666666666666666' as Hex;
  const hash=('0x'+'ab'.repeat(32)) as Hex, beforeHash=('0x'+'aa'.repeat(32)) as Hex, afterHash=('0x'+'bb'.repeat(32)) as Hex;
  const amount=f.terms.amountPerPeriod*1800n/f.terms.periodSeconds;
  const state={mined:false,mode:'ok' as 'ok'|'reject'|'interrupt'|'defer',account:f.terms.provider,
    chainId:5042002n,nonce:0n,nonceMismatch:false,wrongRecipient:false,providerMismatch:false,
    beforeNonce:undefined as undefined|(()=>void),beforeWallet:undefined as undefined|(()=>void),deferred:undefined as undefined|(()=>void),writeFails:false};
  const storageMap=new Map<string,string>();
  const storage={getItem:(key:string)=>storageMap.get(key)??null,setItem:(key:string,value:string)=>{if(state.writeFails)throw Error('SYNTHETIC_QUOTA');storageMap.set(key,value);},
    key:(index:number)=>[...storageMap.keys()][index]??null,get length(){return storageMap.size;}};
  let queue=Promise.resolve();
  const locks={request:async<T>(_name:string,callback:()=>Promise<T>):Promise<T>=>{
    const prior=queue; let release!:()=>void; queue=new Promise<void>(resolve=>{release=resolve;});
    await prior; try{return await callback();}finally{release();}
  }};
  const entries=()=>JSON.parse(storage.getItem(JOURNAL_KEY)??'{"entries":[]}').entries as ClaimEntry[];
  const sent:Array<Record<string,string>>=[];
  const listeners=new Map<string,Set<()=>void>>();
  const walletCalls:string[]=[];
  const provider:Eip1193={request:async({method,params})=>{
    walletCalls.push(method);
    if(method==='eth_requestAccounts'||method==='eth_accounts')return [state.account];
    if(method==='eth_chainId')return toHex(state.chainId);
    if(method!=='eth_sendTransaction')throw Error('UNEXPECTED_WALLET_METHOD:'+method);
    state.beforeWallet?.();
    if(entries().at(-1)?.state!=='unknown')throw Error('JOURNAL_NOT_DURABLE_BEFORE_SEND');
    sent.push((params as Array<Record<string,string>>)[0]!);
    if(state.mode==='reject')throw Object.assign(Error('synthetic user rejection'),{code:4001});
    if(state.mode==='interrupt')throw Error('synthetic connection lost after send');
    if(state.mode==='defer')await new Promise<void>(resolve=>{state.deferred=resolve;});
    state.mined=true; return hash;
  },on:(event,fn)=>{if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event)!.add(fn);},
    removeListener:(event,fn)=>{listeners.get(event)?.delete(fn);}};
  const emit=(event:string)=>{for(const fn of listeners.get(event)??[])fn();};
  const rpcCalls:Array<{origin:string;method:string;params:unknown[]}>=[];
  const rawBlock=(number:bigint)=>({number:toHex(number),hash:number===124n?afterHash:beforeHash,
    parentHash:beforeHash,timestamp:toHex(f.now),transactions:number===124n&&state.mined?[hash]:[],
    gasLimit:'0xffffff',gasUsed:'0x1',baseFeePerGas:'0x1',difficulty:'0x0',totalDifficulty:'0x0',
    size:'0x1',nonce:'0x0000000000000000',miner:f.terms.client,extraData:'0x',
    logsBloom:'0x'+'0'.repeat(512),receiptsRoot:beforeHash,stateRoot:beforeHash,transactionsRoot:beforeHash,sha3Uncles:beforeHash,uncles:[]});
  function log(address:Hex,abi:Abi,eventName:string,args:Record<string,unknown>|undefined,params:string,values:readonly unknown[],index:number) {
    return {address,topics:encodeEventTopics({abi,eventName,args} as never),data:encodeAbiParameters(parseAbiParameters(params),values as never),
      blockNumber:'0x7c',blockHash:afterHash,transactionHash:hash,transactionIndex:'0x0',logIndex:toHex(index),removed:false};
  }
  function receipt(){
    return {transactionHash:hash,transactionIndex:'0x0',blockNumber:'0x7c',blockHash:afterHash,
      from:sent.at(-1)?.from??state.account,to:agreement,gasUsed:'0x1',cumulativeGasUsed:'0x1',effectiveGasPrice:'0x1',
      status:'0x1',type:'0x0',contractAddress:null,logsBloom:'0x'+'0'.repeat(512),logs:[
        log(f.dep.factoryAddress as Hex,FACTORY_ABI,'CapacityChanged',{agreement},'int256,uint256,uint256',[-amount,6000000n-amount,6000000n-amount],0),
        log(f.dep.allowlistedToken as Hex,erc20Abi,'Transfer',{from:agreement,to:state.wrongRecipient?f.terms.client:f.terms.provider},'uint256',[amount],1),
        log(agreement,AGREEMENT_ABI,'ProviderClaimed',undefined,'uint256,uint256,uint256',[amount,0n,amount],2),
      ]};
  }
  async function contractCall(call:{to:Hex;data:Hex},blockTag:string){
    const address=call.to.toLowerCase();
    const abi=address===f.dep.factoryAddress?FACTORY_ABI:address===f.dep.allowlistedToken?erc20Abi:AGREEMENT_ABI;
    const decoded=decodeFunctionData({abi,data:call.data});
    const blockNumber=blockTag==='latest'?(state.mined?124n:123n):BigInt(blockTag);
    const paid=blockNumber>=124n&&state.mined?amount:0n, liability=6000000n-paid;
    const name=decoded.functionName; let result:unknown;
    if(name==='factory')result=f.dep.factoryAddress;
    else if(name==='termsDigest')result=computeTermsDigest(f.terms,f.dep);
    else if(name==='accounting')result=[3000000n,paid,0n,0n,3000000n,false,0n,0,liability];
    else if(name==='balanceOf'||name==='perAgreementLiability'||name==='outstandingLiability')result=liability;
    else if(name==='preview'){
      const snap=buildSimulationSnapshot({terms:f.terms,regularFunded:3000000n,regularPaid:paid,noticePaid:0n,clientRefunded:0n,noticeStartStored:null,noticeReasonStored:null},f.now);
      result={...snap,phase:1,S:0n,E:0n,reason:0,hasStoredNotice_:false};
    } else result=await f.rpc.readContract({address:call.to,abi,functionName:name,args:decoded.args,blockNumber} as never);
    return encodeFunctionResult({abi,functionName:name,result} as never);
  }
  const fetchMock=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    const origin=new URL(url).origin;
    if(![artifact.config.primaryRpcOrigin,artifact.config.verificationRpcOrigin].includes(origin))throw Error('REAL_NETWORK_FORBIDDEN');
    const body=typeof init?.body==='string'?init.body:input instanceof Request?await input.text():'';
    const request=JSON.parse(body) as {id:number;method:string;params:unknown[]};
    const {method,params=[]}=request; rpcCalls.push({origin,method,params});
    let result:unknown;
    if(method==='eth_chainId')result=toHex(5042002n);
    else if(method==='eth_getTransactionCount'){state.beforeNonce?.();result=toHex(state.nonce+(state.nonceMismatch&&origin===artifact.config.verificationRpcOrigin?1n:0n));}
    else if(method==='eth_getBlockByNumber'){
      const tag=params[0] as string; result=rawBlock(tag==='latest'?(state.mined?124n:123n):BigInt(tag));
    } else if(method==='eth_getCode'){
      const address=(params[0] as string).toLowerCase();
      result=address===f.dep.factoryAddress?'0x60006000':address===f.dep.allowlistedToken?'0x60016001':address===agreement?'0x6002':'0x';
      if(state.providerMismatch&&origin===artifact.config.verificationRpcOrigin)result='0x6009';
    } else if(method==='eth_call')result=await contractCall(params[0] as {to:Hex;data:Hex},params[1] as string);
    else if(method==='eth_getTransactionByHash'){
      const tx=sent.at(-1); result=state.mined&&tx?{hash,chainId:toHex(5042002n),from:tx.from,to:tx.to,
        nonce:tx.nonce,input:tx.data,value:'0x0',blockNumber:'0x7c',blockHash:afterHash,transactionIndex:'0x0',
        gas:'0x100000',gasPrice:'0x1',type:'0x0',v:'0x1b',r:'0x1',s:'0x1'}:null;
    } else if(method==='eth_getTransactionReceipt')result=state.mined?receipt():null;
    else throw Error('UNEXPECTED_RPC_METHOD:'+method);
    return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}),{status:200,headers:{'Content-Type':'application/json'}});
  });
  const verifier=createReviewedArtifactVerifier(artifact.bundle,artifact.anchor);
  const makeController=()=>composeRecoveryClaims(artifact.config,artifact.finality,provider,browserClaimJournal(storage,locks),verifier);
  return {state,storageMap,entries,sent,walletCalls,rpcCalls,fetchMock,makeController,emit,agreement,hash,amount,artifact,f,manifest:stringify(artifact.config.deployment)};
}
