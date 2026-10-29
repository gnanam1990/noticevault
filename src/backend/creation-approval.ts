import type {Address} from 'viem';
import {encodeFunctionData} from 'viem';
import {observeFactoryForCreation,prepareApproveForCreation,serializeTerms} from '../../packages/sdk/src/index.js';
import type {MinimalPublicClient,NoticeVaultDeployment,TermsInput,WalletContext} from '../../packages/sdk/src/index.js';
import type {SubmissionReview} from './transaction-review.js';
export type CreationApprovalContext={source:'SYNTHETIC';workspaceId:string;draftId:string;version:number;documentHash:string;authorizationKey:string;sessionAccount:string;sessionChainId:string;sessionExpiresAt:number;terms:TermsInput;policy:NoticeVaultDeployment};
export type CreationApprovalDependencies={source:'SYNTHETIC';rpc:MinimalPublicClient;context(signal:AbortSignal):Promise<CreationApprovalContext>;wallet():Promise<WalletContext>};
export type CreationApprovalReview=SubmissionReview&Readonly<{spender:string;amount:string;reserve:string;version:number;terms:Readonly<Record<string,string>>;blockNumber:string;blockHash:string}>;
function check(v:unknown,m:string):asserts v{if(!v)throw new Error(m);}
function stable(v:unknown):string{if(typeof v==='bigint')return JSON.stringify(String(v));if(Array.isArray(v))return '['+v.map(stable).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable((v as Record<string,unknown>)[k])).join(',')+'}';return JSON.stringify(v)??'null';}
function copy(c:CreationApprovalContext){return Object.freeze({...c,terms:Object.freeze({...c.terms}),policy:Object.freeze({...c.policy})});}
/** Isolated synthetic adapter only. No endpoints, discovery or production fallback. */
export function syntheticCreationApprovalLoader(deps:CreationApprovalDependencies){return async(signal:AbortSignal):Promise<CreationApprovalReview>=>{
 check(deps.source==='SYNTHETIC','Synthetic construction required');const c=copy(await deps.context(signal)),w=Object.freeze({...await deps.wallet()});
 check(c.source==='SYNTHETIC'&&c.policy.isLive===false&&c.policy.configIdentity!=='LOCAL_FIXTURE'&&c.authorizationKey&&c.workspaceId&&c.draftId&&Number.isSafeInteger(c.version)&&c.version>0,'Authorized draft and verified policy required');
 check(c.documentHash.toLowerCase()===c.terms.termsDocumentHash.toLowerCase()&&Number.isSafeInteger(c.sessionExpiresAt)&&c.sessionExpiresAt>Date.now(),'Draft or session expired');
 check(w.account.toLowerCase()===c.sessionAccount.toLowerCase()&&w.account.toLowerCase()===c.terms.client.toLowerCase()&&w.chainId===c.policy.chainId&&String(w.chainId)===c.sessionChainId,'Client, account or chain changed');
 const e=await observeFactoryForCreation(deps.rpc,c.policy,c.terms.client as Address,BigInt(c.terms.clientNonce),c.terms);
 check(e.status==='ok'&&e.requestedTerms,'Trusted factory evidence unavailable');
 const after=copy(await deps.context(signal)),current=await deps.wallet(),b=await deps.rpc.getBlock({blockNumber:e.block.blockNumber}),chain=await deps.rpc.getChainId();
 check(!signal.aborted&&stable(c)===stable(after)&&after.sessionExpiresAt>Date.now()&&stable(w)===stable(current),'Draft, session, policy or wallet changed');
 check(Number.isSafeInteger(chain)&&BigInt(chain)===c.policy.chainId&&b.number===e.block.blockNumber&&b.hash?.toLowerCase()===e.block.blockHash.toLowerCase()&&b.timestamp===e.block.blockTimestamp,'Canonical evidence changed');
 const tx=prepareApproveForCreation(c.policy,e,current.account,0n,current),data=encodeFunctionData({abi:tx.abi,functionName:tx.functionName,args:tx.args});
 const amount=String(tx.args[1]),reserve=String(BigInt(amount)-BigInt(c.terms.amountPerPeriod));
 const scopeKey=stable({action:'approve-creation',workspaceId:c.workspaceId,draftId:c.draftId,version:c.version,documentHash:c.documentHash,terms:c.terms,policy:c.policy});
 const key=stable({scopeKey,wallet:w,authorization:c.authorizationKey,block:e.block,to:tx.to,data});
 return Object.freeze({source:'SYNTHETIC',key,scopeKey,cycleKey:String(c.terms.clientNonce),account:current.account,chainId:String(current.chainId),target:tx.to,value:'0',data,spender:String(tx.args[0]),amount,reserve,version:c.version,terms:Object.freeze({...serializeTerms(e.requestedTerms)}),blockNumber:String(e.block.blockNumber),blockHash:e.block.blockHash});
};}
