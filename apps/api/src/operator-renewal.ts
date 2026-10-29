/** Connected renewal preparation only; no signer or automatic submitter. */
import type pg from 'pg';
import {encodeFunctionData,encodeAbiParameters,parseAbiParameters,keccak256,toHex,type Address,type Hex} from 'viem';
import {observeAgreement,prepareApproveForRenewal,prepareFundNextPeriod,prepareStartNotice,prepareMaterializeNotice,prepareClaimProvider,prepareClaimClientRefund,serializeTerms} from '@noticevault/sdk';
import type {ConfiguredRuntime} from './configured-runtime.js';
import type {AttemptInput,AttemptPreparation} from './attempt-evidence.js';
import {canonicalCreation} from './agreement-association.js';
import {stringify} from './reviewed-artifacts.js';
export async function prepareOperatorAgreementAction(i:AttemptInput,ctx:{pool:pg.Pool;schema:string;runtime:ConfiguredRuntime;agreementCodeHash:string;nonce:(actor:Address)=>Promise<string>}) :Promise<AttemptPreparation>{
 const {pool,schema,runtime}=ctx,dep=runtime.deployment,actor=i.actor as Address;
 const match=/^agreement:(0x[0-9a-fA-F]{40})$/.exec(i.resource);
 if(!match||!['approve-renewal','fund-renewal','start-notice','materialize-notice','claim-provider','claim-client-refund'].includes(i.action)||i.chainId!==String(dep.chainId))throw Error('Exact renewal resource and chain required');
 const agreement=match[1]!.toLowerCase() as Address;
 if(i.resource!=='agreement:'+agreement)throw Error('Canonical agreement resource required');
 async function association(){const c=await pool.connect();try{await c.query('BEGIN');
  const rows=(await c.query('SELECT stream_id,fingerprint,associated_chain FROM '+schema+'.workspace_agreement_associations WHERE workspace_id=$1 AND agreement=$2 AND associated_chain=$3 FOR SHARE',[i.workspaceId,agreement,i.chainId])).rows;const row=rows.length===1?rows[0]:undefined,stream=String(row?.stream_id??'');
  if(!row||String(row.associated_chain)!==i.chainId)throw Error('Workspace agreement association required');
  const proof=await canonicalCreation(c,schema,stream,agreement);
  if(proof.fingerprint!==row.fingerprint||proof.chainId!==i.chainId||proof.factory.toLowerCase()!==dep.factoryAddress!.toLowerCase()||proof.token.toLowerCase()!==dep.allowlistedToken!.toLowerCase()||(['approve-renewal','fund-renewal','start-notice'].includes(i.action)&&proof.client.toLowerCase()!==actor.toLowerCase()))throw Error('Current canonical client association required');
  await c.query('COMMIT');return {fingerprint:proof.fingerprint,stream};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 const {fingerprint,stream}=await association();
 const observed=await observeAgreement(runtime.consent.rpc,dep,agreement,undefined,['approve-renewal','fund-renewal'].includes(i.action)?actor:undefined);
 if(observed.status!=='ok'||!observed.observedTerms||!observed.domainSnapshot||!observed.block)throw Error('Current agreement observation unavailable');
 const terms=observed.observedTerms,state=observed.domainSnapshot,expectedD=state.D;
 const wallet={account:actor,chainId:dep.chainId};
 const isRenewal=['approve-renewal','fund-renewal'].includes(i.action),now=observed.block.blockTimestamp;
 const preview=observed.contractPreview;if(!preview)throw Error('Canonical accounting preview required');
 let recipient:string|null=null,amount=0n,start=preview.S||null,end=preview.E||null,reason=preview.reason===1?'CLIENT_CANCELLED':preview.reason===2?'MISSED_CHECKPOINT':'NONE';
 let tx;
 if(i.action==='approve-renewal')tx=prepareApproveForRenewal(agreement,dep,observed,actor,0n,wallet);
 else if(i.action==='fund-renewal')tx=prepareFundNextPeriod(expectedD,agreement,dep,observed,actor,0n,wallet);
 else if(i.action==='start-notice'){
  if((BigInt(Math.floor(Date.now()/1000))>=expectedD)!==(now>=expectedD))throw Error('Notice deadline crossed; refresh review');
  tx=prepareStartNotice(agreement,dep,observed,actor,wallet);start=now>=expectedD?expectedD:now>terms.startAt?now:terms.startAt;end=start+terms.noticeSeconds;reason=now>=expectedD?'MISSED_CHECKPOINT':'CLIENT_CANCELLED';
 }else if(i.action==='materialize-notice'){
  if(observed.hasStoredNotice||now<expectedD||BigInt(Math.floor(Date.now()/1000))<expectedD)throw Error('No unstored missed-checkpoint notice is ready');
  tx=prepareMaterializeNotice(agreement,dep,observed,wallet);start=expectedD;end=start+terms.noticeSeconds;reason='MISSED_CHECKPOINT';
 }else if(i.action==='claim-provider'){tx=prepareClaimProvider(agreement,dep,observed,wallet);recipient=terms.provider;amount=preview.providerClaimable;}
 else {tx=prepareClaimClientRefund(agreement,dep,observed,wallet);recipient=terms.client;amount=preview.clientRefundable;}
 if(end!==null&&end>=(1n<<63n))throw Error('Notice end exceeds supported range');
 if(recipient&&(amount<=0n||amount>preview.L||observed.tokenBalance===undefined||observed.tokenBalance<amount))throw Error('No positive canonical payout with sufficient balance');
 const settlement={agreement,streamId:stream,fingerprint,terms:serializeTerms(terms),recipient,amount:String(amount),noticeStart:start===null?null:String(start),noticeEnd:end===null?null:String(end),noticeReason:reason,callerRule:i.action==='start-notice'?'CLIENT_ONLY':'PERMISSIONLESS_IMMUTABLE_BENEFICIARY',accounting:{regularFunded:String(observed.regularFunded),regularPaid:String(observed.regularPaid),noticePaid:String(observed.noticePaid),clientRefunded:String(observed.clientRefunded),noticeReserve:String(observed.noticeReserve),liability:String(preview.L),fundedThrough:String(expectedD),observedAt:String(now)}};

 const code=await runtime.consent.rpc.getBytecode({address:agreement,blockNumber:observed.block.blockNumber});
 if(!code||keccak256(code as Hex).toLowerCase()!==ctx.agreementCodeHash.toLowerCase())throw Error('Reviewed agreement bytecode required');
 const networkNonce=await ctx.nonce(actor);if((await association()).fingerprint!==fingerprint)throw Error('Association changed during renewal review');
 const t=terms,termsHash=keccak256(encodeAbiParameters(parseAbiParameters('uint32,address,address,address,uint256,uint64,uint64,uint64,uint256,uint64,bytes32'),[t.schemaVersion,t.client as Hex,t.provider as Hex,t.token as Hex,t.amountPerPeriod,t.periodSeconds,t.noticeSeconds,t.startAt,t.clientNonce,t.acceptanceDeadline,t.termsDocumentHash as Hex]));
 const funding={termsHash,agreementCodeHash:ctx.agreementCodeHash,regularFunded:String(observed.regularFunded),fundedThrough:String(expectedD)};
 const renewal={agreement,streamId:stream,fingerprint,terms:serializeTerms(terms),expectedD:String(expectedD),regularFunded:String(observed.regularFunded),amount:String(terms.amountPerPeriod)};
 const cycleKey=keccak256(toHex(stringify({resource:i.resource,action:i.action,termsHash,regularFunded:funding.regularFunded,fundedThrough:funding.fundedThrough,policyHash:runtime.policyHash,...(isRenewal?{}:{settlement})})));
 return {...i,source:'OPERATOR_CONFIGURED',policyHash:runtime.policyHash,cycleKey,networkNonce,target:tx.to,data:encodeFunctionData({abi:tx.abi,functionName:tx.functionName,args:tx.args}),value:'0',issuedAt:Date.now(),discoveryAnchor:{blockNumber:String(observed.block.blockNumber),blockHash:observed.block.blockHash},...(isRenewal?{renewal,...(i.action==='approve-renewal'?{approval:{spender:agreement,amount:renewal.amount}}:{funding})}:{settlement,...(recipient?{business:{termsHash,agreementCodeHash:ctx.agreementCodeHash}}:{notice:funding})})};
}
