import type {SqlClient} from './ingest.js';
export async function applyClaim(client:SqlClient,s:string,stream:string,address:string,args:Record<string,string>,time:unknown):Promise<void>{
 if(typeof time!=='string')throw new Error('Claim block timestamp required');
 const row=(await client.query(`SELECT a.terms,f.regular_funded::text,c.regular_paid::text,c.notice_paid::text,c.recipient,r.client_refunded::text,n.notice_start::text FROM ${s}.indexed_agreements a JOIN ${s}.indexed_funding f USING(stream_id,agreement) JOIN ${s}.indexed_claims c USING(stream_id,agreement) JOIN ${s}.indexed_refunds r USING(stream_id,agreement) LEFT JOIN ${s}.indexed_notice n USING(stream_id,agreement) WHERE a.stream_id=$1 AND a.agreement=$2 FOR UPDATE OF c`,[stream,address])).rows[0];
 if(!row)throw new Error('Claim emitter has no canonical creation');
 const t=row.terms as Record<string,string>,A=BigInt(t.amountPerPeriod!),P=BigInt(t.periodSeconds!),N=BigInt(t.noticeSeconds!),R=BigInt(t.noticeReserve!),t0=BigInt(t.startAt!),F=BigInt(String(row.regular_funded)),now=BigInt(time);
 if(P<=0n||N<=0n||A<=0n||R!==(A*N+P-1n)/P||BigInt(t.initialFunded!)!==A+R||row.recipient!==t.provider)throw new Error('Claim terms/recipient inconsistent');
 const D=t0+(F/A)*P,hasNotice=row.notice_start!==null,S=hasNotice?BigInt(String(row.notice_start)):D;
 if(!hasNotice&&now>=D)throw new Error('Missing preceding default notice event');
 const stop=[now,D,S].reduce((a,b)=>a<b?a:b),elapsed=stop>t0?stop-t0:0n,regularRaw=A*elapsed/P,V=regularRaw<F?regularRaw:F;
 const noticeElapsed=now>S?(now-S<N?now-S:N):0n,W=hasNotice?R*noticeElapsed/N:0n;
 const paidR=BigInt(String(row.regular_paid)),paidN=BigInt(String(row.notice_paid)),r=V-paidR,n=W-paidN,total=r+n;
 if(r<0n||n<0n||total<=0n||paidR+paidN+total+BigInt(String(row.client_refunded))>F+R||args.regularDelta!==r.toString()||args.noticeDelta!==n.toString()||args.total!==total.toString())throw new Error('Claim deltas exceed or contradict accrued unpaid earnings');
 await client.query(`UPDATE ${s}.indexed_claims SET regular_paid=$3,notice_paid=$4 WHERE stream_id=$1 AND agreement=$2`,[stream,address,V.toString(),W.toString()]);
}
