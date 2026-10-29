import type {WalletContext} from '../../../packages/sdk/src/index';
import type {AttemptPreparation,Reconciled} from '../../../apps/api/src/attempt-evidence';
import type {ClaimAction,ClaimReview} from './recovery';
import type {RecoveryWallet} from './wallet';
import type {ClaimEntry,ClaimJournal} from './journal';
export interface ClaimDependencies{wallet:RecoveryWallet;journal:ClaimJournal;authorize:()=>Promise<void>;prepare:(action:ClaimAction,address:string,manifest:string,wallet:WalletContext)=>Promise<ClaimReview>;nonce:(wallet:WalletContext)=>Promise<bigint>;reconcile:(preparation:AttemptPreparation,hash?:string)=>Promise<Reconciled>;}
const same=(a:WalletContext,b:WalletContext)=>a.account.toLowerCase()===b.account.toLowerCase()&&a.chainId===b.chainId;
export class RecoveryClaims{
 private epoch=0;private connected:WalletContext|null=null;private reviewValue:ClaimReview|null=null;private inputs:{action:ClaimAction;address:string;manifest:string}|null=null;private stop:()=>void;private noSubmission=new Set<string>();
 constructor(private deps:ClaimDependencies){this.stop=deps.wallet.onChange(()=>{this.connected=null;this.cancel();});}
 dispose(){this.cancel();this.stop();}cancel(){this.epoch++;this.reviewValue=null;this.inputs=null;}
 get review(){return this.reviewValue;}
 async connect(){await this.deps.authorize();const epoch=this.epoch;const c=await this.deps.wallet.connect();if(epoch!==this.epoch)throw Error('STALE_WALLET_CONNECTION');this.connected=c;return c;}
 async prepare(action:ClaimAction,address:string,manifest:string){if(!this.connected)throw Error('EXPLICIT_CONNECTION_REQUIRED');this.cancel();const epoch=this.epoch;await this.deps.authorize();const current=await this.deps.wallet.current();if(!same(current,this.connected))throw Error('WALLET_CONTEXT_CHANGED');const review=await this.deps.prepare(action,address,manifest,current);if(epoch!==this.epoch||!same(current,await this.deps.wallet.current()))throw Error('STALE_REVIEW');this.inputs={action,address,manifest};this.reviewValue=review;return review;}
 async entries(){return this.deps.journal.atomic(async rows=>structuredClone(rows));}
 async confirm(reviewId:string):Promise<ClaimEntry>{
 const reviewed=this.reviewValue,inputs=this.inputs,epoch=this.epoch;if(!reviewed||!inputs||reviewed.id!==reviewId||Date.now()-reviewed.createdAt>30000||Date.now()<reviewed.createdAt)throw Error('EXPIRED_OR_MISSING_REVIEW');
 // Consume this deliberate confirmation before any asynchronous operation.
 this.reviewValue=null;this.inputs=null;
 return this.deps.journal.atomic(async(entries,save)=>{
 await this.deps.authorize();
 for(const entry of entries){if(this.noSubmission.has(entry.id))continue;const resolved=await this.deps.reconcile(entry.preparation,entry.hash).catch(()=>({state:'unknown'} as Reconciled));if(!['confirmed','reverted'].includes(resolved.state)){entry.state=resolved.state;save(entries);throw Error('UNRESOLVED_ATTEMPT');}entry.state=resolved.state;entry.hash=resolved.hash;entry.proof=resolved.proof;save(entries);}
 const wallet=await this.deps.wallet.current();if(wallet.account.toLowerCase()!==reviewed.account||String(wallet.chainId)!==reviewed.chainId||epoch!==this.epoch)throw Error('STALE_REVIEW');
 const fresh=await this.deps.prepare(inputs.action,inputs.address,inputs.manifest,wallet);if(fresh.binding!==reviewed.binding||epoch!==this.epoch)throw Error('STALE_REVIEW');
 const nonce=await this.deps.nonce(wallet);if(typeof nonce!=='bigint'||nonce<0n||nonce>=(1n<<64n))throw Error('INVALID_NETWORK_NONCE');
 if(!same(wallet,await this.deps.wallet.current())||epoch!==this.epoch)throw Error('STALE_REVIEW');
 const preparation:AttemptPreparation={source:fresh.source,workspaceId:'independent-recovery',actor:fresh.account,chainId:fresh.chainId,resource:fresh.target,action:fresh.action,policyHash:fresh.policyHash,cycleKey:fresh.id,networkNonce:String(nonce),target:fresh.target,data:fresh.data,value:'0',issuedAt:Date.now(),business:{termsHash:fresh.termsHash,termsDigest:fresh.termsDigest,agreementCodeHash:fresh.agreementCodeHash}};
 const entry:ClaimEntry={id:crypto.randomUUID(),preparation,state:'unknown'};entries.push(entry);save(entries);
 // Once persisted, crashes/timeouts cannot make this operation retryable.
 try{const hash=await this.deps.wallet.send({from:fresh.account,chainId:'0x'+BigInt(fresh.chainId).toString(16),to:fresh.target,data:fresh.data,value:'0x0',nonce:'0x'+nonce.toString(16)});if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('UNKNOWN_SUBMISSION');entry.hash=hash;entry.state='submitted';save(entries);}
 catch(error){if(error&&typeof error==='object'&&'code' in error&&error.code===4001){entry.state='rejected';save(entries);this.noSubmission.add(entry.id);}else{entry.state='unknown';try{save(entries);}catch{/* Prior durable unknown entry remains authoritative. */}}}
 return structuredClone(entry);
 });
 }
 async reconcile(id:string,candidateHash?:string){if(candidateHash!==undefined&&!/^0x[0-9a-f]{64}$/i.test(candidateHash))throw Error('INVALID_CANDIDATE_HASH');return this.deps.journal.atomic(async(entries,save)=>{const entry=entries.find(e=>e.id===id);if(!entry)throw Error('ATTEMPT_NOT_FOUND');const result=await this.deps.reconcile(entry.preparation,entry.hash??candidateHash).catch(()=>({state:'unknown'} as Reconciled));entry.state=result.state;entry.hash=result.hash??entry.hash;entry.proof=result.proof;save(entries);return structuredClone(entry);});}
}
