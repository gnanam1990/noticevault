import {keccak256,encodeFunctionData,encodeAbiParameters,parseAbiParameters,toHex} from 'viem';
import type {Hex} from 'viem';
import {observeAgreement,computeTermsDigest,serializeTerms,prepareClaimProvider,prepareClaimClientRefund} from '../../../packages/sdk/src/index';
import type {MinimalPublicClient,NoticeVaultDeployment,VerifiedObservation,WalletContext} from '../../../packages/sdk/src/index';
import {parseArcManifest} from '../../../packages/sdk/src/manifest';
const reportEvidence=new WeakMap<object,{observation:VerifiedObservation;policy:RecoveryPolicy}>();
export type RecoveryPolicy={deployment:NoticeVaultDeployment;agreementCodeHash:Hex;provenance:'SYNTHETIC'|'OPERATOR_CONFIGURED';contextHash?:Hex};
export function stringify(value:unknown):string{return JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2);}
function equal(a:unknown,b:unknown):boolean {if(a===b)return true;if(typeof a!==typeof b||!a||!b||typeof a!=='object')return false;if(Array.isArray(a)!==Array.isArray(b))return false;const x=a as Record<string,unknown>,y=b as Record<string,unknown>;const keys=Object.keys(x);return keys.length===Object.keys(y).length&&keys.every(k=>Object.hasOwn(y,k)&&equal(x[k],y[k]));}
async function bounded<T>(fn:()=>Promise<T>):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([fn(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('PROVIDER_UNAVAILABLE')),5000)})]);}finally{clearTimeout(timer);}}
function snapshot(r:MinimalPublicClient):MinimalPublicClient{return Object.freeze({getChainId:r.getChainId.bind(r),getBlock:r.getBlock.bind(r),getBytecode:r.getBytecode.bind(r),readContract:r.readContract.bind(r)});}
export function createRecoveryReader(input:RecoveryPolicy,primary:MinimalPublicClient,verification:MinimalPublicClient){
 if(primary===verification)throw Error('DISTINCT_READERS_REQUIRED');
 const dep=parseArcManifest(stringify(input.deployment));
 if(!/^0x[0-9a-fA-F]{64}$/.test(input.agreementCodeHash)||/^0x0{64}$/.test(input.agreementCodeHash))throw Error('MISSING_AGREEMENT_CODE_HASH');
 if(!['SYNTHETIC','OPERATOR_CONFIGURED'].includes(input.provenance))throw Error('INVALID_PROVENANCE');
 const config=Object.freeze({...input,deployment:dep});const a=snapshot(primary),b=snapshot(verification);
 async function pair<T>(x:()=>Promise<T>,y:()=>Promise<T>):Promise<T>{const [l,r]=await Promise.all([bounded(x),bounded(y)]);if(!equal(l,r))throw Error('PROVIDER_DISAGREEMENT');return l;}
 const rpc:MinimalPublicClient={getChainId:()=>pair(()=>a.getChainId(),()=>b.getChainId()),getBlock:(q:{blockTag:'latest'}|{blockNumber:bigint})=>pair(()=>a.getBlock(q as {blockNumber:bigint}),()=>b.getBlock(q as {blockNumber:bigint})),getBytecode:q=>pair(()=>a.getBytecode(q),()=>b.getBytecode(q)),readContract:q=>pair(()=>a.readContract(q),()=>b.readContract(q))};
 return Object.freeze({async inspect(address:string,importedManifest?:string){
 if(!/^0x[0-9a-fA-F]{40}$/.test(address)||/^0x0{40}$/.test(address))throw Error('INVALID_AGREEMENT');
 if(importedManifest!==undefined&&!equal(parseArcManifest(importedManifest),dep))throw Error('MANIFEST_POLICY_MISMATCH');
 const agreement=address as Hex;const obs=await observeAgreement(rpc,dep,agreement);
 if(obs.status!=='ok'||!obs.domainMatchesContract||!obs.observedTerms||!obs.domainSnapshot)throw Error('EVIDENCE_UNAVAILABLE:'+obs.status);
 const block=obs.block,now=Date.now();if(!Number.isSafeInteger(block.observedAt)||now-block.observedAt>30000||block.blockTimestamp>BigInt(Math.floor(now/1000)+30)||BigInt(Math.floor(now/1000))-block.blockTimestamp>7200n)throw Error('STALE_EVIDENCE');
 const code=await rpc.getBytecode({address:agreement,blockNumber:block.blockNumber});if(!code||code==='0x'||keccak256(code)!==config.agreementCodeHash)throw Error('AGREEMENT_CODE_MISMATCH');
 const factory=await rpc.readContract({address:agreement,blockNumber:block.blockNumber,abi:[{type:'function',name:'factory',stateMutability:'view',inputs:[],outputs:[{type:'address'}]}],functionName:'factory'});
 if(typeof factory!=='string'||factory.toLowerCase()!==dep.factoryAddress!.toLowerCase())throw Error('AGREEMENT_FACTORY_MISMATCH');
 const end=await rpc.getBlock({blockNumber:block.blockNumber});if(end.number!==block.blockNumber||end.hash!==block.blockHash||end.timestamp!==block.blockTimestamp||await rpc.getChainId()!==Number(dep.chainId))throw Error('CANONICAL_EVIDENCE_CHANGED');
 const t=obs.observedTerms,s=obs.domainSnapshot;if(obs.regularFunded===undefined||obs.clientRefunded===undefined||obs.tokenBalance===undefined)throw Error('MISSING_ACCOUNTING');
 const report={schemaVersion:1,source:config.provenance,verification:'PINNED_READS_MATCHED',executionEnabled:false,identity:{chainId:dep.chainId.toString(),agreement,factory:dep.factoryAddress,token:dep.allowlistedToken,tokenDecimals:6,agreementCodeHash:config.agreementCodeHash,factoryCodeHash:dep.expectedFactoryCodeHash,tokenCodeHash:dep.expectedTokenCodeHash,termsDigest:computeTermsDigest(t,dep)},observation:{number:block.blockNumber.toString(),hash:block.blockHash,timestamp:block.blockTimestamp.toString(),observedAt:block.observedAt},terms:serializeTerms(t),state:{phase:s.phase,checkpoint:s.D.toString(),noticeStart:s.S?.toString()??null,noticeEnd:s.E?.toString()??null,conditionalNoticeEnd:s.S===null?(s.D+t.noticeSeconds).toString():null,noticeReason:s.reason,hasStoredNotice:s.hasStoredNotice},accounting:{regularFunded:obs.regularFunded.toString(),regularVested:s.V.toString(),noticeVested:s.W.toString(),regularPaid:s.RP.toString(),noticePaid:s.NP.toString(),clientRefunded:obs.clientRefunded.toString(),noticeReserveTotal:s.R.toString(),noticeReserveRemaining:s.noticeRemaining.toString(),remainingLiability:s.L.toString(),observedTokenBalance:obs.tokenBalance.toString(),unaccountedExcess:(obs.tokenBalance-s.L).toString()},claims:{provider:{recipient:t.provider,amount:s.providerClaimable.toString(),method:'claimProvider()',outcome:s.providerClaimable===0n?'NO_CLAIMABLE_AMOUNT':'OBSERVED_ENTITLEMENT'},clientRefund:{recipient:t.client,amount:s.clientRefundable.toString(),method:'claimClientRefund()',outcome:s.clientRefundable===0n?'NO_REFUNDABLE_AMOUNT':'OBSERVED_ENTITLEMENT'}},limitations:['Observation at the stated block; not a spendable balance or guaranteed transfer.','Any permitted caller pays gas; beneficiaries are immutable.','Token restrictions, wallet loss and chain failure may prevent recovery.','Direct token donations do not increase entitlement and have no protocol recovery.','This observation does not authorize wallet execution; claim review requires separate verified deployment gates and deliberate confirmation.','Unknown prior attempts remain blocked; this report does not authorize retry.','Provider agreement and configured hashes are not independent deployment/audit proof.']};
 reportEvidence.set(report,{observation:obs,policy:config});return freezeDeep(report);
 }});
}
export type RecoveryReport=Awaited<ReturnType<ReturnType<typeof createRecoveryReader>['inspect']>>;

