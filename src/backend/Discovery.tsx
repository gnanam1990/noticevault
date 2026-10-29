import React,{useCallback,useEffect,useRef,useState} from 'react';
import {ReviewError} from './draft-review.js';
import type {DraftReviewClient,Workspace,DraftSummary} from './draft-review.js';
export function Discovery({api,onSelect,onExpired,onWorkspace}:{api:DraftReviewClient;onSelect:(workspace:string,draft:string)=>void;onExpired:()=>void;onWorkspace?:(workspace:string)=>void}){
 const [workspaces,setWorkspaces]=useState<Workspace[]>([]),[drafts,setDrafts]=useState<DraftSummary[]>([]),[selected,setSelected]=useState(''),[nextWs,setNextWs]=useState<string|null>(null),[nextDraft,setNextDraft]=useState<string|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState('');const request=useRef<AbortController|null>(null),mounted=useRef(true);const expired=useRef(onExpired);
 useEffect(()=>{expired.current=onExpired;},[onExpired]);
 const load=useCallback(async(ws?:string,after?:string)=>{
  request.current?.abort();const current=new AbortController();request.current=current;setBusy(true);setError('');
  if(ws){setSelected(ws);setDrafts([]);setNextDraft(null);}else{setSelected('');setDrafts([]);setWorkspaces([]);setNextWs(null);}
  try{if(ws){const page=await api.drafts(ws,after,current.signal);if(current.signal.aborted)return;setDrafts(page.items);setNextDraft(page.nextCursor);}else{const page=await api.workspaces(after,current.signal);if(current.signal.aborted)return;setWorkspaces(page.items);setNextWs(page.nextCursor);}}
  catch(e){if(!current.signal.aborted&&mounted.current){setError(e instanceof ReviewError?e.message:'Unable to load records. Retry.');if(e instanceof ReviewError&&e.status===401)expired.current();}}
  finally{if(mounted.current&&request.current===current){request.current=null;setBusy(false);}}
 },[api]);
 useEffect(()=>{mounted.current=true;const current=new AbortController();request.current=current;void api.workspaces(undefined,current.signal).then(page=>{if(!current.signal.aborted){setWorkspaces(page.items);setNextWs(page.nextCursor);}}).catch(e=>{if(!current.signal.aborted){setError(e instanceof ReviewError?e.message:'Unable to load workspaces.');if(e instanceof ReviewError&&e.status===401)expired.current();}}).finally(()=>{if(mounted.current&&request.current===current){request.current=null;setBusy(false);}});return()=>{mounted.current=false;current.abort();request.current?.abort();};},[api]);
 const button='min-h-11 rounded-lg border border-slate-300 px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50';
 return <section aria-label="Workspace and draft discovery" className="my-6 rounded-xl border border-slate-200 bg-white p-5">
  <h2 className="text-xl font-bold">Your workspaces</h2><p className="my-2 text-sm text-slate-600">Only workspaces this session belongs to are shown. Pages contain up to 20 records.</p>
  <div className="flex flex-wrap gap-3"><button type="button" className={button} disabled={busy} onClick={()=>void load()}>Refresh workspaces</button>{nextWs&&<button type="button" className={button} disabled={busy} onClick={()=>void load(undefined,nextWs)}>Next workspace page</button>}</div>
  <ul className="my-4 space-y-2">{workspaces.map(ws=><li key={ws.id}><button type="button" className={button+' w-full'} aria-pressed={selected===ws.id} onClick={()=>{onWorkspace?.(ws.id);void load(ws.id);}}>{ws.name}<span className="block break-all text-xs text-slate-500">{ws.id}</span></button></li>)}</ul>
  {!busy&&!error&&workspaces.length===0&&<p>No workspaces on this page. Create a workspace in the authoring section below.</p>}
  {selected&&<><h3 className="mt-4 text-lg font-semibold">Saved drafts</h3><ul className="my-3 space-y-2">{drafts.map(draft=><li key={draft.id}><button type="button" className={button+' w-full break-all'} disabled={busy} onClick={()=>onSelect(selected,draft.id)}>Review draft {draft.id}<span className="block text-sm">Version {draft.version} · {draft.status}</span></button></li>)}</ul>{!busy&&!error&&drafts.length===0&&<p>No saved drafts on this page.</p>}{nextDraft&&<button type="button" className={button} disabled={busy} onClick={()=>void load(selected,nextDraft)}>Next draft page</button>}</>}
  {error&&<p role="alert" className="mt-3 text-red-700">{error}</p>}<p role="status" aria-live="polite">{busy?'Loading authorized records…':''}</p>
 </section>;
}
