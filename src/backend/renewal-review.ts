import {parseAttemptEntries} from './attempt-values';
import {encodeFunctionData} from 'viem';
import type {Address} from 'viem';
import {observeAgreement,prepareApproveForRenewal,prepareFundNextPeriod,serializeTerms} from '../../packages/sdk/src/index.js';
import type {MinimalPublicClient,NoticeVaultDeployment,TermsInput,WalletContext} from '../../packages/sdk/src/index.js';
import type {SubmissionReview} from './transaction-review.js';
export type RenewalAction='approve-renewal'|'fund-renewal';
export const agreementActions=['approve-renewal','fund-renewal','start-notice','materialize-notice','claim-provider','claim-client-refund'] as const;
export type AgreementAction=typeof agreementActions[number];
export type RenewalReview=SubmissionReview&Readonly<{action:RenewalAction;agreement:string;token:string;amount:string;spender:string|null;expectedD:string;terms:Readonly<Record<string,string>>;blockNumber:string;blockHash:string;effect:string}>;
export type SyntheticRenewalContext={source:'SYNTHETIC';authorizationKey:string;sessionAccount:string;sessionChainId:string;sessionExpiresAt:number;agreement:Address;terms:TermsInput;policy:NoticeVaultDeployment};
export type SyntheticRenewalDependencies={source:'SYNTHETIC';rpc:MinimalPublicClient;context:(signal:AbortSignal)=>Promise<SyntheticRenewalContext>;wallet:()=>Promise<WalletContext>};
function requireValue(value:unknown,message:string):asserts value{if(!value)throw new Error(message);}
function stable(value:unknown):string{if(typeof value==='bigint')return JSON.stringify(String(value));if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable((value as Record<string,unknown>)[k])).join(',')+'}';return JSON.stringify(value)??'null';}
function frozenContext(c:SyntheticRenewalContext){return Object.freeze({...c,terms:Object.freeze({...c.terms}),policy:Object.freeze({...c.policy})});}
export async function syntheticAgreementObservation(deps:SyntheticRenewalDependencies,signal:AbortSignal){
 requireValue(deps.source==='SYNTHETIC','Synthetic provider construction required');
  const c=frozenContext(await deps.context(signal));
  requireValue(c.source==='SYNTHETIC'&&c.policy.isLive===false&&c.policy.configIdentity!=='LOCAL_FIXTURE'&&typeof c.authorizationKey==='string'&&c.authorizationKey.length>0,'Verified non-live policy and authorized context required');
  requireValue(Number.isSafeInteger(c.sessionExpiresAt)&&c.sessionExpiresAt>Date.now()&&c.sessionChainId===String(c.policy.chainId),'Session expired or chain changed');
  const wallet=Object.freeze({...await deps.wallet()});
  requireValue(/^0x[0-9a-f]{40}$/i.test(wallet.account)&&BigInt(wallet.account)!==0n&&wallet.account.toLowerCase()===c.sessionAccount.toLowerCase()&&wallet.chainId===c.policy.chainId,'Session and wallet differ');
  // Token balance/allowance evidence belongs to the immutable client, not the permissionless caller.
  requireValue(/^0x[0-9a-f]{40}$/i.test(c.terms.client)&&BigInt(c.terms.client)!==0n,'Invalid immutable client');
  const evidence=await observeAgreement(deps.rpc,c.policy,c.agreement,c.terms,c.terms.client as Address);
  requireValue(evidence.status==='ok'&&evidence.observedTerms&&evidence.domainSnapshot,'Trusted agreement evidence unavailable');
  const after=frozenContext(await deps.context(signal));requireValue(stable(after)===stable(c)&&after.sessionExpiresAt>Date.now(),'Authorization, terms or deployment policy changed');
  const b=await deps.rpc.getBlock({blockNumber:evidence.block.blockNumber});const chain=await deps.rpc.getChainId();
  requireValue(Number.isSafeInteger(chain)&&BigInt(chain)===c.policy.chainId&&b.number===evidence.block.blockNumber&&b.hash?.toLowerCase()===evidence.block.blockHash.toLowerCase()&&b.timestamp===evidence.block.blockTimestamp,'Canonical evidence changed');
  const current=Object.freeze({...await deps.wallet()});requireValue(!signal.aborted&&current.account.toLowerCase()===wallet.account.toLowerCase()&&current.chainId===wallet.chainId&&c.sessionExpiresAt>Date.now(),'Wallet, session or request changed');
 requireValue(evidence.contractPreview,'Pinned preview missing');
 return {c,current,evidence,terms:evidence.observedTerms,snapshot:evidence.domainSnapshot,preview:evidence.contractPreview};
}
/** Explicit isolated construction only: no endpoint, wallet discovery or production fallback. */
export function syntheticRenewalLoader(action:RenewalAction,deps:SyntheticRenewalDependencies){
 requireValue(deps.source==='SYNTHETIC'&&['approve-renewal','fund-renewal'].includes(action),'Unsupported synthetic action');
 return async(signal:AbortSignal):Promise<RenewalReview>=>{
  const {c,current,evidence}=await syntheticAgreementObservation(deps,signal);
  requireValue(evidence.observedTerms&&evidence.domainSnapshot,'Agreement evidence incomplete');
  const expectedD=evidence.domainSnapshot.D;
  const tx=action==='approve-renewal'?prepareApproveForRenewal(c.agreement,c.policy,evidence,current.account,0n,current):prepareFundNextPeriod(expectedD,c.agreement,c.policy,evidence,current.account,0n,current);
  const data=encodeFunctionData({abi:tx.abi,functionName:tx.functionName,args:tx.args});const terms=Object.freeze({...serializeTerms(evidence.observedTerms)});const amount=String(evidence.observedTerms.amountPerPeriod);
  const key=stable({action,context:c,wallet:current,blockNumber:evidence.block.blockNumber,blockHash:evidence.block.blockHash,expectedD,to:tx.to,data});
  const scopeKey=stable({action,agreement:c.agreement.toLowerCase(),terms,policy:c.policy});
  return Object.freeze({source:'SYNTHETIC',key,scopeKey,cycleKey:String(expectedD),action,account:current.account,chainId:String(current.chainId),target:tx.to,value:'0',data,agreement:c.agreement,token:evidence.observedTerms.token,amount,spender:action==='approve-renewal'?c.agreement:null,expectedD:String(expectedD),terms,blockNumber:String(evidence.block.blockNumber),blockHash:evidence.block.blockHash,effect:action==='approve-renewal'?'Sets agreement allowance to exactly one payment amount. Does not fund or extend the agreement.':'Transfers one payment amount using existing agreement allowance and calls fundNextPeriod with the reviewed deadline. No approval is included.'});
 };
}

/** New synthetic namespace only; retains history and blocks all actions on unresolved attempts. */
export function renewalAttemptStore(storage:Pick<Storage,'getItem'|'setItem'>,scope:string,action:AgreementAction):import('./transaction-review.js').AttemptStore{
 const key='noticevault:synthetic-renewal:v1:'+scope;
 type Entry={action:AgreementAction;attempt:import('./transaction-review.js').Attempt};
 function entries():Entry[]{const raw=storage.getItem(key);return raw===null?[]:parseAttemptEntries(raw,agreementActions);}
 return {read(){const all=entries(),latest=new Map<string,Entry>();for(const e of all)latest.set(e.attempt.key,e);for(const e of latest.values())if(['unknown','submitted'].includes(e.attempt.status))return e.attempt;return [...all].reverse().find(e=>e.action===action)?.attempt??null;},write(attempt){requireValue(attempt.source==='SYNTHETIC','Synthetic journal only');const all=entries();all.push({action,attempt:{...attempt}});storage.setItem(key,JSON.stringify(all));}};
}
