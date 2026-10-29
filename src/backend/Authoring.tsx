import {keccak256,toHex} from 'viem';
import {useEffect,useRef,useState} from 'react';
import {AuthoringController,browserJournal} from './authoring.js';
import type {Intent,Terms} from './authoring.js';
import type {DraftReviewClient,SavedDraft,Session} from './draft-review.js';
const fields:[string,string][]=[['client','Client address'],['provider','Provider address'],['token','Token address'],['amountPerPeriod','Amount per period (exact token base units)'],['periodSeconds','Payment period (seconds)'],['noticeSeconds','Notice period (seconds)'],['startAt','Start (Unix seconds)'],['clientNonce','Client nonce'],['acceptanceDeadline','Acceptance deadline (Unix seconds)']];
const blank=()=>Object.fromEntries([['schemaVersion',1],...fields.map(([k])=>[k,''])]) as Terms;
const input='mt-1 block w-full rounded-lg border border-slate-300 bg-white p-3 text-base focus:ring-2 focus:ring-blue-600';
const button='min-h-11 rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600';
export function Authoring({api,identity,enabled,selectedWorkspace,reviewed,onSaved}:{api:DraftReviewClient;identity:Session;enabled:boolean;selectedWorkspace:string;reviewed:SavedDraft|null;onSaved:(workspaceId:string,draftId?:string)=>void}){
 const [controller]=useState(()=>new AuthoringController(api,identity,browserJournal(identity.address,identity.chainId)));
 const [name,setName]=useState(''),[workspaceId,setWorkspaceId]=useState(''),[terms,setTerms]=useState<Terms>(blank),[editing,setEditing]=useState<{id:string;version:number}|null>(null);
 const [documentText,setDocumentText]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
 const mounted=useRef(false),allowed=useRef(enabled);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{allowed.current=enabled;},[enabled]);
 async function save(intent?:Intent){
  if(busy||!enabled)return;setBusy(true);setError('');setStatus('Saving. If interrupted, retry the saved request.');
  try{const saved=await controller.submit(intent);if(!mounted.current)return;
   if(!allowed.current){setStatus('Save confirmed for the previous session. Sign in again to refresh its records.');return;}
   if(saved.intent.kind==='workspace'){if(intent&&!editing)setWorkspaceId(saved.result.id);onSaved(saved.result.id);}
   else if('version' in saved.result){if(intent){setWorkspaceId(saved.result.workspace_id);setEditing(null);setTerms({...saved.result.terms_json});}onSaved(saved.result.workspace_id,saved.result.id);}
   setStatus('Server confirmed the save. Replayed responses describe the original save; review again for the latest version.');
  }catch(e){if(mounted.current){setStatus('');setError((e instanceof Error?e.message:'Save failed.')+' Your form is retained. Retry pending save after an uncertain response.');}}
  finally{if(mounted.current)setBusy(false);}
 }
 function replaceForm(){if(!reviewed||busy)return;if(!window.confirm('Replace the unsaved form with the currently reviewed draft? Review again first if a version conflict occurred.'))return;setWorkspaceId(reviewed.workspace_id);setTerms({...reviewed.terms_json});setEditing(null);setDocumentText(String());setError('');}
 return <section className="my-6 space-y-5 rounded-xl border border-slate-200 bg-white p-5" aria-label="Authenticated authoring">
  <h2 className="text-xl font-semibold">Workspace and draft authoring</h2>
  <p className="text-sm text-slate-600">Authenticated backend records. Saving a draft does not approve terms, verify chain facts, fund an agreement, or sign a transaction.</p>
  {!enabled&&<p role="status">Sign in with the same account and chain to save. Unsaved form input is retained while this page stays open.</p>}
  <p className="break-all text-sm">Author: {identity.address} · Chain {identity.chainId}</p>
  <form onSubmit={e=>{e.preventDefault();void save({kind:'workspace',name});}} className="space-y-3">
   <label className="block">New workspace name<input className={input} value={name} maxLength={128} required disabled={busy} onChange={e=>setName(e.target.value)}/></label>
   <button className={button} disabled={!enabled||busy}>Create workspace</button>
  </form>
  <div className="flex flex-wrap gap-3">
   <button type="button" className={button} disabled={busy||!selectedWorkspace||!!editing} onClick={()=>setWorkspaceId(selectedWorkspace)}>Use selected workspace for new draft</button>
   <button type="button" className={button} disabled={busy||!reviewed} onClick={replaceForm}>Replace form with reviewed draft</button>
   <button type="button" className={button} disabled={busy} onClick={()=>{if(window.confirm('Discard unsaved form input and start a new draft? Pending saves are retained separately.')){setTerms(blank());setEditing(null);setDocumentText(String());}}}>Start another draft</button>
  </div>
  <form className="space-y-4" onSubmit={e=>{e.preventDefault();void save({kind:'create',workspaceId,terms:{...terms,termsDocumentHash:keccak256(toHex(documentText))},documentText});}}>
   <p>New immutable draft · Schema version 1</p>
   <label className="block">Workspace ID<input className={input} value={workspaceId} required disabled={busy||!!editing} onChange={e=>setWorkspaceId(e.target.value)}/></label>
   <div className="grid gap-4 md:grid-cols-2">{fields.map(([key,label])=><label key={key} className="block">{label}<input className={input} value={String(terms[key]??'')} required disabled={busy} spellCheck={false} onChange={e=>setTerms(t=>({...t,[key]:e.target.value}))}/></label>)}</div>
   <label className="block">Private agreement document<textarea className={input} rows={7} value={documentText} required disabled={busy} onChange={e=>setDocumentText(e.target.value)}/></label><p className="break-all text-sm">Document hash: {keccak256(toHex(documentText))}</p>
      <p className="text-sm text-slate-600">Enter integers as decimal digits. Values are sent as exact strings, without floating-point conversion. Server validation remains authoritative.</p>
   <button className={button} disabled={!enabled||busy}>Create immutable draft</button>
  </form>
  <button type="button" className={button} disabled={!enabled||busy} onClick={()=>void save()}>Retry pending save</button>
  <p className="text-sm text-slate-600">Submitted requests are retained in this browser until confirmed. Retry uses the original payload and key. Unsubmitted edits are not persisted across reloads.</p>
  {error&&<p role="alert" className="text-red-700">{error}</p>}{status&&<p role="status">{status}</p>}
 </section>;
}
