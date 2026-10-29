import { DraftReviewClient, ReviewError } from './draft-review.js';
import type { SavedDraft, Workspace } from './draft-review.js';
export type Terms = Record<string,string|number>;
export type Intent = {kind:'workspace';name:string} | {kind:'create';workspaceId:string;terms:Terms;documentText?:string} | {kind:'update';workspaceId:string;draftId:string;expectedVersion:number;terms:Terms};
type Pending = {version:1;address:string;chainId:string;key:string;intent:Intent};
export interface Journal { read():string|null; write(value:string):void; clear():void; exclusive<T>(fn:()=>Promise<T>):Promise<T> }
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validIntent(v:unknown):v is Intent {
 if(!v||typeof v!=='object')return false;
 const o=v as Record<string,unknown>;
 if(o.kind==='workspace')return Object.keys(o).length===2&&typeof o.name==='string'&&o.name.trim().length>0&&o.name.length<=128;
 if(o.kind!=='create'&&o.kind!=='update')return false;
 if(typeof o.workspaceId!=='string'||!uuid.test(o.workspaceId)||!o.terms||typeof o.terms!=='object'||Array.isArray(o.terms))return false;
 const t=o.terms as Terms;
 if(Object.keys(t).sort().join(',')!==['schemaVersion','client','provider','token','amountPerPeriod','periodSeconds','noticeSeconds','startAt','clientNonce','acceptanceDeadline','termsDocumentHash'].sort().join(',')||t.schemaVersion!==1)return false;
 for(const k of ['client','provider','token'])if(typeof t[k]!=='string'||!/^0x[0-9a-f]{40}$/i.test(t[k]))return false;
 for(const k of ['amountPerPeriod','periodSeconds','noticeSeconds','startAt','clientNonce','acceptanceDeadline'])if(typeof t[k]!=='string'||!/^\d+$/.test(t[k])||BigInt(t[k])>=(1n<<256n))return false;
 if(typeof t.termsDocumentHash!=='string'||!/^0x[0-9a-f]{64}$/i.test(t.termsDocumentHash))return false;
 return o.kind==='create'?(Object.keys(o).length===3||(Object.keys(o).length===4&&typeof o.documentText==='string'&&new TextEncoder().encode(o.documentText).length>0&&new TextEncoder().encode(o.documentText).length<=262144)):Object.keys(o).length===5&&typeof o.draftId==='string'&&uuid.test(o.draftId)&&Number.isSafeInteger(o.expectedVersion)&&Number(o.expectedVersion)>0;
}
export class AuthoringController {
 private active=false;
 constructor(private api:DraftReviewClient,private identity:{address:string;chainId:string},private journal:Journal,private newKey=()=>crypto.randomUUID()){}
 pending():Pending|null {
  const raw=this.journal.read();if(raw===null)return null;
  try{const parsed:unknown=JSON.parse(raw);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();const p=parsed as Record<string,unknown>;if(Object.keys(p).length!==5||p.version!==1||p.address!==this.identity.address.toLowerCase()||p.chainId!==this.identity.chainId||typeof p.key!=='string'||!uuid.test(p.key)||!validIntent(p.intent))throw new Error();return {version:1,address:this.identity.address.toLowerCase(),chainId:this.identity.chainId,key:p.key,intent:p.intent};}
  catch{throw new Error('Saved pending request is invalid. Its bytes were preserved; authoring is blocked until it is reviewed.');}
 }
 async submit(intent?:Intent):Promise<{intent:Intent;result:Workspace|SavedDraft}>{
  if(this.active)throw new Error('A save is already in progress.');
  this.active=true;
  try{return await this.journal.exclusive(async()=>{
   let p=this.pending();
   if(p&&intent&&JSON.stringify(p.intent)!==JSON.stringify(intent))throw new Error('A previous save has an uncertain outcome. Retry that saved request first; current input is retained.');
   if(!p){if(!validIntent(intent))throw new Error('Check all draft fields. Integers must be exact unsigned decimal strings.');p={version:1,address:this.identity.address.toLowerCase(),chainId:this.identity.chainId,key:this.newKey(),intent:JSON.parse(JSON.stringify(intent)) as Intent};this.journal.write(JSON.stringify(p));}
   const me=await this.api.session();
   if(me.address.toLowerCase()!==p.address||me.chainId!==p.chainId)throw new Error('Sign in with the account and chain that started this save before retrying.');
   let result:Workspace|SavedDraft;
   try{const i=p.intent;result=i.kind==='workspace'?await this.api.createWorkspace(i.name,p.key):i.kind==='create'?await this.api.createDraft(i.workspaceId,i.terms,p.key,i.documentText):await this.api.updateDraft(i.workspaceId,i.draftId,i.expectedVersion,i.terms,p.key);}
   catch(error){if(error instanceof ReviewError&&(error.status===400||error.status===409)){this.journal.clear();throw new Error(error.status===409?'Version or request conflict. Your input is retained. Review the latest draft before explicitly loading it.':'The server rejected these fields. Your input is retained.');}throw error;}
   this.journal.clear();return {intent:p.intent,result};
  });}finally{this.active=false;}
 }
}
export function browserJournal(address:string,chainId:string):Journal {
 const key='noticevault-backend-mutations-v1:'+address.toLowerCase()+':'+chainId;
 return {read:()=>localStorage.getItem(key),write:(v)=>localStorage.setItem(key,v),clear:()=>localStorage.removeItem(key),exclusive:async(fn)=>{
  if(!navigator.locks)throw new Error('Safe authoring requires browser Web Locks support. No request was sent.');
  return navigator.locks.request(key,{ifAvailable:true},async(lock)=>{if(!lock)throw new Error('Another tab is saving. Retry after it finishes.');return fn();});
 }};
}
