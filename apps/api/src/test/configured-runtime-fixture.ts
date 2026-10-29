import {createHash} from 'node:crypto';
import {keccak256} from 'viem';
import type {RuntimeInputs,RuntimeReader} from '../configured-runtime.js';
import {deploymentRecordFixture} from './deployment-record-fixture.js';
export function configuredFixture(){
 const f=deploymentRecordFixture(),factoryCode='0x6001' as const,tokenCode='0x6002' as const,H='0x'+'44'.repeat(32),bytes=new TextEncoder().encode('synthetic artifact bytes');
 f.descriptor.expectedFactoryCodeHash=keccak256(factoryCode);f.descriptor.expectedTokenCodeHash=keccak256(tokenCode);f.record.factory.runtimeCodeHash=f.descriptor.expectedFactoryCodeHash;f.record.token.verificationEvidence.runtimeCodeHash=f.descriptor.expectedTokenCodeHash;
 for(const e of f.record.evidence)e.sha256='0x'+createHash('sha256').update(bytes).digest('hex');
 let wrongChain=false,wrongCode=false,disagreement=false;let calls=0;
 function reader(secondary:boolean){return {getChainId:async()=>wrongChain?1:5042002,getBlockNumber:async()=>10n,getBlock:async()=>({number:10n,hash:(secondary&&disagreement?'0x'+'55'.repeat(32):H),parentHash:'0x'+'33'.repeat(32),timestamp:BigInt(Math.floor(Date.now()/1000)),transactions:[]}),getBytecode:async({address}:{address:string})=>{calls++;return wrongCode?'0x6003':address.toLowerCase()===f.descriptor.factoryAddress?factoryCode:address.toLowerCase()===f.descriptor.allowlistedToken?tokenCode:'0x';},readContract:async({functionName}:{functionName:string})=>functionName==='token'?f.descriptor.allowlistedToken:functionName==='decimals'?6:0n,getTransaction:async()=>null,getTransactionReceipt:async()=>null} as unknown as RuntimeReader;}
 const input:RuntimeInputs={manifestText:JSON.stringify(f.descriptor),recordText:JSON.stringify(f.record),provenance:'SYNTHETIC',finality:{network:'ARC_TESTNET',chainId:5042002n,kind:'COMMITTED_INCLUSION',verification:'TWO_PROVIDERS'},primary:{id:'primary',reader:reader(false)},verification:{id:'verification',reader:reader(true)},readArtifact:async()=>bytes,readWallet:async()=>({account:'0x'+'66'.repeat(20),chainId:5042002n}),windowSize:2};
 return {input,f,bytes,setWrongChain:()=>{wrongChain=true;},setWrongCode:()=>{wrongCode=true;},setDisagreement:()=>{disagreement=true;},calls:()=>calls};
}