function freezeDeep<T>(value:T):T{if(value&&typeof value==='object'){for(const v of Object.values(value))freezeDeep(v);Object.freeze(value);}return value;}
export type ClaimAction='claim-provider'|'claim-client-refund';
export function prepareRecoveryClaim(report:RecoveryReport,wallet:WalletContext,action:ClaimAction){
 const issued=reportEvidence.get(report);if(!issued)throw Error('UNISSUED_RECOVERY_REPORT');if(action!=='claim-provider'&&action!=='claim-client-refund')throw Error('INVALID_CLAIM_ACTION');
 const {observation:obs,policy}=issued;const req=(action==='claim-provider'?prepareClaimProvider:prepareClaimClientRefund)(report.identity.agreement,policy.deployment,obs,wallet);
 const data=encodeFunctionData(req as Parameters<typeof encodeFunctionData>[0]);const terms=obs.observedTerms!;
 const vals=[terms.schemaVersion,terms.client,terms.provider,terms.token,terms.amountPerPeriod,terms.periodSeconds,terms.noticeSeconds,terms.startAt,terms.clientNonce,terms.acceptanceDeadline,terms.termsDocumentHash];
 const termsHash=keccak256(encodeAbiParameters(parseAbiParameters('uint32,address,address,address,uint256,uint64,uint64,uint64,uint256,uint64,bytes32'),vals as never));
 const policyHash=keccak256(toHex(stringify(policy)));const recipient=action==='claim-provider'?terms.provider:terms.client;
 const binding=keccak256(toHex(stringify({action,account:wallet.account.toLowerCase(),chainId:wallet.chainId.toString(),agreement:report.identity.agreement.toLowerCase(),recipient:recipient.toLowerCase(),data,termsHash,policyHash})));
 return freezeDeep({id:crypto.randomUUID(),action,source:policy.provenance,account:wallet.account.toLowerCase(),chainId:wallet.chainId.toString(),target:report.identity.agreement.toLowerCase(),data,value:'0' as const,recipient,amount:action==='claim-provider'?report.claims.provider.amount:report.claims.clientRefund.amount,termsHash,termsDigest:report.identity.termsDigest,agreementCodeHash:policy.agreementCodeHash,policyHash,binding,createdAt:Date.now(),report});
}
export type ClaimReview=ReturnType<typeof prepareRecoveryClaim>;
