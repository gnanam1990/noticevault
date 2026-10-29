/** Strict runtime boundary for agreement RPC reads; never issues trusted evidence. */
import type { MinimalPublicClient } from './snapshot.js';
const MAX=(1n<<256n)-1n;
const uint=(v:unknown):v is bigint=>typeof v==='bigint'&&v>=0n&&v<=MAX;
const address=(v:unknown)=>typeof v==='string'&&/^0x[0-9a-fA-F]{40}$/.test(v)&&BigInt(v)!==0n;
const hash=(v:unknown)=>typeof v==='string'&&/^0x[0-9a-fA-F]{64}$/.test(v);
const small=(v:unknown,max:number)=>typeof v==='number'&&Number.isInteger(v)&&v>=0&&v<=max;
function requireValue(ok:unknown,label:string):asserts ok {if(!ok)throw new Error('Malformed agreement RPC '+label);}
function validateRead(name:string,v:unknown):void {
 if(['registeredAgreement','creationPaused','isNonceUnavailable'].includes(name)){requireValue(typeof v==='boolean',name);return;}
 if(['factoryCap','agreementCap','outstandingLiability','balanceOf','allowance'].includes(name)){requireValue(uint(v),name);return;}
 if(name==='token'){requireValue(address(v),name);return;}
 if(name==='terms'){
  requireValue(Array.isArray(v)&&v.length===11,name);
  requireValue(small(v[0],255)&&[1,2,3].every(i=>address(v[i]))&&[4,5,6,7,8,9].every(i=>uint(v[i]))&&hash(v[10]),name+' fields');return;
 }
 if(name==='accounting'){
  requireValue(Array.isArray(v)&&v.length===9,name);
  requireValue([0,1,2,3,4,6,8].every(i=>uint(v[i]))&&typeof v[5]==='boolean'&&small(v[7],2),name+' fields');return;
 }
 if(name==='preview'){
  requireValue(v!==null&&typeof v==='object'&&!Array.isArray(v),name);const p=v as Record<string,unknown>;
  const keys=['observationTimestamp','R','D','S','E','V','W','RP','NP','providerClaimable','clientRefundable','L','noticeRemaining'];
  requireValue(keys.every(k=>uint(p[k]))&&small(p.phase,5)&&small(p.reason,2),name+' fields');
  const flag=p.hasStoredNotice_??p.hasStoredNotice;requireValue(typeof flag==='boolean',name+' notice');
  if('hasStoredNotice_' in p)requireValue(typeof p.hasStoredNotice_==='boolean',name+' notice_');
  if('hasStoredNotice' in p)requireValue(typeof p.hasStoredNotice==='boolean'&&p.hasStoredNotice===flag,name+' conflicting notice');
  return;
 }
 throw new Error('Unexpected agreement RPC read: '+name);
}
export function validatedAgreementRpc(rpc:MinimalPublicClient):MinimalPublicClient {
 return {
  getChainId:async()=>{const n=await rpc.getChainId();requireValue(typeof n==='number'&&Number.isSafeInteger(n)&&n>0,'chainId');return n;},
  getBlock:async(args:{blockTag:'latest'}|{blockNumber:bigint})=>{
   const b=await ('blockTag' in args?rpc.getBlock(args):rpc.getBlock(args));
   requireValue(b&&uint(b.number)&&uint(b.timestamp)&&hash(b.hash)&&BigInt(b.hash)!==0n,'block proof');
   return Object.freeze({number:b.number,hash:b.hash,timestamp:b.timestamp});
  },
  getBytecode:async args=>{const code=await rpc.getBytecode(args);requireValue(code===undefined||(typeof code==='string'&&/^0x(?:[0-9a-fA-F]{2})*$/.test(code)),'bytecode');return code;},
  readContract:async args=>{const value=await rpc.readContract(args);validateRead(args.functionName,value);return value;},
 };
}
