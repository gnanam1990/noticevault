import type {SqlClient} from './ingest.js';
/** Refund is available immediately on resolved notice, not at notice end. */
export async function applyRefund(client:SqlClient,s:string,stream:string,address:string,args:Record<string,string>,time:unknown):Promise<void>{
 if(typeof time!=='string')throw new Error('Refund block timestamp required');
 const row=(await client.query(`SELECT a.terms,f.regular_funded::text,c.regular_paid::text,c.notice_paid::text,r.client_refunded::text,r.recipient,n.notice_start::text FROM ${s}.indexed_agreements a JOIN ${s}.indexed_funding f USING(stream_id,agreement) JOIN ${s}.indexed_claims c USING(stream_id,agreement) JOIN ${s}.indexed_refunds r USING(stream_id,agreement) LEFT JOIN ${s}.indexed_notice n USING(stream_id,agreement) WHERE a.stream_id=$1 AND a.agreement=$2 FOR UPDATE OF r`,[stream,address])).rows[0];
 if(!row)throw new Error('Refund emitter has no canonical creation');
 // An implicit missed-checkpoint notice starts at D, where V(S)=F: no refund event.
 if(row.notice_start===null)throw new Error('No stored notice with refundable principal');
 const t=row.terms as Record<string,string>,A=BigInt(t.amountPerPeriod!),P=BigInt(t.periodSeconds!),N=BigInt(t.noticeSeconds!),R=BigInt(t.noticeReserve!),t0=BigInt(t.startAt!),F=BigInt(String(row.regular_funded)),S=BigInt(String(row.notice_start));
 if(A<=0n||P<=0n||N<=0n||F%A!==0n||R!==(A*N+P-1n)/P||BigInt(t.initialFunded!)!==A+R||row.recipient!==t.client)throw new Error('Refund terms/recipient inconsistent');
 const D=t0+(F/A)*P,stop=S<D?S:D,elapsed=stop>t0?stop-t0:0n,rawV=A*elapsed/P,V=rawV<F?rawV:F;
 const CR=BigInt(String(row.client_refunded)),paidR=BigInt(String(row.regular_paid)),paidN=BigInt(String(row.notice_paid)),amount=F-V-CR;
 if(amount<=0n||args.amount!==amount.toString()||paidR>V||paidN>R||paidR+paidN+CR+amount>F+R)throw new Error('Refund contradicts unused principal or conservation');
 await client.query(`UPDATE ${s}.indexed_refunds SET client_refunded=$3 WHERE stream_id=$1 AND agreement=$2`,[stream,address,(CR+amount).toString()]);
}
