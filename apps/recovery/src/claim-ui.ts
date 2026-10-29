import {parseRecoveryConfig} from './config';
import {trustedConfigText,trustedFinalityPolicy} from './trusted-config';
import {trustedArtifactVerifier} from './trusted-artifacts';
import {composeRecoveryClaims} from './composition';
import {browserClaimJournal} from './journal';
import type {RecoveryClaims} from './claims';
import type {Eip1193} from './wallet';
import type {ClaimAction} from './recovery';
import {stringify} from './recovery';
export function installClaimUi(){
 const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
 const connect=el<HTMLButtonElement>('connect-claim'),prepare=el<HTMLButtonElement>('prepare-claim'),confirm=el<HTMLButtonElement>('confirm-claim'),check=el<HTMLInputElement>('claim-confirm-check'),view=el<HTMLPreElement>('claim-review'),status=el('claim-status'),error=el('claim-error'),select=el<HTMLSelectElement>('attempt-select');let runtime:RecoveryClaims|undefined,reviewId:string|undefined;
 connect.disabled=!trustedConfigText||!trustedFinalityPolicy;
 function clear(){reviewId=undefined;check.checked=false;confirm.disabled=true;view.hidden=true;runtime?.cancel();}
 function failed(e:unknown){error.hidden=false;error.textContent=e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'RECOVERY_ACTION_UNAVAILABLE';error.focus();}
 function get(){if(runtime)return runtime;if(!trustedConfigText||!trustedFinalityPolicy)throw Error('RECOVERY_NOT_CONFIGURED');const provider=(window as unknown as {ethereum?:Eip1193&{providers?:unknown[]}}).ethereum;if(!provider?.request)throw Error('WALLET_UNAVAILABLE');if(provider.providers&&provider.providers.length>1)throw Error('SELECT_ONE_WALLET_IN_EXTENSION');runtime=composeRecoveryClaims(parseRecoveryConfig(trustedConfigText),trustedFinalityPolicy,provider,browserClaimJournal(localStorage,navigator.locks),trustedArtifactVerifier);for(const event of ['accountsChanged','chainChanged','disconnect'])provider.on?.(event,()=>{clear();prepare.disabled=true;status.textContent='Wallet context changed. Reconnect and review again; saved attempts remain.';});return runtime;}
 async function refresh(){const entries=await get().entries();const chosen=select.value;select.replaceChildren();for(const entry of entries){const option=document.createElement('option');option.value=entry.id;option.textContent=entry.id+' — '+entry.preparation.action+' — '+entry.state;select.append(option);}if(entries.some(e=>e.id===chosen))select.value=chosen;el('attempt-details').textContent=stringify(entries);}
 connect.addEventListener('click',async()=>{error.hidden=true;connect.disabled=true;try{const w=await get().connect();status.textContent='Connected caller '+w.account+' on chain '+w.chainId+'. No transaction sent.';prepare.disabled=false;}catch(e){failed(e);}finally{connect.disabled=!trustedConfigText||!trustedFinalityPolicy;}});
 prepare.addEventListener('click',async()=>{clear();error.hidden=true;prepare.disabled=true;try{const r=await get().prepare(el<HTMLSelectElement>('claim-action').value as ClaimAction,el<HTMLInputElement>('agreement').value,el<HTMLTextAreaElement>('manifest').value);reviewId=r.id;view.textContent=stringify({action:r.action,source:r.source,caller:r.account,chainId:r.chainId,target:r.target,fixedBeneficiary:r.recipient,observedAmountBaseUnits:r.amount,nativeValue:r.value,calldata:r.data,termsDigest:r.termsDigest,agreementCodeHash:r.agreementCodeHash,block:r.report.observation,notice:r.report.state,warning:'Actual transfer is computed at execution. This review expires in 30 seconds. Unknown prior attempts block another request.'});view.hidden=false;view.focus();}catch(e){failed(e);}finally{prepare.disabled=false;}});
 check.addEventListener('change',()=>{confirm.disabled=!check.checked||!reviewId;});
 confirm.addEventListener('click',async()=>{if(!check.checked||!reviewId)return;const id=reviewId;reviewId=undefined;confirm.disabled=true;check.checked=false;error.hidden=true;status.textContent='Persisting attempt before the wallet request. Do not retry if interrupted.';try{const entry=await get().confirm(id);status.textContent='Attempt '+entry.state+'. Submitted or unknown is not paid. Use canonical verification before any later cycle.';await refresh();}catch(e){failed(e);status.textContent='No retry permission established. Saved unknown attempts remain blocked.';}});
 el('cancel-claim').addEventListener('click',()=>{clear();status.textContent='Review cancelled. This does not cancel a wallet request already started or erase attempts.';});
 el('recovery-form').addEventListener('input',clear);el('claim-action').addEventListener('change',clear);
 el('refresh-attempts').addEventListener('click',()=>{refresh().catch(failed);});
 el('reconcile-claim').addEventListener('click',async()=>{error.hidden=true;try{if(!select.value)throw Error('SELECT_ATTEMPT');const hint=el<HTMLInputElement>('candidate-hash').value.trim();const r=await get().reconcile(select.value,hint||undefined);status.textContent='Canonical result: '+r.state+(r.proof?.outcome?' / '+r.proof.outcome.kind:'')+'. No new wallet request was sent.';await refresh();}catch(e){failed(e);}});
}
