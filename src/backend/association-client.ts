import {ReviewError} from './draft-review.js';
export const ASSOCIATION_AUDIENCE='current-and-future-workspace-members';
export type CreationProof={streamId:string;agreement:string;source:'SYNTHETIC'|'RPC_OBSERVED';chainId:string;factory:string;token:string;policyHash:string;bindingHash:string;creationBlock:string;creationBlockHash:string;transactionHash:string;logIndex:string;client:string;provider:string;termsHash:string;fingerprint:string;indexedHead:string|null;indexedHeadHash:string|null;liveFreshness:'UNKNOWN'};
export type Association=CreationProof&{workspaceId:string;audience:typeof ASSOCIATION_AUDIENCE;associatedBy:string;createdAt:string;status:'CANONICAL'|'UNAVAILABLE';reason?:string|null};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,address=/^0x[0-9a-f]{40}$/i,hash=/^0x[0-9a-f]{64}$/i,digest=/^[0-9a-f]{64}$/,uint=/^(0|[1-9][0-9]*)$/;
function requireShape(ok:boolean):asserts ok {if(!ok)throw new ReviewError(502);}
function target(ws:string,stream:string,agreement:string){if(!uuid.test(ws)||!stream.length||stream.length>128||!address.test(agreement))throw new Error('Enter a valid workspace, stream and agreement address.');return {ws:ws.toLowerCase(),stream,agreement:agreement.toLowerCase()};}
function proof(value:unknown,stream:string,agreement:string):CreationProof{
 requireShape(!!value&&typeof value==='object');const v=value as Record<string,unknown>;requireShape(v.streamId===stream&&v.agreement===agreement&&['SYNTHETIC','RPC_OBSERVED'].includes(v.source as string)&&v.liveFreshness==='UNKNOWN');
 for(const k of ['factory','token','client','provider'])requireShape(typeof v[k]==='string'&&address.test(v[k]));
 for(const k of ['creationBlockHash','transactionHash'])requireShape(typeof v[k]==='string'&&hash.test(v[k]));
 for(const k of ['policyHash','bindingHash','termsHash','fingerprint'])requireShape(typeof v[k]==='string'&&digest.test(v[k]));
 for(const k of ['chainId','creationBlock','logIndex'])requireShape(typeof v[k]==='string'&&uint.test(v[k]));
 requireShape(v.indexedHead===null||(typeof v.indexedHead==='string'&&uint.test(v.indexedHead)));requireShape(v.indexedHeadHash===null||(typeof v.indexedHeadHash==='string'&&hash.test(v.indexedHeadHash)));return v as CreationProof;
}
export class AssociationClient{
 constructor(private fetcher:(input:string,init?:RequestInit)=>Promise<Response>=fetch){}
 private async request(path:string,signal?:AbortSignal,body?:unknown):Promise<unknown>{
  let r:Response;try{r=await this.fetcher('/api'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json','X-Requested-With':'XMLHttpRequest',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal});}catch(e){if(signal?.aborted)throw e;throw new ReviewError(0);}
  if(!r.ok)throw new ReviewError(r.status);if(!r.headers.get('content-type')?.includes('application/json'))throw new ReviewError(502);try{return await r.json();}catch{throw new ReviewError(502);}
 }
 async candidate(ws:string,stream:string,agreement:string,signal?:AbortSignal):Promise<CreationProof>{const t=target(ws,stream,agreement);const v=proof(await this.request('/workspaces/'+t.ws+'/association-candidate?streamId='+encodeURIComponent(t.stream)+'&agreement='+t.agreement,signal),t.stream,t.agreement);requireShape(v.indexedHead!==null&&v.indexedHeadHash!==null);return v;}
 private association(v:unknown,ws:string,stream:string,agreement:string):Association{const p=proof(v,stream,agreement),a=v as Association;requireShape(a.workspaceId===ws&&a.audience===ASSOCIATION_AUDIENCE&&typeof a.associatedBy==='string'&&address.test(a.associatedBy)&&typeof a.createdAt==='string'&&Number.isFinite(Date.parse(a.createdAt))&&(a.status==='CANONICAL'||a.status==='UNAVAILABLE'));if(a.status==='CANONICAL')requireShape(p.indexedHead!==null&&p.indexedHeadHash!==null);return a;}
 async associate(ws:string,p:CreationProof,confirmed:boolean,signal?:AbortSignal):Promise<Association>{if(confirmed!==true)throw new Error('Confirm the workspace audience before sharing.');const t=target(ws,p.streamId,p.agreement);return this.association(await this.request('/workspaces/'+t.ws+'/indexed-associations',signal,{streamId:t.stream,agreement:t.agreement,expectedFingerprint:p.fingerprint,audience:ASSOCIATION_AUDIENCE,confirmed:true}),t.ws,t.stream,t.agreement);}
 async read(ws:string,stream:string,agreement:string,signal?:AbortSignal):Promise<Association>{const t=target(ws,stream,agreement);return this.association(await this.request('/workspaces/'+t.ws+'/indexed-associations/'+encodeURIComponent(t.stream)+'/'+t.agreement,signal),t.ws,t.stream,t.agreement);}
}
