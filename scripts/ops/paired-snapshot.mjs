/** Paired canonical snapshot policy. Latest is not claimed to be finalized. */
/** @typedef {import('./preflight.mjs').RpcClient} RpcClient */
/** @typedef {{number:bigint,hash:import('viem').Hex,timestamp:bigint}} Header */
export const SNAPSHOT_POLICY=Object.freeze({maxHeadLag:8n,maxHeadTimeSkew:15n,maxAgeMs:120000,futureSkewMs:30000});
/** Only validated public block metadata is included; never RPC errors or endpoints. */
export class SnapshotError extends Error {
 /** @param {string} reason @param {string} stage @param {Header[]} headers */
 constructor(reason,stage,headers=[]){super(reason);this.diagnostic={method:'eth_getBlockByNumber',stage,headers:headers.map((h,provider)=>({provider,number:String(h.number),hash:h.hash,timestamp:String(h.timestamp)}))};}
}
/** @template T @param {Promise<T>} work @returns {Promise<T>} */
async function bounded(work){let timer;try{return await Promise.race([work,new Promise(/** @param {(value:T)=>void} _ */(_,reject)=>{timer=setTimeout(()=>reject(new SnapshotError('RPC_TIMEOUT','header')),5000);})]);}finally{clearTimeout(timer);}}
/** @param {unknown} value @param {number} now @param {string} stage @returns {Header} */
function header(value,now,stage){
 if(!value||typeof value!=='object'||!('number' in value)||!('hash' in value)||!('timestamp' in value))throw new SnapshotError('STALE_OR_INVALID_BLOCK',stage);
 const {number,hash,timestamp}=value;
 if(typeof number!=='bigint'||number<0n||typeof hash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(hash)||typeof timestamp!=='bigint'||timestamp<0n||timestamp>BigInt(Number.MAX_SAFE_INTEGER)||!Number.isSafeInteger(now))throw new SnapshotError('STALE_OR_INVALID_BLOCK',stage);
 const h={number,hash:/** @type {import('viem').Hex} */(hash.toLowerCase()),timestamp};
 const ms=timestamp*1000n;
 if(ms>BigInt(now)+30000n||BigInt(now)-ms>=120000n)throw new SnapshotError('STALE_OR_INVALID_BLOCK',stage,[h]);
 return h;
}
/** @param {Header} a @param {Header} b */
const same=(a,b)=>a.number===b.number&&a.hash===b.hash&&a.timestamp===b.timestamp;
/** @param {RpcClient[]} clients @param {{blockTag:'latest'}|{blockNumber:bigint}} query @param {()=>number} clock @param {string} stage */
async function read(clients,query,clock,stage){
 let values;
 try{values=await bounded(Promise.all(clients.map(c=>c.getBlock(query))));}catch(e){if(e instanceof SnapshotError)throw e;throw new SnapshotError('RPC_BLOCK_UNAVAILABLE',stage);}
 return values.map(v=>header(v,clock(),stage));
}
/** @param {Header[]} heads @param {string} stage */
function headAgreement(heads,stage){
 const [a,b]=heads;if(!a||!b)throw new SnapshotError('PAIRED_RPC_REQUIRED',stage);
 const gap=a.number>b.number?a.number-b.number:b.number-a.number;
 const skew=a.timestamp>b.timestamp?a.timestamp-b.timestamp:b.timestamp-a.timestamp;
 if(gap>SNAPSHOT_POLICY.maxHeadLag||skew>SNAPSHOT_POLICY.maxHeadTimeSkew)throw new SnapshotError('RPC_HEAD_LAG',stage,heads);
 if((a.number===b.number&&!same(a,b))||(a.number>b.number&&a.timestamp<b.timestamp)||(b.number>a.number&&b.timestamp<a.timestamp))throw new SnapshotError('RPC_DISAGREEMENT',stage,heads);
 return a.number<b.number?a:b;
}
/** @param {RpcClient[]} clients @param {()=>number} clock */
export async function sharedSnapshot(clients,clock){
 if(clients.length!==2)throw new SnapshotError('PAIRED_RPC_REQUIRED','heads');
 const heads=await read(clients,{blockTag:'latest'},clock,'heads');
 const lower=headAgreement(heads,'heads');
 const fixed=await read(clients,{blockNumber:lower.number},clock,'shared');
 const [a,b]=fixed;
 if(!a||!b||!same(a,b)||!same(a,lower))throw new SnapshotError('RPC_DISAGREEMENT','shared',fixed);
 return a;
}
/** Recheck the exact header after ALL state reads; advancing heads never change the snapshot. */
/** @param {RpcClient[]} clients @param {Header} snapshot @param {()=>number} clock */
export async function verifySnapshot(clients,snapshot,clock){
 const heads=await read(clients,{blockTag:'latest'},clock,'final-heads');
 headAgreement(heads,'final-heads');
 for(const h of heads)if(h.number<snapshot.number||h.timestamp<snapshot.timestamp)throw new SnapshotError('SNAPSHOT_ADVANCED_OR_REGRESSED','final-heads',heads);
 const fixed=await read(clients,{blockNumber:snapshot.number},clock,'recheck');
 if(fixed.some(h=>!same(h,snapshot)))throw new SnapshotError('BLOCK_REORG','recheck',fixed);
 header(snapshot,clock(),'complete');
}
