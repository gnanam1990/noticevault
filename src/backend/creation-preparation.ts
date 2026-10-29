import {ReviewError} from './draft-review.js';
import type {Fetcher} from './draft-review.js';
export type CreationContext={source:'SYNTHETIC'|'CONFIGURED_READ_ONLY';binding:string;workspaceId:string;draftId:string;version:number;factory:string;account:string;chainId:string};
export type UnsignedPreparation={source:'SYNTHETIC'|'CONFIGURED_READ_ONLY';binding:string;workspaceId:string;draftId:string;blockNumber:string;blockHash:string;observedAt:number;transaction:{to:string;data:string;chainId:string;value:'0'}};
export type CurrentWallet={account:string;chainId:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,hash=/^0x[0-9a-f]{64}$/i,address=/^0x[0-9a-f]{40}$/i;
function id(s:string){if(!uuid.test(s))throw new ReviewError(400);return encodeURIComponent(s);}
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw new ReviewError(502);return v as Record<string,unknown>;}
function requireShape(ok:boolean):asserts ok{if(!ok)throw new ReviewError(502);}
/** No signing/submission methods. Context and output remain explicitly synthetic. */
export class CreationPreparationClient {
 constructor(private readonly fetcher:Fetcher=(p,i)=>fetch(p,i)){}
 private async request(path:string,body?:unknown,signal?:AbortSignal){
  let r:Response;try{r=await this.fetcher('/api'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json','X-Requested-With':'XMLHttpRequest',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),...(signal?{signal}:{})});}catch(e){if(signal?.aborted)throw e;throw new ReviewError(0);}
  if(!r.ok)throw new ReviewError(r.status);if(!r.headers.get('content-type')?.includes('application/json'))throw new ReviewError(502);try{return object(await r.json());}catch{throw new ReviewError(502);}
 }
 async context(workspaceId:string,draftId:string,signal?:AbortSignal):Promise<CreationContext>{
  const v=await this.request('/workspaces/'+id(workspaceId)+'/drafts/'+id(draftId)+'/creation-context',undefined,signal);
  requireShape((v.source==='SYNTHETIC'||v.source==='CONFIGURED_READ_ONLY')&&v.workspaceId===workspaceId&&v.draftId===draftId&&typeof v.binding==='string'&&hash.test(v.binding)&&typeof v.factory==='string'&&address.test(v.factory)&&typeof v.account==='string'&&address.test(v.account)&&typeof v.chainId==='string'&&/^[1-9][0-9]*$/.test(v.chainId)&&Number.isSafeInteger(v.version)&&Number(v.version)>0);return v as CreationContext;
 }
 async prepare(context:CreationContext,readWallet:()=>Promise<CurrentWallet>,signal?:AbortSignal):Promise<UnsignedPreparation>{
  const c=Object.freeze({...context});const wallet=Object.freeze({...await readWallet()});
  const matches=(w:CurrentWallet)=>typeof w.account==='string'&&w.account.toLowerCase()===c.account.toLowerCase()&&w.chainId===c.chainId;
  if(!matches(wallet))throw new ReviewError(409);
  const v=await this.request('/workspaces/'+id(c.workspaceId)+'/drafts/'+id(c.draftId)+'/creation-preparation',{binding:c.binding,account:wallet.account,chainId:wallet.chainId},signal);
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');if(!matches(await readWallet()))throw new ReviewError(409);
  const tx=object(v.transaction);requireShape(v.source===c.source&&v.binding===c.binding&&v.workspaceId===c.workspaceId&&v.draftId===c.draftId&&typeof v.blockNumber==='string'&&/^[0-9]+$/.test(v.blockNumber)&&typeof v.blockHash==='string'&&hash.test(v.blockHash)&&typeof v.observedAt==='number'&&Number.isSafeInteger(v.observedAt)&&tx.to===c.factory&&tx.chainId===c.chainId&&tx.value==='0'&&typeof tx.data==='string'&&/^0x(?:[0-9a-f]{2}){4,}$/i.test(tx.data));return v as UnsignedPreparation;
 }
}
