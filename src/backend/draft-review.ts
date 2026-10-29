/** Same-origin, read-only backend adapter. Never reads demo storage or handles credentials. */
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
export type Session = { address: string; chainId: string; workspaceId: string | null; expiresAt: string };
export type Workspace = { id: string; name: string };
export type SavedDraft = { id: string; workspace_id: string; author_address: string; version: number; status: string; doc_hash: string; terms_json: Record<string,string|number> };
export class ReviewError extends Error {
 constructor(public readonly status: number) {
  super(status===401?'Your session is missing or expired. Sign in through the authorized wallet flow, then check again.':status===403?'This session cannot access that workspace.':status===404?'No matching workspace or draft was found.':status===400?'Enter a valid workspace and draft ID.':status===0?'The backend could not be reached. Check the connection and retry.':status===502?'The backend returned an unexpected response. No draft was loaded.':'The backend could not complete this request. Please retry.');
  this.name='ReviewError';
 }
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const address=/^0x[0-9a-f]{40}$/i;
const hash=/^0x[0-9a-f]{64}$/i;
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw new ReviewError(502);return v as Record<string,unknown>;}
function requireShape(ok:boolean):asserts ok {if(!ok)throw new ReviewError(502);}
function id(v:string){if(!uuid.test(v))throw new ReviewError(400);return encodeURIComponent(v);}
export class DraftReviewClient {
 constructor(private readonly fetcher:Fetcher=(input,init)=>fetch(input,init)){}
 private async read(path:string,signal?:AbortSignal,body?:unknown,method?:"POST"|"PUT",key?:string):Promise<Record<string,unknown>>{
  let response:Response;
  try{response=await this.fetcher('/api'+path,{method:method??(body===undefined?'GET':'POST'),...(body===undefined?{}:{body:JSON.stringify(body)}),credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json',...(key?{'Idempotency-Key':id(key)}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),'X-Requested-With':'XMLHttpRequest'},...(signal?{signal}:{})});}
  catch(e){if(signal?.aborted||(e instanceof Error&&e.name==='AbortError'))throw e;throw new ReviewError(0);}
  if(!response.ok)throw new ReviewError(response.status);
  if(!response.headers.get('content-type')?.includes('application/json'))throw new ReviewError(502);
  try{return object(await response.json());}catch{throw new ReviewError(502);}
 }
 async logout():Promise<void>{await this.read('/auth/logout',undefined,{});}
 async challenge(address:string,chainId:number):Promise<{nonce:string;message:string;issuedAt:string;expiresAt:string}>{
  const v=await this.read('/auth/challenge',undefined,{address,chainId});
  requireShape(['nonce','message','issuedAt','expiresAt'].every(k=>typeof v[k]==='string'));return v as {nonce:string;message:string;issuedAt:string;expiresAt:string};
 }
 async verify(address:string,chainId:number,nonce:string,signature:string):Promise<void>{await this.read('/auth/verify',undefined,{address,chainId,nonce,signature});}
 async workspaces(after?:string,signal?:AbortSignal):Promise<Page<Workspace>>{
  const v=await this.read('/workspaces'+(after?'?after='+id(after):''),signal);requireShape(Array.isArray(v.items)&&v.items.length<=20&&(v.nextCursor===null||(typeof v.nextCursor==='string'&&uuid.test(v.nextCursor))));
  for(const raw of v.items){const x=object(raw);requireShape(typeof x.id==='string'&&uuid.test(x.id)&&typeof x.name==='string');}return v as Page<Workspace>;
 }
 async drafts(workspaceId:string,after?:string,signal?:AbortSignal):Promise<Page<DraftSummary>>{
  const v=await this.read('/workspaces/'+id(workspaceId)+'/drafts'+(after?'?after='+id(after):''),signal);requireShape(Array.isArray(v.items)&&v.items.length<=20&&(v.nextCursor===null||(typeof v.nextCursor==='string'&&uuid.test(v.nextCursor))));
  for(const raw of v.items){const x=object(raw);requireShape(typeof x.id==='string'&&uuid.test(x.id)&&x.workspace_id===workspaceId&&typeof x.version==='number'&&Number.isSafeInteger(x.version)&&x.version>0&&typeof x.status==='string');}return v as Page<DraftSummary>;
 }
 async session(signal?:AbortSignal):Promise<Session>{
  const v=await this.read('/auth/me',signal);
  requireShape(typeof v.address==='string'&&address.test(v.address)&&typeof v.chainId==='string'&&/^[1-9][0-9]*$/.test(v.chainId)&&typeof v.expiresAt==='string'&&Number.isFinite(Date.parse(v.expiresAt))&&(v.workspaceId===null||(typeof v.workspaceId==='string'&&uuid.test(v.workspaceId))));
  return v as Session;
 }
 async workspace(workspaceId:string,signal?:AbortSignal):Promise<Workspace>{
  const v=await this.read('/workspaces/'+id(workspaceId),signal);
  requireShape(v.id===workspaceId&&typeof v.name==='string'&&v.name.length>0);return v as Workspace;
 }
 async draft(workspaceId:string,draftId:string,signal?:AbortSignal):Promise<SavedDraft>{
 return this.savedDraft(await this.read('/workspaces/'+id(workspaceId)+'/drafts/'+id(draftId),signal),workspaceId,draftId);
 }
 private savedDraft(v:Record<string,unknown>,workspaceId:string,draftId:string):SavedDraft{
 const t=object(v.terms_json);
 requireShape(v.id===draftId&&v.workspace_id===workspaceId&&typeof v.author_address==='string'&&address.test(v.author_address)&&typeof v.version==='number'&&Number.isSafeInteger(v.version)&&v.version>0&&typeof v.status==='string'&&typeof v.doc_hash==='string'&&hash.test(v.doc_hash)&&t.schemaVersion===1);
  for(const k of ['client','provider','token'])requireShape(typeof t[k]==='string'&&address.test(t[k]));
  for(const k of ['amountPerPeriod','periodSeconds','noticeSeconds','startAt','clientNonce','acceptanceDeadline'])requireShape(typeof t[k]==='string'&&/^[0-9]+$/.test(t[k])&&BigInt(t[k])<(1n<<256n));
  requireShape(typeof t.termsDocumentHash==='string'&&hash.test(t.termsDocumentHash));return v as SavedDraft;
 }
 async createWorkspace(name:string,key:string):Promise<Workspace>{
 const v=await this.read('/workspaces',undefined,{name},'POST',key);
 requireShape(typeof v.id==='string'&&uuid.test(v.id)&&typeof v.name==='string');
 return {id:v.id,name:v.name};
 }
 async createDraft(workspaceId:string,terms:Record<string,string|number>,key:string,documentText?:string):Promise<SavedDraft>{
 const v=await this.read('/workspaces/'+id(workspaceId)+(documentText===undefined?'/drafts':'/immutable-drafts'),undefined,documentText===undefined?{termsJson:terms}:{termsJson:terms,documentText,expectedRevisionNumber:0},'POST',key);
 requireShape(typeof v.id==='string'&&uuid.test(v.id));
 return this.savedDraft(v,workspaceId,v.id);
 }
 async updateDraft(workspaceId:string,draftId:string,expectedVersion:number,terms:Record<string,string|number>,key:string):Promise<SavedDraft>{
 const v=await this.read('/workspaces/'+id(workspaceId)+'/drafts/'+id(draftId),undefined,{termsJson:terms,expectedVersion},'PUT',key);
 return this.savedDraft(v,workspaceId,draftId);
 }
}

export type Page<T>={items:T[];nextCursor:string|null};
export type DraftSummary={id:string;workspace_id:string;version:number;status:string};
