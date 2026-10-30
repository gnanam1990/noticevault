export {NoticeVaultIndexer} from './indexer';
import {DurableObject} from 'cloudflare:workers';
import {createApiHost} from './api-host';
import {cloudConfig} from './config';
import {apiShard,forwardApiRequest} from './routing';
import {edgeClientKey,assertEdgeClientKey} from './edge-client';
import {releaseAssetResponse} from './release-headers';
type Namespace={idFromName(name:string):unknown;get(id:unknown):{handleApi(request:Request,clientKey:string):Promise<Response>}};
type Env=Record<string,string>&{API_HOST:Namespace;ASSETS:{fetch(request:Request):Promise<Response>};INDEXER:{idFromName(name:string):unknown;get(id:unknown):{arm():Promise<void>}}};
export class NoticeVaultApi extends DurableObject<Env>{
 private host:ReturnType<typeof createApiHost>|undefined;
 async fetch(_request:Request){return new Response('Trusted ingress required',{status:503});}
 async handleApi(request:Request,clientKey:string){
  try{assertEdgeClientKey(clientKey);}catch{return new Response('Client context unavailable',{status:503});}
  const cfg=cloudConfig(this.env);if(new URL(request.url).origin!==cfg.allowedOrigins[0])return new Response('Origin unavailable',{status:503});
  this.host??=createApiHost(cfg,this.env.NOTICEVAULT_OPERATOR_REVIEW_SHA256,this.env.ALCHEMY_MAINNET_RPC_URL);return this.host.fetch(request,clientKey);
 }
}
export default {async scheduled(_event:unknown,env:Env){if(env.INDEXER_ENABLED==='true')await env.INDEXER.get(env.INDEXER.idFromName('indexer-v1')).arm();},async fetch(request:Request,env:Env){
 const url=new URL(request.url);
 if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/v1/')){
  if(url.origin!==env.PUBLIC_ORIGIN)return new Response('Configuration unavailable',{status:503});
  let clientKey:string;try{clientKey=edgeClientKey(request);}catch{return new Response('Direct edge client context required',{status:403});}
  // Preserve request semantics; trusted client metadata travels only over the owned binding.
  const forwarded=forwardApiRequest(request,env.PUBLIC_ORIGIN);
  return env.API_HOST.get(env.API_HOST.idFromName('api-v1:'+apiShard(clientKey))).handleApi(forwarded,clientKey);
 }
 return releaseAssetResponse(await env.ASSETS.fetch(request));
}};
