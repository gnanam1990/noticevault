import {isDeepStrictEqual} from 'node:util';
import type {Rpc} from './rpc-transport.js';
const methods=new Set(['eth_chainId','eth_getBlockByNumber','eth_getTransactionReceipt','eth_getLogs','eth_getCode','eth_call']);
export function httpRpc(url:string,timeoutMs:number,fetcher:typeof fetch=fetch):Rpc{
 let sequence=0;
 return {async request(method,params,signal){
  if(!methods.has(method))throw Error('WORKER_READ_ONLY_METHOD');
  const stop=new AbortController(),abort=()=>stop.abort();if(signal?.aborted)stop.abort();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,timeoutMs),id=++sequence;
  try{const response=await fetcher(url,{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:stop.signal});
   if(!response.ok||!response.body)throw Error('WORKER_RPC_HTTP');const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4194304)throw Error('WORKER_RPC_RESPONSE_LIMIT');chunks.push(part.value);}}finally{await reader.cancel();}
   const data=JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string,unknown>;
   if(data.jsonrpc!=='2.0'||data.id!==id||('result' in data)===('error' in data))throw Error('WORKER_RPC_ENVELOPE');
   if(data.error){const code=(data.error as {code?:unknown}).code;throw Object.assign(Error('WORKER_RPC_REJECTED'),{code:typeof code==='number'?code:undefined});}return data.result;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }};
}
function comparable(method:string,value:unknown){if(method==='eth_getBlockByNumber'&&value&&typeof value==='object'){const v=value as Record<string,unknown>;return {number:v.number,hash:v.hash,parentHash:v.parentHash,timestamp:v.timestamp,transactions:v.transactions};}return value;}
export function pairedRpc(primary:Rpc,verification:Rpc):Rpc{return {async request(method,params,signal){
 const [a,b]=await Promise.all([primary.request(method,params,signal),verification.request(method,params,signal)]);
 if(!isDeepStrictEqual(comparable(method,a),comparable(method,b)))throw Error('WORKER_PROVIDER_DISAGREEMENT');return a;
}};}
