/** Draft binding contract. Loaders must enforce current API authorization; this
 * module neither authorizes DB access nor enables live consent or broadcasting.
 * Unsigned preparation is a point-in-time result: reprepare before any signing. */
import {keccak256,toBytes} from 'viem';
import type {NoticeVaultDeployment,TermsInput,WalletContext,TxRequest} from './types.js';
import {SdkStateError} from './types.js';
import type {MinimalPublicClient} from './snapshot.js';
import {observeFactoryForCreation} from './snapshot.js';
import {computeTermsDigest,issueProviderConsent} from './eip712.js';
import {prepareCreateAgreement} from './txprep.js';
import {validateTermsInput} from './codec.js';

export interface DraftConsentSnapshot {
 readonly workspaceId:string; readonly draftId:string; readonly version:number;
 readonly docHash:string; readonly status:string; readonly terms:TermsInput;
 readonly signature: `0x${string}`;
}
export interface DraftPreparationDependencies {
 readonly deployment:NoticeVaultDeployment; readonly rpc:MinimalPublicClient;
 /** Must fetch the current authorized persisted draft and accepted signature. */
 readonly loadCurrent:()=>Promise<DraftConsentSnapshot>;
 /** Obtain current context; never request wallet access or signing here. */
 readonly readWallet:()=>Promise<WalletContext>;
}
const policyKeys=['configIdentity','chainId','factoryAddress','allowlistedToken','expectedFactoryCodeHash','expectedTokenCodeHash','isLive','label'] as const;
export function draftCreationBinding(draft:DraftConsentSnapshot,dep:NoticeVaultDeployment): `0x${string}` {
 if(!draft||typeof draft.workspaceId!=='string'||!draft.workspaceId||typeof draft.draftId!=='string'||!draft.draftId||!Number.isSafeInteger(draft.version)||draft.version<1||!/^0x[0-9a-fA-F]{64}$/.test(draft.docHash)||draft.status!=='accepted'||!/^0x(?:[0-9a-fA-F]{2})+$/.test(draft.signature)) throw new SdkStateError('Invalid accepted draft binding');
 validateTermsInput(draft.terms);
 const policy=policyKeys.map(k=>[k,typeof dep[k]==='bigint'?String(dep[k]):dep[k]??null]);
 return keccak256(toBytes(JSON.stringify([draft.workspaceId,draft.draftId,draft.version,draft.docHash.toLowerCase(),draft.status,computeTermsDigest(draft.terms,dep),draft.signature.toLowerCase(),policy])));
}
function snapshot(draft:DraftConsentSnapshot):DraftConsentSnapshot {return Object.freeze({...draft,terms:Object.freeze({...draft.terms})});}
function sameWallet(a:WalletContext,b:WalletContext):boolean{return !!a&&!!b&&typeof a.account==='string'&&typeof b.account==='string'&&a.account.toLowerCase()===b.account.toLowerCase()&&a.chainId===b.chainId;}
export async function prepareBoundDraftCreation(expectedBinding:string,deps:DraftPreparationDependencies):Promise<{binding:string;request:TxRequest;blockNumber:bigint;blockHash:string;observedAt:number}> {
 const dep=Object.freeze({...deps.deployment});
 const draft=snapshot(await deps.loadCurrent());
 const assertBinding=(current:DraftConsentSnapshot)=>{if(draftCreationBinding(current,dep)!==expectedBinding)throw new SdkStateError('Draft version, terms, consent or policy changed');};
 assertBinding(draft);
 const wallet=Object.freeze({...await deps.readWallet()});
 if(typeof wallet.account!=='string'||wallet.account.toLowerCase()!==draft.terms.client.toLowerCase()||wallet.chainId!==dep.chainId)throw new SdkStateError('Draft client wallet context mismatch');
 const evidence=await observeFactoryForCreation(deps.rpc,dep,draft.terms.client as `0x${string}`,draft.terms.clientNonce,draft.terms);
 const issued=await issueProviderConsent(deps.rpc,draft.terms,dep,draft.signature,evidence);
 if(!issued.consent)throw new SdkStateError('Current canonical provider consent unavailable: '+issued.verifyResult.status);
 // Never return preparation based on a draft/account superseded during RPC work.
 assertBinding(snapshot(await deps.loadCurrent()));
 if(!sameWallet(wallet,await deps.readWallet()))throw new SdkStateError('Wallet context changed during preparation');
 // The SDK enforces issued brands, full policy, terms, deadline, funding and age.
 const request=await prepareCreateAgreement(draft.terms,draft.signature,issued.consent,dep,evidence,wallet.account,0n,wallet);
 return {binding:expectedBinding,request,blockNumber:evidence.block.blockNumber,blockHash:evidence.block.blockHash,observedAt:evidence.block.observedAt};
}
