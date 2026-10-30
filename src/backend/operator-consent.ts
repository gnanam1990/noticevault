import {onWalletSelectionChange} from './wallet-selection';
import {parseObject,stringValue} from './response-values';
import {keccak256,type Hex} from 'viem';
import {buildTypedData,computeTermsDigest,parseArcManifest,parseTerms,type SerializedTerms} from '../../packages/sdk/src/index';
import {injectedWallet,type InjectedProvider} from './injected-wallet';
import type {ApprovalPins} from './operator-approval';
export type ConsentContext={source:'OPERATOR_CONFIGURED';policyHash:string;workspaceId:string;draftId:string;version:number;docHash:string;binding:string;termsDigest:string;terms:SerializedTerms;deployment:unknown;accepted:boolean;signatureHash:string|null};
export class OperatorConsentClient{
 constructor(private fetcher:typeof fetch=fetch){}
 async request(ws:string,id:string,body?:{binding:string;signature:string}):Promise<ConsentContext>{
  if(!/^[0-9a-f-]{36}$/i.test(ws)||!/^[0-9a-f-]{36}$/i.test(id))throw Error('Invalid draft identity');
  const r=await this.fetcher('/api/workspaces/'+ws+'/drafts/'+id+'/provider-consent',{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'content-type':'application/json','x-requested-with':'XMLHttpRequest'},...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok)throw Error('Consent request rejected ('+r.status+').');return r.json() as Promise<ConsentContext>;
 }
}
type Journal={binding:string;account:string;chainId:string;signature?:string};
function parseJournal(raw:string):Journal {const j=parseObject(raw),binding=stringValue(j.binding),account=stringValue(j.account),chainId=stringValue(j.chainId);if(!binding||!/^0x[0-9a-f]{40}$/i.test(account)||!/^[1-9][0-9]*$/.test(chainId))throw Error('Invalid consent journal');const signature=j.signature===undefined?undefined:stringValue(j.signature);if(signature!==undefined&&!/^0x(?:[0-9a-f]{2})+$/i.test(signature))throw Error('Invalid consent signature');return {binding,account,chainId,...(signature===undefined?{}:{signature})};}
type State={status:'idle'|'busy'|'review'|'locked'|'accepted'|'error';message:string;context?:ConsentContext};
type Store=Pick<Storage,'getItem'|'setItem'>;type Locks={request:<T>(name:string,fn:()=>Promise<T>)=>Promise<T>};
const json=(v:unknown)=>JSON.stringify(v,(_k:string,x:unknown)=>typeof x==='bigint'?String(x):x);
export class OperatorConsentController{
 private state:State={status:'idle',message:'Connect the provider wallet to review exact typed consent.'};private listeners=new Set<()=>void>();private epoch=0;private expiry=0;private unsubscribe:(()=>void)|undefined;readonly storageKey:string;
 constructor(private ws:string,private draft:string,private pins:ApprovalPins,private provider:InjectedProvider,private storage:Store,private locks:Locks,private api=new OperatorConsentClient()){
  this.storageKey=['noticevault:provider-consent:v1',pins.chainId,ws,draft].join(':');try{if(storage.getItem(this.storageKey))this.state={status:'locked',message:'Saved signature attempt; reconcile without signing again.'};}catch{this.state={status:'locked',message:'Journal unavailable; signing blocked.'};}
  const walletDetach=injectedWallet(provider).onChange?.(()=>this.invalidate());const selectionDetach=onWalletSelectionChange(()=>this.invalidate());this.unsubscribe=()=>{walletDetach?.();selectionDetach();};
 }
 snapshot=()=>this.state;subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>this.listeners.delete(fn);};private set(s:State){this.state=s;for(const f of this.listeners)f();}
 invalidate(){this.epoch++;this.set({status:'locked',message:'Wallet or draft context changed. Reconcile saved consent; do not sign again.'});}dispose(){this.epoch++;this.unsubscribe?.();this.listeners.clear();}
 private save(j:Journal){const text=JSON.stringify(j);this.storage.setItem(this.storageKey,text);if(this.storage.getItem(this.storageKey)!==text)throw Error('Signature journal unavailable');}
 private check(v:ConsentContext,account:string){
  if(v.source!=='OPERATOR_CONFIGURED'||v.policyHash!==this.pins.policyHash||v.workspaceId!==this.ws||v.draftId!==this.draft||!Number.isSafeInteger(v.version)||v.version<1||!/^0x[0-9a-f]{64}$/i.test(v.binding))throw Error('Consent identity mismatch');
  const dep=parseArcManifest(json(v.deployment)),terms=parseTerms(v.terms);
  if(String(dep.chainId)!==this.pins.chainId||dep.factoryAddress?.toLowerCase()!==this.pins.factory.toLowerCase()||dep.allowlistedToken?.toLowerCase()!==this.pins.token.toLowerCase()||terms.provider.toLowerCase()!==account.toLowerCase()||terms.token.toLowerCase()!==this.pins.token.toLowerCase()||terms.termsDocumentHash.toLowerCase()!==v.docHash.toLowerCase()||computeTermsDigest(terms,dep).toLowerCase()!==v.termsDigest.toLowerCase())throw Error('Exact provider, chain, terms and factory required');
  return buildTypedData(terms,dep);
 }
 async prepare(){if(!['idle','error'].includes(this.state.status))return;const epoch=++this.epoch;this.set({status:'busy',message:'Connecting provider and loading exact draft.'});try{if(this.storage.getItem(this.storageKey))throw Error('Saved consent requires reconciliation');const w=await injectedWallet(this.provider).connect();if(String(w.chainId)!==this.pins.chainId)throw Error('Wrong wallet chain');const c=await this.api.request(this.ws,this.draft);this.check(c,w.address);if(epoch!==this.epoch)throw Error('Context changed');this.expiry=Date.now()+60000;this.set({status:c.accepted?'accepted':'review',message:c.accepted?'Provider consent is already accepted.':'Review every term, document hash, provider, chain and factory before signing.',context:c});}catch(e){this.set({status:'error',message:e instanceof Error?e.message:'Consent unavailable'});}}
 async confirm(binding:string){const review=this.state.context;if(this.state.status!=='review'||!review||review.binding!==binding)return;const epoch=this.epoch;this.set({status:'busy',message:'Rechecking exact consent before signature.'});let requested=false;
  try{await this.locks.request(this.storageKey,async()=>{
   if(this.storage.getItem(this.storageKey))throw Error('Existing signature attempt is locked');
   const wallet=await injectedWallet(this.provider).context(),current=await this.api.request(this.ws,this.draft);const typed=this.check(current,wallet.address);
   if(current.binding!==binding||String(wallet.chainId)!==this.pins.chainId||epoch!==this.epoch||Date.now()>this.expiry)throw Error('Draft, account, chain or review changed');
   if(current.accepted){this.set({status:'accepted',message:'Consent already accepted; no signature requested.',context:current});return;}
   const j:Journal={binding,account:wallet.address,chainId:this.pins.chainId};this.save(j);requested=true;
   const domainType=[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}];
   const signature=await this.provider.request({method:'eth_signTypedData_v4',params:[wallet.address,json({...typed,types:{EIP712Domain:domainType,...typed.types}})]});
   if(typeof signature!=='string'||!/^0x(?:[0-9a-f]{2}){1,8192}$/i.test(signature))throw Error('Signature response unknown');this.save({...j,signature});
   const after=await injectedWallet(this.provider).context();if(epoch!==this.epoch||Date.now()>this.expiry||after.address.toLowerCase()!==wallet.address.toLowerCase()||String(after.chainId)!==j.chainId)throw Error('Context changed after signature; stored, not submitted');
   const accepted=await this.api.request(this.ws,this.draft,{binding,signature});this.check(accepted,wallet.address);if(!accepted.accepted||accepted.binding!==binding||accepted.signatureHash!==keccak256(signature as Hex))throw Error('Consent acceptance unknown');if(epoch!==this.epoch)throw Error('Context changed after acceptance; reconcile');this.set({status:'accepted',message:'Exact provider consent persisted. No agreement transaction was sent.',context:accepted});
  });}catch(error){
   const denied=requested&&epoch===this.epoch&&error&&typeof error==='object'&&Reflect.get(error,'code')===4001;
   if(denied){try{const old=this.storage.getItem(this.storageKey),history=this.storageKey+':denied:'+crypto.randomUUID();this.storage.setItem(history,old??'');if(this.storage.getItem(history)!==(old??''))throw Error('History unavailable');this.storage.setItem(this.storageKey,'');if(this.storage.getItem(this.storageKey)!=='')throw Error('Journal clear failed');this.set({status:'idle',message:'Signature denied. Review again to make a new explicit request.'});return;}catch{/* Preserve lock when journal is unavailable. */}}
   this.set({status:'locked',message:error instanceof Error?error.message:'Signature attempt unknown; reconcile without signing again.'});
  }
 }
 async reconcile(){if(this.state.status==='busy')return;const epoch=this.epoch;this.set({status:'busy',message:'Reconciling saved provider consent without a new signature.'});try{await this.locks.request(this.storageKey,async()=>{
  const raw=this.storage.getItem(this.storageKey),j:Journal|null=raw?parseJournal(raw):null;const wallet=await injectedWallet(this.provider).context();if(String(wallet.chainId)!==this.pins.chainId||j&&(wallet.address.toLowerCase()!==j.account.toLowerCase()||j.chainId!==this.pins.chainId))throw Error('Restore the reviewed provider wallet context');
  let c=await this.api.request(this.ws,this.draft);this.check(c,wallet.address);if(j&&c.binding!==j.binding)throw Error('Saved consent belongs to a changed draft; preserved');
  if(!c.accepted&&j?.signature){if(epoch!==this.epoch)throw Error('Context changed');c=await this.api.request(this.ws,this.draft,{binding:j.binding,signature:j.signature});this.check(c,wallet.address);}
  if(!c.accepted||j?.signature&&c.signatureHash!==keccak256(j.signature as Hex))throw Error('Signature outcome remains unknown; no automatic repeat');
  if(epoch!==this.epoch)throw Error('Context changed during reconciliation');this.set({status:'accepted',message:'Persisted provider consent verified. No new signature requested.',context:c});
 });}catch(e){this.set({status:'locked',message:e instanceof Error?e.message:'Consent reconciliation unavailable'});}}
}
