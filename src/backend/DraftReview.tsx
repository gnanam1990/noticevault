/**
 * DraftReview — main workspace view.
 *
 * Renders WorkspacePanel (4-state readiness) above the draft/workspace tools.
 * Backend request-path failures are reported with specificity:
 *   401 → session expired / not signed in
 *   403 → workspace access denied
 *   404 → not found
 *   0   → network unreachable
 *   503/5xx → backend unavailable
 *   cleanup failure → surfaced as a named state, not silent
 *
 * Security: no wallet signing, no transaction, no token approval here.
 * Connection and authentication remain separate (handled in WorkspacePanel → SignIn → WorkspaceWallet).
 */
import {WorkspaceMembers} from './WorkspaceMembers';
import {PrivateRevisions} from './PrivateRevisions';
import {OperatorConsent} from './OperatorConsent';
import {OperatorApproval} from './OperatorApproval';
import {CreationApprovalReview} from './CreationApprovalReview.js';
import {TransactionReview} from './TransactionReview.js';
import NotificationInbox from './NotificationInbox.js';
import IndexedAgreements from './IndexedAgreements.js';
import {Association} from './Association.js';
import {Authoring} from './Authoring.js';
import {Discovery} from './Discovery.js';
import {WorkspacePanel} from './WorkspacePanel.js';
import {loadAuthNetwork} from './auth-network.js';
import type {AuthNetwork} from './auth-network.js';
import {classifyRequestError} from './request-error.js';
import React, {useEffect,useRef,useState} from 'react';
import {DraftReviewClient} from './draft-review.js';
import type {SavedDraft,Session,Workspace} from './draft-review.js';

const api=new DraftReviewClient();

const inputClass='block w-full rounded-lg border border-slate-300 bg-white p-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-600';
const buttonClass='min-h-11 rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600';

const fields:[string,string][]=[
  ['client','Client'],
  ['provider','Provider'],
  ['token','Token address'],
  ['amountPerPeriod','Amount per period (token base units)'],
  ['periodSeconds','Payment period (seconds)'],
  ['noticeSeconds','Notice period (seconds)'],
  ['startAt','Start time (Unix seconds)'],
  ['acceptanceDeadline','Acceptance deadline (Unix seconds)'],
  ['clientNonce','Client nonce'],
  ['termsDocumentHash','Terms document hash'],
];

// ── DraftReview ───────────────────────────────────────────────────────────────

