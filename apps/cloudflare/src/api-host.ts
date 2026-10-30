import {createHostedOperatorReader} from './rpc-binding';
import {assertEdgeClientKey} from './edge-client';
import '../../hosting-probe/static-router.mjs';
import type {ApiConfig} from '../../api/src/config';
import {handleAsNodeRequest} from 'cloudflare:node';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createPool} from '../../../packages/db/src/index';
import type pg from 'pg';
import {buildHostedApi} from './api-composition';
import {reviewedOperatorBundle} from './operator-bundle';
export function createApiHost(cfg:ApiConfig,reviewPin?:string,rpcEndpoint?:string){
const scope=new AsyncLocalStorage<Readonly<{pool:pg.Pool;clientKey:string}>>();
const current=()=>{const context=scope.getStore();if(!context)throw Error('REQUEST_CONTEXT_REQUIRED');return context;};
const requestPool={query:(...a:unknown[])=>Reflect.apply(current().pool.query,current().pool,a),connect:()=>current().pool.connect()} as unknown as pg.Pool;
let ready:Promise<number>|undefined;
return {async fetch(request:Request,clientKey:string){
 assertEdgeClientKey(clientKey);
 const db=cfg.db;
 ready??=(async()=>{const app=await buildHostedApi(cfg,requestPool,reviewedOperatorBundle,reviewPin,{reader:createHostedOperatorReader(rpcEndpoint),rateLimitKey:()=>current().clientKey});await app.ready();
 await new Promise<void>((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,()=>{app.server.off('error',reject);resolve();});});
 const address=app.server.address();if(!address||typeof address==='string')throw Error('TCP_BRIDGE_PORT_REQUIRED');return address.port;})();
 const port=await ready,pool=createPool(db);
 return scope.run(Object.freeze({pool,clientKey}),async()=>{try{const response=await handleAsNodeRequest(port,request);const body=await response.arrayBuffer();return new Response(response.status===204?null:body,{status:response.status,headers:response.headers});}finally{await pool.end();}});
}};
}
