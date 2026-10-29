import {useEffect,useRef,useState} from 'react';
import {AssociationClient} from './association-client.js';
import type {Association as SavedAssociation,CreationProof} from './association-client.js';
import {ReviewError} from './draft-review.js';
const api=new AssociationClient();
const input='mt-1 block w-full rounded-lg border border-slate-300 bg-white p-3 text-base focus:ring-2 focus:ring-blue-600';
const button='min-h-11 rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600';
export function Association({workspaceId,enabled,onExpired}:{workspaceId:string;enabled:boolean;onExpired:()=>void}){
 const [stream,setStream]=useState(''),[agreement,setAgreement]=useState(''),[candidate,setCandidate]=useState<CreationProof|null>(null),[saved,setSaved]=useState<SavedAssociation|null>(null);
 const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const active=useRef<AbortController|null>(null);useEffect(()=>()=>{active.current?.abort();},[]);
 async function run(kind:'lookup'|'associate'|'read'){
  if(active.current||!enabled)return;const ctrl=new AbortController();active.current=ctrl;setBusy(true);setError('');
  try{
   if(kind==='lookup'){setCandidate(null);setConfirmed(false);setSaved(null);const p=await api.candidate(workspaceId,stream,agreement,ctrl.signal);if(!ctrl.signal.aborted)setCandidate(p);}
   else if(kind==='associate'&&candidate&&confirmed){const a=await api.associate(workspaceId,candidate,true,ctrl.signal);if(!ctrl.signal.aborted)setSaved(a);}
   else if(kind==='read'){const a=await api.read(workspaceId,stream,agreement,ctrl.signal);if(!ctrl.signal.aborted)setSaved(a);}
  }catch(e){if(!ctrl.signal.aborted){setError(e instanceof ReviewError&&e.status===409?'Creation or policy changed, or an immutable association already binds different provenance. Review again; it was not rebound.':e instanceof Error?e.message:'Request failed.');if(e instanceof ReviewError&&e.status===401)onExpired();}}
  finally{if(!ctrl.signal.aborted){active.current=null;setBusy(false);}}
 }
 function reset(){setCandidate(null);setConfirmed(false);setSaved(null);setError('');}
 return <section className="my-6 space-y-4 rounded-xl border border-slate-200 bg-white p-5" aria-label="Associate indexed agreement">
  <h2 className="text-xl font-semibold">Share an indexed agreement with this workspace</h2>
  <p className="break-all text-sm">Workspace: {workspaceId||'Select a workspace above first'}</p>
  <p className="text-sm text-slate-600">Synthetic indexed records only. Live chain freshness is unknown. This links a record for reading; it does not accept a contract, sign a transaction, or make funds spendable.</p>
  <form className="space-y-3" onSubmit={e=>{e.preventDefault();void run('lookup');}}>
   <label className="block">Indexer stream ID<input className={input} value={stream} required maxLength={128} disabled={busy} onChange={e=>{setStream(e.target.value);reset();}}/></label>
   <label className="block">Agreement address<input className={input} value={agreement} required disabled={busy} spellCheck={false} onChange={e=>{setAgreement(e.target.value);reset();}}/></label>
   <button className={button} disabled={!enabled||busy||!workspaceId}>Review participant association</button>
  </form>
  <button className={button} type="button" disabled={!enabled||busy||!workspaceId||!stream||!agreement} onClick={()=>void run('read')}>Check existing association</button>
  {candidate&&<div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
   <p className="font-semibold">Audience: all current and future members of this workspace</p>
   <p>Confirming allows those members to read this agreement's indexed data. The association is immutable in this version and there is no unshare control yet. A reorg or replaced creation makes it unavailable rather than linking a replacement.</p>
   <dl className="space-y-2 break-all text-sm"><dt>Agreement</dt><dd>{candidate.agreement}</dd><dt>Client / provider</dt><dd>{candidate.client} / {candidate.provider}</dd><dt>Chain / stream</dt><dd>{candidate.chainId} / {candidate.streamId}</dd><dt>Creation block hash</dt><dd>{candidate.creationBlockHash}</dd><dt>Deployment policy fingerprint</dt><dd>{candidate.policyHash}</dd></dl>
   <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/><span>I deliberately authorize sharing this exact indexed agreement with all current and future members of workspace <strong className="break-all">{workspaceId}</strong>.</span></label>
   <button className={button} type="button" disabled={!enabled||busy||!confirmed} onClick={()=>void run('associate')}>Confirm workspace association</button>
   <p className="text-sm">If the response is interrupted, retry this same confirmation or check the existing association. Repeated confirmation does not create another association.</p>
  </div>}
  {busy&&<p role="status">Checking the authenticated backend…</p>}
  {error&&<p role="alert" className="text-red-700">{error}</p>}
  {saved&&<div role="status" className="break-all rounded-lg bg-slate-50 p-4"><p>Association: {saved.status==='CANONICAL'?'Canonical indexed creation':'Unavailable: creation or deployment policy changed'}</p><p>Source: {saved.source}. Live freshness: unknown.</p><p>Indexed head: {saved.indexedHead??'unavailable'} · {saved.indexedHeadHash??'unavailable'}</p><p>No transaction actions are enabled.</p></div>}
 </section>;
}
