import {createPublicClient,custom} from 'viem';
import type {RuntimeReader} from './configured-runtime.js';
export const ALCHEMY_MAINNET_ORIGIN='https://arc-mainnet.g.alchemy.com';
export type RpcEndpoints=Readonly<Record<string,string|undefined>>;
const fail=(code:string):never=>{throw new Error(code);};
function origin(value:string):string {
 try {const u=new URL(value);if(u.protocol!=='https:'||u.origin!==value||u.username||u.password)fail('RPC_ORIGIN_INVALID');return u.origin;}
 catch {return fail('RPC_ORIGIN_INVALID');}
}
/** Secrets are transport-only; public review/policy IDs remain bare origins. */
export function resolveRpcEndpoint(reviewedOrigin:string,endpoints:RpcEndpoints={}):string {
 origin(reviewedOrigin);
 const endpoint=endpoints[reviewedOrigin];
 if(endpoint===undefined){if(reviewedOrigin===ALCHEMY_MAINNET_ORIGIN)fail('RPC_SECRET_ENDPOINT_REQUIRED');return reviewedOrigin;}
 if(typeof endpoint!=='string'||endpoint.length>2048)fail('RPC_ENDPOINT_INVALID');
 let u:URL;try{u=new URL(endpoint);}catch{return fail('RPC_ENDPOINT_INVALID');}
 if(u.origin!==reviewedOrigin||u.protocol!=='https:'||u.username||u.password||u.search||u.hash)fail('RPC_ENDPOINT_ORIGIN_MISMATCH');
 if(reviewedOrigin!==ALCHEMY_MAINNET_ORIGIN||!u.pathname.startsWith('/v2/')||! /^[A-Za-z0-9_-]{10,256}$/.test(u.pathname.slice(4))||endpoint!==reviewedOrigin+u.pathname)fail('RPC_ENDPOINT_PATH_INVALID');
 return endpoint;
}
const methods=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getCode','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getLogs','eth_call','eth_getBalance','eth_getStorageAt','eth_getTransactionCount']);
export function createSecretRpcRequest(reviewedOrigin:string,endpoints:RpcEndpoints={},fetcher:typeof fetch=fetch){
 const endpoint=resolveRpcEndpoint(reviewedOrigin,endpoints);
 return async(args:{method:string;params?:unknown}):Promise<unknown>=>{
  if(!methods.has(args.method))return fail('RPC_READ_METHOD_REQUIRED');
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),10000);
  try {
   const response=await fetcher(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:args.method,params:args.params??[]}),redirect:'error',signal:abort.signal});
   if(!response.ok||response.redirected||!response.body)fail('RPC_TRANSPORT_FAILED');
   const body=response.body;if(!body)throw Error('RPC_TRANSPORT_FAILED');
   const reader=body.getReader(),chunks:Uint8Array[]=[];let size=0;
   try {for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>2097152)fail('RPC_TRANSPORT_FAILED');chunks.push(next.value);}}
   finally {await reader.cancel().catch(()=>undefined);reader.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   if(!result||result.jsonrpc!=='2.0'||result.id!==1||'error' in result||!Object.hasOwn(result,'result'))fail('RPC_TRANSPORT_FAILED');
   return result.result;
  } catch {return fail('RPC_TRANSPORT_FAILED');}
  finally {clearTimeout(timer);}
 };
}
export function createOperatorReaderFactory(endpoints:RpcEndpoints={},fetcher:typeof fetch=fetch){
 for(const key of Object.keys(endpoints)){if(key!==ALCHEMY_MAINNET_ORIGIN)fail('RPC_ENDPOINT_MAPPING_INVALID');if(endpoints[key]!==undefined)resolveRpcEndpoint(key,endpoints);}
 return (reviewedOrigin:string):RuntimeReader=>createPublicClient({transport:custom({request:createSecretRpcRequest(reviewedOrigin,endpoints,fetcher)},{retryCount:0})}) as unknown as RuntimeReader;
}
