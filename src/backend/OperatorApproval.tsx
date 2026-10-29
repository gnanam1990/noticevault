import type {SavedDraft} from './draft-review';
import type {SerializedTerms} from '../../packages/sdk/src/index';
import {useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import {OperatorApprovalController,type RenewalContext} from './operator-approval';
import {operatorApprovalPins} from './operator-config';
import type {InjectedProvider} from './injected-wallet';
function initialDeposit(draft:SavedDraft|undefined){if(!draft)return undefined;try{const t=draft.terms_json,a=BigInt(t.amountPerPeriod),n=BigInt(t.noticeSeconds),p=BigInt(t.periodSeconds);return String(a+(a*n+p-1n)/p);}catch{return 'Unavailable';}}
const actionLabel={ 'approve-renewal':'Approve one renewal payment','fund-renewal':'Fund the next payment period','start-notice':'Start agreement notice','materialize-notice':'Record missed-checkpoint notice','claim-provider':'Pay accrued earnings to the provider','claim-client-refund':'Refund unearned funding to the client' };
const button='min-h-11 rounded-lg border px-4 py-3 focus-visible:outline-blue-600 disabled:opacity-50';
export function OperatorApproval({workspaceId,draftId,disabled=false,creation,renewal}:{workspaceId:string;draftId:string;disabled?:boolean;creation?:SavedDraft;renewal?:RenewalContext}){
 const controller=useMemo(()=>{
  if(!operatorApprovalPins)return null;
  const provider=Reflect.get(window,'ethereum') as InjectedProvider|undefined;
  if(!provider||typeof provider.request!=='function'||!navigator.locks)return null;
  return new OperatorApprovalController(workspaceId,draftId,operatorApprovalPins,provider,localStorage,navigator.locks,undefined,creation?{terms:creation.terms_json as unknown as SerializedTerms,version:creation.version,docHash:creation.doc_hash}:undefined,renewal);
 },[workspaceId,draftId,creation,renewal]);
 useEffect(()=>()=>controller?.dispose(),[controller]);
 useEffect(()=>{if(disabled)controller?.invalidate();},[controller,disabled]);
 return <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5" aria-label="Connected creation approval">
  <h3 className="text-lg font-semibold">{renewal?actionLabel[renewal.action]:creation?'Create and fund the reviewed agreement':'Exact token approval for creation'}</h3>
  {controller?<ApprovalPanel controller={controller} disabled={disabled} creation={creation} renewal={renewal}/>:<p className="mt-3 text-slate-700">Connected approval is unavailable until independently reviewed deployment configuration and a supported wallet are supplied. No wallet request was made.</p>}
 </section>;
}
function ApprovalPanel({controller,disabled,creation,renewal}:{controller:OperatorApprovalController;disabled:boolean;creation?:SavedDraft;renewal?:RenewalContext}){
 const state=useSyncExternalStore(controller.subscribe,controller.snapshot),[accepted,setAccepted]=useState<string|null>(null),r=state.attempt,p=r?.preparation,busy=state.status==='busy';
 return <><p className="mt-3" role="status" aria-live="polite">{state.message}</p>
 {r&&p&&<dl className="mt-4 grid gap-3 sm:grid-cols-2">{Object.entries({...creation?.terms_json,...p.renewal?.terms,...p.settlement?.terms,...p.settlement?.accounting,Beneficiary:p.settlement?.recipient,PreviewAmountBaseUnits:p.settlement?.amount,NoticeStart:p.settlement?.noticeStart,NoticeEnd:p.settlement?.noticeEnd,NoticeReason:p.settlement?.noticeReason,CallerRule:p.settlement?.callerRule,Action:r.action,Agreement:p.renewal?.agreement??p.settlement?.agreement,ExpectedFundedThrough:p.renewal?.expectedD,RegularFunded:p.renewal?.regularFunded,RenewalAmountBaseUnits:p.renewal?.amount,InitialDepositBaseUnits:initialDeposit(creation),Version:creation?.version,DocumentHash:creation?.doc_hash,Account:r.account,Chain:r.chainId,Target:p.target,Spender:p.approval?.spender,AmountBaseUnits:p.approval?.amount,Nonce:p.networkNonce,NativeValue:p.value,State:r.state,Binding:r.binding}).map(([label,value])=><div key={label}><dt className="font-medium">{label}</dt><dd className="break-all font-mono text-sm">{value}</dd></div>)}</dl>}
 {r?.proof?.outcome&&<details className="mt-3"><summary>Verified execution outcome</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(r.proof.outcome,null,2)}</pre></details>}
   {p&&<details className="mt-3"><summary>Inspect exact calldata</summary><pre className="whitespace-pre-wrap break-all text-sm">{p.data}</pre></details>}
 {state.status==='review'&&<label className="mt-4 flex min-h-11 items-center gap-3"><input type="checkbox" checked={accepted===state.key} onChange={e=>setAccepted(e.target.checked?state.key!:null)}/>{creation?'I reviewed every agreement term, document hash, participants and funding amount. Confirming requests agreement creation and token funding.':'I reviewed the account, chain, token, spender and exact amount. Confirming opens my wallet.'}</label>}
 <div className="mt-4 flex flex-wrap gap-3">
 <button className={button} disabled={disabled||busy||!['idle','error'].includes(state.status)} onClick={()=>{setAccepted(null);void controller.prepare();}}>Connect and review</button>
 <button className={button} disabled={disabled||busy||state.status!=='review'||accepted!==state.key} onClick={()=>{setAccepted(null);void controller.confirm(accepted!);}}>{renewal?'Confirm '+actionLabel[renewal.action].toLowerCase()+' in wallet':creation?'Confirm creation and funding in wallet':'Confirm exact approval in wallet'}</button>
 <button className={button} disabled={busy||!['review','locked'].includes(state.status)} onClick={()=>{setAccepted(null);controller.invalidate();void controller.reconcile(true);}}>Cancel unclaimed reservation</button>
 <button className={button} disabled={busy||['idle','error'].includes(state.status)} onClick={()=>{setAccepted(null);void controller.reconcile();}}>Reconcile saved attempt</button>
 <button className={button} disabled={disabled||busy||!state.attempt||!['confirmed','reverted','cancelled'].includes(state.attempt.state)} onClick={()=>{setAccepted(null);void controller.restart();}}>Archive terminal attempt and start a new review</button>
 </div></>;
}
