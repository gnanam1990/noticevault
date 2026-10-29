import {createHostedOperatorReader} from './rpc-binding';
import '../../hosting-probe/static-router.mjs';
import type {ApiConfig} from '../../api/src/config';
import {handleAsNodeRequest} from 'cloudflare:node';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createPool} from '../../../packages/db/src/index';
import type pg from 'pg';
import {buildHostedApi} from './api-composition';
import {reviewedOperatorBundle} from './operator-bundle';
export function createApiHost(cfg:ApiConfig,reviewPin?:string,rpcEndpoint?:string){
const scope=new AsyncLocalStorage<pg.Pool>();
const current=()=>{const p=scope.getStore();if(!p)throw Error('REQUEST_POOL_REQUIRED');return p;};
const requestPool={query:(...a:unknown[])=>Reflect.apply(current().query,current(),a),connect:()=>current().connect()} as unknown as pg.Pool;
let ready:Promise<number>|undefined;
return {async fetch(request:Request){
 const db=cfg.db;
 ready??=(async()=>{const app=await buildHostedApi(cfg,requestPool,reviewedOperatorBundle,reviewPin,{reader:createHostedOperatorReader(rpcEndpoint)});await app.ready();
 await new Promise<void>((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,()=>{app.server.off('error',reject);resolve();});});
 const address=app.server.address();if(!address||typeof address==='string')throw Error('TCP_BRIDGE_PORT_REQUIRED');return address.port;})();
 const port=await ready,pool=createPool(db);
 return scope.run(pool,async()=>{try{const response=await handleAsNodeRequest(port,request);const body=await response.arrayBuffer();return new Response(response.status===204?null:body,{status:response.status,headers:response.headers});}finally{await pool.end();}});
}};
}
