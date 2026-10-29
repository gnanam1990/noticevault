import type {SqlClient} from './ingest.js';
const supported=new Set(['AgreementCreated','RegularFunded','NoticeStarted','ProviderClaimed','ClientRefunded']);
type Event={eventName:string;address:string;args:Record<string,string>;transactionHash:string;logIndex:string};
/** Runs inside ingestion's stream-locked transaction. Stores no delivery jobs or balances. */
export async function persistIndexedNotification(client:SqlClient,s:string,stream:string,block:{number:string;hash:string},event:Event){
 if(!supported.has(event.eventName))throw new Error('UNSUPPORTED_NOTIFICATION_EVENT');
 const agreement=event.eventName==='AgreementCreated'?event.args.agreement:event.address;
 if(!agreement||!/^0x[0-9a-f]{40}$/.test(agreement))throw new Error('INVALID_NOTIFICATION_AGREEMENT');
 await client.query('INSERT INTO '+s+'.indexed_notifications(stream_id,agreement,block_number,block_hash,transaction_hash,log_index,event_name) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(stream_id,block_hash,transaction_hash,log_index) DO NOTHING',[stream,agreement,block.number,block.hash,event.transactionHash,event.logIndex,event.eventName]);
}
export const EXTERNAL_NOTIFICATION_DELIVERY_ENABLED=false;
