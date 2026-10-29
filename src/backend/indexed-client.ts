import {ReviewError,type Fetcher} from './draft-review.js';
import type {CreationProof} from './association-client.js';
export type IndexedEntry={workspaceId:string;streamId:string;agreement:string}&({status:'UNAVAILABLE';reason:string}|{status:'CANONICAL';source:'SYNTHETIC'|'RPC_OBSERVED';liveFreshness:'UNKNOWN';indexedHead:string;indexedHeadHash:string;policyHash:string});
export type Financial={amountPerPeriod:string;periodSeconds:string;noticeSeconds:string;startAt:string;noticeReserve:string;initialFunded:string;regularFunded:string;fundedThrough:string;regularPaid:string;noticePaid:string;clientRefunded:string;lastClaimObservedAt:string|null;notice:null|{start:string;end:string;reason:'1'|'2'}};
export type IndexedDetail=IndexedEntry&{financial?:Financial;provenance?:CreationProof};
export type IndexedPage={workspaceId:string;chainId:string;source:'SYNTHETIC'|'RPC_OBSERVED'|'MIXED';liveFreshness:'UNKNOWN';items:IndexedEntry[];nextCursor:string|null};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,address=/^0x[0-9a-f]{40}$/i,hash=/^0x[0-9a-f]{64}$/i,digest=/^[0-9a-f]{64}$/;
function shape(ok:unknown):asserts ok{if(!ok)throw new ReviewError(502);}
function uint(v:unknown):v is string{return typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&v.length<=78&&BigInt(v)<2n**256n;}
function obj(v:unknown):Record<string,unknown>{shape(v&&typeof v==='object'&&!Array.isArray(v));return v as Record<string,unknown>;}
function entry(v:unknown,ws:string):IndexedEntry{const a=obj(v);shape(a.workspaceId===ws&&typeof a.streamId==='string'&&a.streamId.length>0&&a.streamId.length<=128&&typeof a.agreement==='string'&&address.test(a.agreement));
 if(a.status==='UNAVAILABLE'){shape(typeof a.reason==='string'&&Object.keys(a).every(k=>['workspaceId','streamId','agreement','status','reason'].includes(k)));}
 else{shape(a.status==='CANONICAL'&&['SYNTHETIC','RPC_OBSERVED'].includes(a.source as string)&&a.liveFreshness==='UNKNOWN'&&uint(a.indexedHead)&&typeof a.indexedHeadHash==='string'&&hash.test(a.indexedHeadHash)&&typeof a.policyHash==='string'&&digest.test(a.policyHash));}
 return a as IndexedEntry;
}
export class IndexedClient{
 constructor(private fetcher:Fetcher=(u,i)=>fetch(u,i)){}
 private async get(path:string,signal?:AbortSignal):Promise<unknown>{let r:Response;try{r=await this.fetcher('/api'+path,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json','X-Requested-With':'XMLHttpRequest'},signal});}catch(e){if(signal?.aborted)throw e;throw new ReviewError(0);}if(!r.ok)throw new ReviewError(r.status);shape(r.headers.get('content-type')?.includes('application/json'));try{return await r.json();}catch{throw new ReviewError(502);}}
 async list(ws:string,chain:string,after:string|null=null,signal?:AbortSignal):Promise<IndexedPage>{if(!uuid.test(ws))throw new ReviewError(400);ws=ws.toLowerCase();const p=obj(await this.get('/workspaces/'+ws+'/indexed-agreements'+(after?'?after='+encodeURIComponent(after):''),signal));shape(p.workspaceId===ws&&p.chainId===chain&&['SYNTHETIC','RPC_OBSERVED','MIXED'].includes(p.source as string)&&p.liveFreshness==='UNKNOWN'&&Array.isArray(p.items)&&p.items.length<=20&&(p.nextCursor===null||(typeof p.nextCursor==='string'&&/^[A-Za-z0-9_-]{1,1024}$/.test(p.nextCursor))));const items=p.items.map(v=>entry(v,ws));shape(new Set(items.map(v=>v.streamId+':'+v.agreement)).size===items.length);return {...p,items} as IndexedPage;}
 async detail(ws:string,chain:string,stream:string,agreement:string,signal?:AbortSignal):Promise<IndexedDetail>{if(!uuid.test(ws)||!address.test(agreement)||!stream||stream.length>128)throw new ReviewError(400);ws=ws.toLowerCase();agreement=agreement.toLowerCase();const raw=obj(await this.get('/workspaces/'+ws+'/indexed-agreements/'+encodeURIComponent(stream)+'/'+agreement,signal)),a=entry(raw,ws);shape(a.streamId===stream&&a.agreement===agreement);if(a.status==='UNAVAILABLE')return a;
 const p=obj(raw.provenance),f=obj(raw.financial);shape(p.streamId===stream&&p.agreement===agreement&&p.chainId===chain&&p.source===a.source&&['SYNTHETIC','RPC_OBSERVED'].includes(p.source as string)&&p.liveFreshness==='UNKNOWN'&&p.policyHash===a.policyHash&&p.indexedHead===a.indexedHead&&p.indexedHeadHash===a.indexedHeadHash);
 for(const k of ['factory','token','client','provider'])shape(typeof p[k]==='string'&&address.test(p[k]));
 for(const k of ['creationBlockHash','transactionHash'])shape(typeof p[k]==='string'&&hash.test(p[k]));
 for(const k of ['bindingHash','termsHash','fingerprint'])shape(typeof p[k]==='string'&&digest.test(p[k]));
 shape(uint(p.creationBlock)&&uint(p.logIndex)&&BigInt(p.creationBlock)<=BigInt(a.indexedHead));
 for(const k of ['amountPerPeriod','periodSeconds','noticeSeconds','startAt','noticeReserve','initialFunded','regularFunded','fundedThrough','regularPaid','noticePaid','clientRefunded'])shape(uint(f[k]));
 shape(f.lastClaimObservedAt===null||uint(f.lastClaimObservedAt));if(f.notice!==null){const n=obj(f.notice);shape(uint(n.start)&&uint(n.end)&&BigInt(n.end)>=BigInt(n.start)&&(n.reason==='1'||n.reason==='2'));}
 return {...a,financial:f as Financial,provenance:p as CreationProof};
 }
}
/** Only the latest request may update the mounted view, including late errors. */
export class LatestIndexedRead{
 private generation=0;private abort?:AbortController;
 cancel(){this.generation++;this.abort?.abort();}
 async run<T>(load:(signal:AbortSignal)=>Promise<T>,publish:(value:T)=>void,fail:(error:unknown)=>void){this.cancel();const id=this.generation,controller=new AbortController();this.abort=controller;try{const value=await load(controller.signal);if(this.generation===id&&!controller.signal.aborted)publish(value);}catch(error){if(this.generation===id&&!controller.signal.aborted)fail(error);}}
}
