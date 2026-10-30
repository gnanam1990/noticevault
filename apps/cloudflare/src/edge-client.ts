import {isIP} from 'node:net';
/** Call only at top-level Cloudflare ingress; forwarded headers in Fastify are untrusted. */
function canonicalIp(value:unknown):string{
 if(typeof value!=='string'||value.length>45||value.includes('%'))throw Error('EDGE_IP_REQUIRED');
 const family=isIP(value);if(!family)throw Error('EDGE_IP_REQUIRED');
 return family===6?new URL('http://['+value+']/').hostname.slice(1,-1).toLowerCase():value;
}
export function assertEdgeClientKey(value:unknown):asserts value is string{
 if(typeof value!=='string'||!value.startsWith('edge-ip:')||value!=='edge-ip:'+canonicalIp(value.slice(8)))throw Error('EDGE_CLIENT_CONTEXT_REQUIRED');
}
export function edgeClientKey(request:Request):string{
 const cf=Reflect.get(request,'cf');
 // Same-zone Worker subrequests may rewrite connecting IP; accept direct clients only.
 if(!cf||typeof cf!=='object'||Array.isArray(cf)||request.headers.has('cf-worker'))throw Error('DIRECT_EDGE_REQUEST_REQUIRED');
 return 'edge-ip:'+canonicalIp(request.headers.get('cf-connecting-ip'));
}
