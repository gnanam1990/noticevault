/** Canonical pinned auth verification. No signing, endpoints or fallback after unknown code. */
import {hashMessage,verifyMessage} from 'viem';
import type {MinimalPublicClient} from '@noticevault/sdk';
import type {SignatureVerifier,VerifyOk,VerifyResult} from './verify.js';
export interface SyntheticAuthProvider {readonly chainId:bigint;readonly rpc:MinimalPublicClient;}
type Proof={message:string;signature:`0x${string}`;address:`0x${string}`;block:{number:bigint;hash:string;timestamp:bigint};code:string;observedAt:number;};
const abi=[{type:'function',name:'isValidSignature',inputs:[{name:'hash',type:'bytes32'},{name:'signature',type:'bytes'}],outputs:[{name:'magicValue',type:'bytes4'}],stateMutability:'view'}] as const;
const hex=/^0x(?:[0-9a-fA-F]{2})*$/,address=/^0x[0-9a-fA-F]{40}$/,hash=/^0x[0-9a-fA-F]{64}$/;
/** Trusted injected transport must provide chain state; this is not a light client. */
export function buildPinnedAuthVerifier(provider:SyntheticAuthProvider):SignatureVerifier {
 const chainId=provider.chainId,rpc=provider.rpc;
 if(typeof chainId!=='bigint'||chainId<=0n||chainId>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Invalid pinned auth chain');
 const issued=new WeakMap<VerifyOk,Proof>();
 const sameChain=async()=>{const id=await rpc.getChainId();return Number.isSafeInteger(id)&&id>0&&BigInt(id)===chainId;};
 const fresh=(p:Proof)=>{const now=Date.now();return Number.isSafeInteger(now)&&now>=0&&p.observedAt<=now+5000&&now-p.observedAt<=60000&&p.block.timestamp>=BigInt(Math.floor(now/1000))-7200n&&p.block.timestamp<=BigInt(Math.floor(now/1000))+30n;};
 async function canonical(p:Proof){
  if(!fresh(p)||!await sameChain())return false;const b=await rpc.getBlock({blockNumber:p.block.number});
  if(!b||b.number!==p.block.number||b.timestamp!==p.block.timestamp||typeof b.hash!=='string'||!hash.test(b.hash)||b.hash.toLowerCase()!==p.block.hash.toLowerCase())return false;
  const code=await rpc.getBytecode({address:p.address,blockNumber:p.block.number});
  return typeof code==='string'&&hex.test(code)&&code.toLowerCase()===p.code.toLowerCase()&&await sameChain()&&fresh(p);
 }
 async function signatureValid(p:Proof){
  if(p.code==='0x')return verifyMessage({message:p.message,signature:p.signature,address:p.address});
  const value=await rpc.readContract({address:p.address,abi,functionName:'isValidSignature',args:[hashMessage(p.message),p.signature],blockNumber:p.block.number});
  return typeof value==='string'&&/^0x[0-9a-fA-F]{8}$/.test(value)&&value.toLowerCase()==='0x1626ba7e';
 }
 return {
  async verify(message,signature,expected,requestedChain):Promise<VerifyResult>{
   const fail=()=>({ok:false as const,reason:'UNKNOWN_OR_INVALID: pinned account/signature evidence unavailable'});
   try{
    if(requestedChain!==chainId||!address.test(expected)||BigInt(expected)===0n||!hex.test(signature)||signature==='0x'||!await sameChain())return fail();
    const b=await rpc.getBlock({blockTag:'latest'});
    if(!b||typeof b.number!=='bigint'||b.number<0n||typeof b.timestamp!=='bigint'||b.timestamp<0n||typeof b.hash!=='string'||!hash.test(b.hash)||BigInt(b.hash)===0n)return fail();
    const addr=expected.toLowerCase() as `0x${string}`;const code=await rpc.getBytecode({address:addr,blockNumber:b.number});
    if(typeof code!=='string'||!hex.test(code))return fail();
    const proof:Proof={message,signature:signature as `0x${string}`,address:addr,block:{number:b.number,hash:b.hash,timestamp:b.timestamp},code,observedAt:Date.now()};
    if(!fresh(proof)||!await signatureValid(proof)||!await canonical(proof))return fail();
    const result:VerifyOk=Object.freeze({ok:true,method:code==='0x'?'ecdsa':'erc1271',recoveredAddress:addr});issued.set(result,proof);return result;
   }catch{return fail();}
  },
  async revalidate(result){
   const proof=issued.get(result);if(!proof)return false;
   try{return await canonical(proof)&&await signatureValid(proof)&&await canonical(proof);}catch{return false;}
  },
 };
}
