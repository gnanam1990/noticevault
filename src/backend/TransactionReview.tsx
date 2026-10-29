import {useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import {creationReviewLoader,TransactionReviewController} from './transaction-review.js';
import {browserCreationStorage,creationAttemptStore} from './creation-attempt-store.js';
const button='min-h-11 rounded-lg border border-blue-700 px-4 py-3 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50';
export function TransactionReview({workspaceId,draftId,chainId,disabled=false,syntheticController}:{workspaceId:string;draftId:string;account:string;chainId:string;disabled?:boolean;syntheticController?:TransactionReviewController}){
 if(syntheticController&&import.meta.env.MODE!=='test')throw new Error('Synthetic controller requires isolated test construction');
 const [acceptedKey,setAcceptedKey]=useState<string|null>(null);
 const controller=useMemo(()=>{
  if(syntheticController)return syntheticController;
  const store=creationAttemptStore(browserCreationStorage,chainId,workspaceId,draftId,'create-agreement');
  const load=creationReviewLoader(workspaceId,draftId,()=>Promise.reject(new Error('Wallet preparation unavailable until deployment and provider prerequisites are verified. No wallet request was made.')));
  return new TransactionReviewController(load,store,null);
 },[workspaceId,draftId,chainId,syntheticController]);
 const state=useSyncExternalStore(notify=>controller.subscribe(()=>notify()),()=>controller.snapshot(),()=>controller.snapshot());
 useEffect(()=>()=>controller.invalidate(),[controller]);
 useEffect(()=>{if(disabled)controller.invalidate();},[controller,disabled]);
 const accepted=state.status==='review'&&!!state.review&&acceptedKey===state.review.key;
 const review=state.review;const busy=['preparing','checking','submitting'].includes(state.status);
 return <section className="mt-6 rounded-xl border border-slate-300 bg-white p-5" aria-labelledby="transaction-review-title">
  <p className="text-sm font-semibold uppercase text-amber-800">Synthetic preparation only · Live submission unavailable</p>
  <h2 id="transaction-review-title" className="mt-2 text-xl font-bold">Review agreement creation</h2>
  <p className="my-3 text-slate-700">Review an unsigned factory creation call. This screen cannot connect a wallet, approve tokens or submit a live transaction. Synthetic receipts do not prove live funding.</p>
  <p role="status" aria-live="polite" className="my-3 break-words">{state.status}: {state.message}</p>
  {review&&<><dl className="grid gap-4 sm:grid-cols-2">{Object.entries({Account:review.account,Chain:review.chainId,Factory:review.target,'Native value':review.value,'Draft version':String(review.version),'Policy and consent binding':review.binding,'Initial funding (base units)':review.deposit,'Notice reserve (base units)':review.reserve,'Evidence block':review.blockNumber,'Evidence hash':review.blockHash,...review.terms}).map(([label,value])=><div key={label}><dt className="text-sm font-semibold text-slate-600">{label}</dt><dd className="break-all font-mono text-sm">{value}</dd></div>)}</dl>
   <p className="my-4">Call: createAgreement(terms, provider consent). Uses existing factory allowance for the exact initial funding shown. Does not increase allowance. No unlimited or separate token approval is included.</p>
   <details><summary className="min-h-11 cursor-pointer py-3">Inspect exact calldata</summary><pre className="whitespace-pre-wrap break-all text-xs">{review.data}</pre></details>
   <label className="my-4 flex min-h-11 items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5" checked={accepted} disabled={busy||disabled||state.status!=='review'} onChange={e=>setAcceptedKey(e.target.checked?review.key:null)}/><span>I reviewed the account, chain, target, terms, funding and allowance scope. This is synthetic only.</span></label>
   <button type="button" className={button} disabled={!accepted||disabled||state.status!=='review'} onClick={()=>{setAcceptedKey(null);void controller.confirm(accepted);}}>Confirm reviewed preparation</button>
  </>}
  <div className="mt-4 flex flex-wrap gap-3"><button type="button" className={button} disabled={disabled||busy||['unknown','submitted','confirmed','reverted'].includes(state.status)} onClick={()=>{setAcceptedKey(null);void controller.prepare();}}>Check preparation readiness</button>{['preparing','review','checking'].includes(state.status)&&<button type="button" className={button} onClick={()=>{setAcceptedKey(null);void controller.cancel();}}>Cancel review</button>}</div>
  {state.attempt&&['submitted','unknown'].includes(state.status)&&<button type="button" className={button} disabled={disabled||busy} onClick={()=>void controller.checkReceipt()}>Recover through durable server</button>}
  {state.attempt?.hash&&<p className="mt-4 break-all font-mono text-sm">Synthetic attempt hash: {state.attempt.hash}</p>}
  {state.status==='unknown'&&<p role="alert" className="mt-4 text-amber-900">Do not resubmit. Preserve this attempt for reconciliation. Refreshing does not clear an uncertain attempt.</p>}
 {controller.canCancelReservation()&&<button className={button} onClick={()=>{setAcceptedKey(null);void controller.cancel();}}>Cancel unclaimed server reservation</button>}</section>;
}
