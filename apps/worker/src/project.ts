import {applyRefund} from './refunds.js';
import {applyClaim} from './claims.js';
import type {SqlClient} from './ingest.js';
interface Event {eventName:string;address:string;args:Record<string,string>;raw?:{transactionHash:string;blockTimestamp?:unknown};}
const MAX256=(1n<<256n)-1n,MAX64=(1n<<63n)-1n;
function deadline(terms:Record<string,string>,funded:bigint):bigint{
 const a=BigInt(terms.amountPerPeriod!),p=BigInt(terms.periodSeconds!),t=BigInt(terms.startAt!);
 if(a<=0n||p<=0n||funded<a||funded%a!==0n||funded>MAX256)throw new Error('Invalid funding projection');
 // Exact computeD equation from domain/model.ts and NoticeVaultMath.sol.
 const d=t+(funded/a)*p;
 if(d<0n||d>MAX64||d+BigInt(terms.noticeSeconds!)>MAX64||funded+BigInt(terms.noticeReserve!)>MAX256)throw new Error('Funding projection overflow');
 return d;
}
async function applyProjectionInner(client:SqlClient,s:string,stream:string,event:Event,block:string):Promise<void>{
 if(event.eventName==='AgreementCreated'){
  const a=event.args,f=BigInt(a.amountPerPeriod!),d=deadline(a,f);
  await client.query(`INSERT INTO ${s}.indexed_agreements(stream_id,agreement,created_block,terms) VALUES($1,$2,$3,$4)`,[stream,a.agreement,block,JSON.stringify(a)]);
  await client.query(`INSERT INTO ${s}.indexed_funding(stream_id,agreement,regular_funded,funded_through) VALUES($1,$2,$3,$4)`,[stream,a.agreement,f.toString(),d.toString()]);
  await client.query(`INSERT INTO ${s}.indexed_claims(stream_id,agreement,recipient) VALUES($1,$2,$3)`,[stream,a.agreement,a.provider]);
 await client.query(`INSERT INTO ${s}.indexed_refunds(stream_id,agreement,recipient) VALUES($1,$2,$3)`,[stream,a.agreement,a.client]);return;
 }
 if(event.eventName==='ClientRefunded'){await applyRefund(client,s,stream,event.address,event.args,event.raw?.blockTimestamp);return;}
 if(event.eventName==='ProviderClaimed'){await applyClaim(client,s,stream,event.address,event.args,event.raw?.blockTimestamp);return;}
 if(event.eventName!=='RegularFunded'&&event.eventName!=='NoticeStarted')throw new Error('Unsupported lifecycle projection');
 const row=(await client.query(`SELECT a.terms,f.regular_funded::text FROM ${s}.indexed_agreements a JOIN ${s}.indexed_funding f USING(stream_id,agreement) WHERE a.stream_id=$1 AND a.agreement=$2 FOR UPDATE OF f`,[stream,event.address])).rows[0];
 if(!row)throw new Error('Funding emitter has no canonical creation');
 const prior=(await client.query(`SELECT reason FROM ${s}.indexed_notice WHERE stream_id=$1 AND agreement=$2`,[stream,event.address])).rows[0];
 if(prior)throw new Error('Lifecycle event after stored notice');
 if(event.eventName==='NoticeStarted'){
  const terms=row.terms as Record<string,string>,d=deadline(terms,BigInt(String(row.regular_funded))),start=BigInt(terms.startAt!);
  if(typeof event.raw?.blockTimestamp!=='string')throw new Error('Notice block timestamp required');
  const now=BigInt(event.raw.blockTimestamp),s0=BigInt(event.args.S!),reason=event.args.reason,end=s0+BigInt(terms.noticeSeconds!);
  if(s0<0n||end>MAX64)throw new Error('Notice timestamp overflow');
  if(reason==='1'){if(now>=d||s0!==(now>start?now:start))throw new Error('Cancellation notice contradicts block time or deadline');}
  else if(reason==='2'){if(now<d||s0!==d)throw new Error('Default notice contradicts funded deadline');}
  else throw new Error('Unsupported notice reason');
  await client.query(`INSERT INTO ${s}.indexed_notice(stream_id,agreement,notice_start,notice_end,reason) VALUES($1,$2,$3,$4,$5)`,[stream,event.address,s0.toString(),end.toString(),reason]);return;
 }
 if(typeof event.raw?.blockTimestamp==='string'&&BigInt(event.raw.blockTimestamp)>=deadline(row.terms as Record<string,string>,BigInt(String(row.regular_funded))))throw new Error('Funding after checkpoint deadline');
 const terms=row.terms as Record<string,string>,a=BigInt(terms.amountPerPeriod!),f=BigInt(String(row.regular_funded))+a,d=deadline(terms,f);
 if(event.args.amount!==a.toString()||event.args.newF!==f.toString()||event.args.newD!==d.toString())throw new Error('Funding event contradicts canonical terms or previous funding');
 await client.query(`UPDATE ${s}.indexed_funding SET regular_funded=$3,funded_through=$4 WHERE stream_id=$1 AND agreement=$2`,[stream,event.address,f.toString(),d.toString()]);
}

export async function applyProjection(client:SqlClient,s:string,stream:string,event:Event,block:string):Promise<void>{
 const agreement=event.eventName==='AgreementCreated'?event.args.agreement:event.address,time=event.raw?.blockTimestamp;
 if(typeof time==='string'){
  const old=(await client.query(`SELECT last_observed_at::text FROM ${s}.indexed_claims WHERE stream_id=$1 AND agreement=$2`,[stream,agreement])).rows[0];
  if(old?.last_observed_at!==undefined&&old.last_observed_at!==null&&BigInt(time)<BigInt(String(old.last_observed_at)))throw new Error('Agreement event time moved backwards');
 }
 await applyProjectionInner(client,s,stream,event,block);
 if(typeof time==='string')await client.query(`UPDATE ${s}.indexed_claims SET last_observed_at=$3 WHERE stream_id=$1 AND agreement=$2`,[stream,agreement,time]);
}
