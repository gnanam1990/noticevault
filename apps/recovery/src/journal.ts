import type {AttemptPreparation,Reconciled} from '../../../apps/api/src/attempt-evidence';
export type ClaimEntry={id:string;preparation:AttemptPreparation;state:Reconciled['state']|'rejected'|'cancelled';hash?:string;proof?:Reconciled['proof']};
export interface ClaimJournal {atomic<T>(fn:(entries:ClaimEntry[],save:(entries:ClaimEntry[])=>void)=>Promise<T>):Promise<T>;}
export const JOURNAL_KEY='noticevault:recovery:claims:v1';
type StoragePort=Pick<Storage,'getItem'|'setItem'|'key'|'length'>;
export interface LockPort{request<T>(name:string,callback:()=>Promise<T>):Promise<T>;}
export function browserClaimJournal(storage:StoragePort,locks:LockPort):ClaimJournal{
 function read():ClaimEntry[]{
 for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key&&key!==JOURNAL_KEY&&key.startsWith('noticevault:')&&(key.includes('attempt')||key.includes('creation'))){const raw=storage.getItem(key);if(raw&&(/"(?:unknown|submitted)"/.test(raw)))throw Error('LEGACY_UNKNOWN_ATTEMPT');}}
 const raw=storage.getItem(JOURNAL_KEY);if(raw===null)return [];if(raw.length>2000000)throw Error('CORRUPT_JOURNAL_PRESERVED');
 let parsed:unknown;try{parsed=JSON.parse(raw);}catch{throw Error('CORRUPT_JOURNAL_PRESERVED');}
 const x=parsed as {version?:unknown;entries?:unknown};if(!x||x.version!==1||!Array.isArray(x.entries)||x.entries.length>1000)throw Error('CORRUPT_JOURNAL_PRESERVED');
 const ids=new Set<string>();for(const item of x.entries){const e=item as ClaimEntry,p=e?.preparation;if(!e||typeof e.id!=='string'||!e.id||ids.has(e.id)||!['unknown','submitted','confirmed','reverted','reorged','conflicted','rejected','cancelled'].includes(e.state)||!p||!['claim-provider','claim-client-refund'].includes(p.action)||!['SYNTHETIC','OPERATOR_CONFIGURED'].includes(p.source)||!/^0x[0-9a-f]{40}$/i.test(p.actor)||!/^0x[0-9a-f]{40}$/i.test(p.target)||!/^0x[0-9a-f]+$/i.test(p.data)||!/^([1-9][0-9]*)$/.test(p.chainId)||!/^([0-9]+)$/.test(p.networkNonce)||p.value!=='0'||!p.business||!/^0x[0-9a-f]{64}$/i.test(p.policyHash)||(e.hash!==undefined&&!/^0x[0-9a-f]{64}$/i.test(e.hash)))throw Error('CORRUPT_JOURNAL_PRESERVED');ids.add(e.id);}
 return x.entries as ClaimEntry[];
 }
 return {atomic:fn=>{if(!locks?.request)throw Error('CROSS_TAB_LOCK_UNAVAILABLE');return locks.request(JOURNAL_KEY,async()=>{const entries=read();return fn(entries,next=>{if(next.length>1000)throw Error('JOURNAL_CAPACITY_REACHED');const raw=JSON.stringify({version:1,entries:next});storage.setItem(JOURNAL_KEY,raw);if(storage.getItem(JOURNAL_KEY)!==raw)throw Error('JOURNAL_WRITE_UNCONFIRMED');});});}};
}