export function DraftReview(){
  const [authorIdentity,setAuthorIdentity]=useState<Session|null>(null),[revision,setRevision]=useState(0);
  const [session,setSession]=useState<Session|null>(null),[workspace,setWorkspace]=useState<Workspace|null>(null),[draft,setDraft]=useState<SavedDraft|null>(null);
  const [workspaceId,setWorkspaceId]=useState(''),[draftId,setDraftId]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [authBusy,setAuthBusy]=useState(false);
  // Runtime network config — loaded from API, never hardcoded. Used for display labels only.
  const [network,setNetwork]=useState<AuthNetwork|null>(null);
  const active=useRef<AbortController|null>(null);
  // Load the configured network on mount for accurate display labels.
  useEffect(()=>{const ctrl=new AbortController();void loadAuthNetwork(ctrl.signal).then(setNetwork).catch(()=>{/* display falls back to WorkspacePanel default */});return()=>ctrl.abort();},[]);
  useEffect(()=>()=>{active.current?.abort();},[]);

  // Session expiry timer — clears workspace state when the session expires.
  useEffect(()=>{
    if(!session)return;
    const ms=Date.parse(session.expiresAt)-Date.now();
    const timer=setTimeout(()=>{
      active.current?.abort();active.current=null;setBusy(false);
      setSession(null);setWorkspace(null);setDraft(null);
      setError('Your session has expired. Sign in again through the wallet flow.');
    },Math.max(0,Math.min(ms,2147483647)));
    return()=>clearTimeout(timer);
  },[session]);

  async function load(review:boolean,selection?:{workspace:string;draft:string}){
    if(active.current||authBusy)return;
    const request=new AbortController();active.current=request;setBusy(true);setError('');setDraft(null);setWorkspace(null);
    try{
      const me=await api.session(request.signal);
      if(request.signal.aborted)return;
      if(review){
        const ws=await api.workspace(selection?.workspace??workspaceId.trim(),request.signal);
        const saved=await api.draft(ws.id,selection?.draft??draftId.trim(),request.signal);
        if(request.signal.aborted)return;
        setWorkspace(ws);setDraft(saved);
      }
      setSession(me);setAuthorIdentity(me);
    }catch(e){
      if(request.signal.aborted)return; // user-initiated cancel; do not overwrite with abort error
      const msg=classifyRequestError(e, review?'loading draft':'checking session');
      if(msg){setSession(null);setError(msg);}
    }finally{
      if(active.current===request){active.current=null;setBusy(false);}
    }
  }

  function invalidateSession(){
    active.current?.abort();active.current=null;setBusy(false);
    setSession(null);setWorkspace(null);setDraft(null);
  }

  function cancel(){
    active.current?.abort();active.current=null;setBusy(false);
    setDraft(null);setWorkspace(null);
    setError('Request cancelled. No draft was changed.');
  }

  return (
    <main className="nv-page" aria-labelledby="review-title">
      <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Backend workspace</p>
      <h1 id="review-title" className="mt-2 text-3xl font-bold text-slate-900">Create an agreement. Keep the terms clear.</h1>
      <p className="mt-3 text-slate-700">
        This view reads your authenticated workspace from the backend.
        It does not use demo records, sign a message, accept terms, or move funds.
      </p>
      <p className="mt-1 text-sm text-slate-500">
        {network
          ? `The backend is configured for ${network.label} (chain ${network.chainId}).`
          : 'Loading configured network…'}
        {' '}Mainnet deployment evidence is in Advanced.
        These are distinct configurations; authentication here does not imply mainnet readiness.
      </p>

      <ol className="nv-steps" aria-label="Agreement workflow"><li>Connect &amp; sign in</li><li>Create agreement draft</li><li>Review &amp; confirm</li></ol>
      {/* 4-state workspace readiness panel — passes runtime network, never hardcoded */}
      <WorkspacePanel
        api={api}
        network={network}
        session={session}
        authBusy={authBusy}
        onSignedIn={me=>{setSession(me);setAuthorIdentity(me);setError('');}}
        onInvalidated={invalidateSession}
        onBusy={setAuthBusy}
      />

      {/* Workspace / draft discovery */}
      {session&&<Discovery
        key={session.address+session.chainId+session.expiresAt+revision}
        api={api}
        onWorkspace={setWorkspaceId}
        onExpired={invalidateSession}
        onSelect={(ws,id)=>{
          if(active.current||authBusy)return;
          setWorkspaceId(ws);setDraftId(id);
          void load(true,{workspace:ws,draft:id});
        }}
      />}

      {session&&<NotificationInbox
        key={session.address.toLowerCase()+':'+session.chainId+':'+workspaceId}
        workspaceId={workspaceId}
        chainId={session.chainId}
        onExpired={invalidateSession}
      />}

      {session&&<IndexedAgreements
        key={session.address.toLowerCase()+':'+session.chainId+':'+workspaceId}
        workspaceId={workspaceId}
        chainId={session.chainId}
        onExpired={invalidateSession}
      />}

      {session&&<Association
        key={session.address.toLowerCase()+':'+session.chainId+':'+workspaceId}
        workspaceId={workspaceId}
        enabled={!authBusy&&!busy}
        onExpired={invalidateSession}
      />}

      {authorIdentity&&<Authoring
        key={authorIdentity.address.toLowerCase()+':'+authorIdentity.chainId}
        api={api}
        identity={authorIdentity}
        enabled={!!session&&!authBusy&&!busy&&session.address.toLowerCase()===authorIdentity.address.toLowerCase()&&session.chainId===authorIdentity.chainId}
        selectedWorkspace={workspaceId}
        reviewed={draft}
        onSaved={(ws,id)=>{setWorkspaceId(ws);if(id)setDraftId(id);setRevision(v=>v+1);}}
      />}

      {session&&<WorkspaceMembers
        key={session.address+':'+session.chainId+':'+workspaceId}
        session={session}
        workspaceId={workspaceId}
        disabled={authBusy||busy}
      />}

      {session&&<PrivateRevisions
        key={session.address+':'+session.chainId+':'+(draft?.id??'')}
        session={session}
        draft={draft}
        disabled={authBusy||busy}
        onSaved={(ws,id)=>{setWorkspaceId(ws);setDraftId(id);void load(true,{workspace:ws,draft:id});}}
      />}

      {/* Session check section */}
      <section className="my-6 rounded-xl border border-slate-200 bg-white p-5" aria-label="Session">
        <p className="mb-3 break-all">
          {session
            ? 'Signed in: '+session.address
            : 'Sign in above, or check an existing authorized session.'}
        </p>
        {session&&<p className="mb-3 text-sm text-slate-600">
          Chain {session.chainId} · Session expires {new Date(session.expiresAt).toISOString()}
        </p>}
        <button className={buttonClass} disabled={busy||authBusy} onClick={()=>void load(false)}>
          Check existing session
        </button>
      </section>

      {/* Error display */}
      {error&&<p role="alert" className="my-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}

      <details className="nv-advanced"><summary>Advanced · open a draft by ID</summary>
      {/* Manual draft load form */}
      <form
        onSubmit={e=>{e.preventDefault();void load(true);}}
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-5"
      >
        <p className="text-sm text-slate-600">
          You can also open a specific draft using its workspace and draft IDs.
        </p>
        <label className="block font-medium">
          Workspace ID
          <input
            className={inputClass}
            autoComplete="off"
            spellCheck={false}
            required
            value={workspaceId}
            disabled={busy||authBusy}
            onChange={e=>{setWorkspaceId(e.target.value);setDraft(null);setWorkspace(null);}}
          />
        </label>
        <label className="block font-medium">
          Draft ID
          <input
            className={inputClass}
            autoComplete="off"
            spellCheck={false}
            required
            value={draftId}
            disabled={busy||authBusy}
            onChange={e=>{setDraftId(e.target.value);setDraft(null);setWorkspace(null);}}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <button className={buttonClass} disabled={busy||authBusy||!session}>Load saved draft</button>
          {busy&&<button type="button" onClick={cancel} className="min-h-11 rounded-lg border border-slate-400 px-4 py-3">Cancel request</button>}
        </div>
        <p role="status" aria-live="polite">
          {busy?'Loading from backend…':draft?'Saved draft loaded. No changes made.':''}
        </p>
      </form></details>

      {/* Draft display */}
      {draft&&workspace&&(
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5" aria-label="Saved draft">
          <h2 className="text-xl font-bold">{workspace.name}</h2>
          <p className="my-2 break-all">Draft {draft.id} · Version {draft.version} · {draft.status}</p>
          <p className="mb-4 text-sm text-slate-600">
            Saved terms only. This is not evidence of provider consent, an active agreement, funding, or on-chain state.
          </p>
          <dl className="grid gap-4 sm:grid-cols-2">
            {fields.map(([key,label])=>(
              <div key={key}>
                <dt className="text-sm font-medium text-slate-600">{label}</dt>
                <dd className="break-all font-mono text-sm">{String(draft.terms_json[key])}</dd>
              </div>
            ))}
            <div className="sm:col-span-2">
              <dt className="text-sm text-slate-600">Saved canonical document hash</dt>
              <dd className="break-all font-mono text-sm">{draft.doc_hash}</dd>
            </div>
          </dl>
        </section>
      )}

      {draft&&workspace&&session&&session.address.toLowerCase()===String(draft.terms_json.client).toLowerCase()&&(
        <OperatorApproval
          key={session.address+session.chainId+session.expiresAt+draft.id+draft.version+revision}
          workspaceId={workspace.id}
          draftId={draft.id}
          disabled={busy||authBusy}
        />
      )}

      {draft&&workspace&&session&&session.address.toLowerCase()===String(draft.terms_json.provider).toLowerCase()&&(
        <OperatorConsent
          key={'consent:'+session.address+session.chainId+session.expiresAt+draft.id+draft.version+revision}
          workspaceId={workspace.id}
          draftId={draft.id}
          disabled={busy||authBusy}
        />
      )}

      {draft&&workspace&&session&&session.address.toLowerCase()===String(draft.terms_json.client).toLowerCase()&&(
        <OperatorApproval
          key={'create:'+session.address+session.chainId+session.expiresAt+draft.id+draft.version+revision}
          workspaceId={workspace.id}
          draftId={draft.id}
          creation={draft}
          disabled={busy||authBusy}
        />
      )}

      {draft&&workspace&&session&&(
        <CreationApprovalReview
          key={session.address+session.chainId+session.expiresAt+draft.id+draft.version+revision}
          workspaceId={workspace.id}
          draftId={draft.id}
          chainId={session.chainId}
          disabled={busy||authBusy}
        />
      )}

      {draft&&workspace&&session&&(
        <TransactionReview
          key={session.address+session.chainId+session.expiresAt+draft.id+draft.version+revision}
          workspaceId={workspace.id}
          draftId={draft.id}
          account={session.address}
          chainId={session.chainId}
          disabled={busy||authBusy}
        />
      )}
    </main>
  );
}
