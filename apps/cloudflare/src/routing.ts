import {assertEdgeClientKey} from './edge-client';
/** Routing only. PG session/membership checks remain authoritative; no response cache. */
export function apiShard(key:string){
 assertEdgeClientKey(key);
 let hash=2166136261;for(let i=0;i<key.length;i++)hash=Math.imul(hash^key.charCodeAt(i),16777619);
 return (hash>>>0)%4;
}
export function forwardApiRequest(request:Request,origin:string){
 const url=new URL(request.url);if(url.origin!==origin)throw Error('EXACT_REQUEST_ORIGIN_REQUIRED');
 if(url.pathname.startsWith('/api/'))url.pathname=url.pathname.slice(4);
 else if(!url.pathname.startsWith('/v1/'))throw Error('API_PATH_REQUIRED');
 return new Request(url,request);
}
