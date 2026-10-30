import {useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import {OperatorConsentController} from './operator-consent';
import {operatorApprovalPins} from './operator-config';
import type {InjectedProvider} from './injected-wallet';
const button='min-h-11 rounded-lg border px-4 py-3 focus-visible:outline-blue-600 disabled:opacity-50';
export function OperatorConsent({workspaceId,draftId,disabled=false,provider}:{workspaceId:string;draftId:string;disabled?:boolean;provider?:InjectedProvider}){
 const controller=useMemo(()=>{if(!operatorApprovalPins)return null;if(!provider||!navigator.locks)return null;return new OperatorConsentController(workspaceId,draftId,operatorApprovalPins,provider,localStorage,navigator.locks);},[workspaceId,draftId,provider]);
 useEffect(()=>()=>controller?.dispose(),[controller]);useEffect(()=>{if(disabled)controller?.invalidate();},[controller,disabled]);
 return <section className="mt-6 rounded-xl border p-5" aria-label="Provider typed consent"><h3 className="text-lg font-semibold">Provider consent to exact agreement terms</h3>{controller?<Panel controller={controller} disabled={disabled}/>:<p>Connected consent is unavailable until independently reviewed configuration is supplied. No signature request was made.</p>}</section>;
}
function Panel({controller,disabled}:{controller:OperatorConsentController;disabled:boolean}){
 const state=useSyncExternalStore(controller.subscribe,controller.snapshot,controller.snapshot),[checked,setChecked]=useState<string|null>(null),c=state.context,busy=state.status==='busy';
 useEffect(()=>setChecked(null),[controller]);
 return <><p role="status" aria-live="polite">{state.message}</p>{c&&<dl className="mt-4 grid gap-3 sm:grid-cols-2">{Object.entries({...c.terms,Chain:(c.deployment as {chainId:string}).chainId,Factory:(c.deployment as {factoryAddress:string}).factoryAddress,Version:c.version,DocumentHash:c.docHash,TermsDigest:c.termsDigest,ReviewBinding:c.binding}).map(([k,v])=><div key={k}><dt className="font-medium">{k}</dt><dd className="break-all font-mono text-sm">{String(v)}</dd></div>)}</dl>}
 {state.status==='review'&&c&&<label className="my-4 flex min-h-11 items-center gap-3"><input type="checkbox" checked={checked===c.binding} onChange={e=>setChecked(e.target.checked?c.binding:null)}/>I reviewed every term and document hash. Sign provider consent for this exact draft, chain and factory.</label>}
 <div className="mt-4 flex flex-wrap gap-3"><button className={button} disabled={disabled||busy||!['idle','error'].includes(state.status)} onClick={()=>{setChecked(null);void controller.prepare();}}>Connect provider and review</button><button className={button} disabled={disabled||busy||state.status!=='review'||!c||checked!==c.binding} onClick={()=>{setChecked(null);void controller.confirm(checked!);}}>Confirm exact typed consent in wallet</button><button className={button} disabled={disabled||busy} onClick={()=>{setChecked(null);void controller.reconcile();}}>Reconcile saved consent</button></div></>;
}
