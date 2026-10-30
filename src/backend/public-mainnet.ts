import {decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, type Hex} from 'viem';
import {ARC_MAINNET_DEPLOYMENT} from '../../packages/sdk/src/deployments';

/** Public, unauthenticated reads only. Never an execution or approval source. */
export const MAINNET_RPC = 'https://rpc.blockdaemon.mainnet.arc.io';
export const FACTORY = ARC_MAINNET_DEPLOYMENT.factoryAddress as Hex;
const TOKEN = ARC_MAINNET_DEPLOYMENT.allowlistedToken as Hex;
const abi = parseAbi(['function guardian() view returns (address)', 'function token() view returns (address)', 'function factoryCap() view returns (uint256)', 'function agreementCap() view returns (uint256)', 'function outstandingLiability() view returns (uint256)', 'function creationPaused() view returns (bool)', 'function decimals() view returns (uint8)']);
export type MainnetSnapshot = {blockNumber:string;blockHash:string;blockTime:number;checkedAt:number;guardian:string;factoryCap:bigint;agreementCap:bigint;outstandingLiability:bigint;creationPaused:boolean};
export const snapshotIsFresh = (snapshot:MainnetSnapshot, now=Date.now()) => now-snapshot.checkedAt<=120_000 && now-snapshot.blockTime<=120_000 && snapshot.blockTime-now<=30_000;
function hex(value:unknown):Hex {if(typeof value!=='string'||!/^0x[0-9a-fA-F]+$/.test(value))throw Error('Invalid chain response.');return value as Hex;}
function block(value:unknown){if(!value||typeof value!=='object')throw Error('Block unavailable.');const b=value as Record<string,unknown>;const hash=hex(b.hash);if(hash.length!==66)throw Error('Invalid block hash.');return {number:hex(b.number),hash,time:Number(BigInt(hex(b.timestamp)))*1000};}

export async function readPublicMainnet(signal?:AbortSignal, fetcher:typeof fetch=fetch, now=()=>Date.now()):Promise<MainnetSnapshot>{
 const controller=new AbortController(), abort=()=>controller.abort();
 if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,20_000);let id=0;
 async function rpc(method:string,params:unknown[]){
  const requestId=++id;
  const response=await fetcher(MAINNET_RPC,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params}),signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error'});
  if(!response.ok)throw Error('Public mainnet RPC unavailable.');
  const body=await response.json();if(body?.jsonrpc!=='2.0'||body.id!==requestId||body.error||!('result' in body))throw Error('Public mainnet RPC returned an invalid response.');return body.result as unknown;
 }
 try{
  if(BigInt(hex(await rpc('eth_chainId',[])))!==5042n)throw Error('RPC returned the wrong chain.');
  const at=block(await rpc('eth_getBlockByNumber',['latest',false]));
  const read=async(functionName:'guardian'|'token'|'factoryCap'|'agreementCap'|'outstandingLiability'|'creationPaused'|'decimals',to=FACTORY)=>decodeFunctionResult({abi,functionName,data:hex(await rpc('eth_call',[{to,data:encodeFunctionData({abi,functionName})},at.number]))});
  const [factoryCode,tokenCode,guardian,token,factoryCap,agreementCap,outstandingLiability,creationPaused,decimals]=await Promise.all([
   rpc('eth_getCode',[FACTORY,at.number]),rpc('eth_getCode',[TOKEN,at.number]),read('guardian'),read('token'),read('factoryCap'),read('agreementCap'),read('outstandingLiability'),read('creationPaused'),read('decimals',TOKEN),
  ]);
  if(keccak256(hex(factoryCode))!==ARC_MAINNET_DEPLOYMENT.expectedFactoryCodeHash||keccak256(hex(tokenCode))!==ARC_MAINNET_DEPLOYMENT.expectedTokenCodeHash)throw Error('Contract code does not match the verified deployment.');
  if(String(token).toLowerCase()!==TOKEN.toLowerCase()||String(guardian).toLowerCase()!=='0xff525d6940ad0e308ed6eda443c792694353f9da'||decimals!==6)throw Error('Contract identity does not match the verified deployment.');
  const confirmed=block(await rpc('eth_getBlockByNumber',[at.number,false]));
  if(confirmed.hash!==at.hash||confirmed.number!==at.number||confirmed.time!==at.time)throw Error('Chain changed during this read. Refresh the snapshot.');
  const snapshot:MainnetSnapshot={blockNumber:String(BigInt(at.number)),blockHash:at.hash,blockTime:at.time,checkedAt:now(),guardian:String(guardian),factoryCap:factoryCap as bigint,agreementCap:agreementCap as bigint,outstandingLiability:outstandingLiability as bigint,creationPaused:creationPaused as boolean};
  if(!snapshotIsFresh(snapshot,now()))throw Error('RPC returned an outdated block. Refresh later.');
  return snapshot;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
