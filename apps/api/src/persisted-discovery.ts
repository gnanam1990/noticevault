import {createBoundedDiscoveryScanner} from './canonical-discovery.js';
/** One bounded scan per authenticated reconciliation transaction. No executor or live transport. */
import type pg from 'pg';
import {isDeepStrictEqual} from 'node:util';
import {createArcCanonicalAttemptRpc} from './arc-finality.js';
import type {ArcFinalityPolicy,NamedCanonicalReader} from './arc-finality.js';
import {preparationBinding,reconcileCanonical} from './attempt-evidence.js';
import type {AttemptPreparation,Reconciled,SyntheticAttemptAdapter} from './attempt-evidence.js';
export type DiscoveryReader=NamedCanonicalReader&{reader:NamedCanonicalReader['reader']&{getBlockNumber():Promise<unknown>}};
export type DiscoveryTransport={policy:ArcFinalityPolicy;policyHash:string;primary:DiscoveryReader;verification:DiscoveryReader;windowSize?:number};
export type DiscoveryProgress={version:1;binding:string;policyHash:string;anchorBlock:string;anchorHash:string;nextBlock:string;checkpointBlock?:string;checkpointHash?:string;candidateHash?:string;revision:number;status:'searching'|'caught_up'|'found'|'reorged'|'conflicted'};
type Attempt={id:string;binding:string;preparation:AttemptPreparation;tx_hash:string|null;discovery?:unknown};
const H=/^0x[0-9a-f]{64}$/i,U=/^(0|[1-9][0-9]{0,19})$/,MAX=(1n<<64n)-1n;
function fail():never{throw new Error('Invalid persisted discovery binding or state');}
function decimal(v:unknown):v is string{return typeof v==='string'&&U.test(v)&&BigInt(v)<=MAX;}
function number(v:unknown):bigint{if(typeof v==='bigint'&&v>=0n&&v<=MAX)return v;if(typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)return BigInt(v);return fail();}
function load(r:Attempt):DiscoveryProgress|null{
 const p=r.preparation,a=p.discoveryAnchor;if(!a)return null;
 if(!decimal(a.blockNumber)||!H.test(a.blockHash)||Object.keys(a).length!==2||r.binding!==preparationBinding(p))return fail();
 if(r.discovery===null||r.discovery===undefined)return {version:1,binding:r.binding,policyHash:p.policyHash,anchorBlock:a.blockNumber,anchorHash:a.blockHash.toLowerCase(),nextBlock:a.blockNumber,revision:0,status:'searching'};
 if(!r.discovery||typeof r.discovery!=='object'||Array.isArray(r.discovery))return fail();const d=r.discovery as DiscoveryProgress;
 if(Object.keys(d).some(k=>!['version','binding','policyHash','anchorBlock','anchorHash','nextBlock','checkpointBlock','checkpointHash','candidateHash','revision','status'].includes(k))||d.version!==1||d.binding!==r.binding||d.policyHash!==p.policyHash||d.anchorBlock!==a.blockNumber||d.anchorHash!==a.blockHash.toLowerCase()||!decimal(d.nextBlock)||BigInt(d.nextBlock)<BigInt(d.anchorBlock)||!Number.isSafeInteger(d.revision)||d.revision<1||!['searching','caught_up','found','reorged','conflicted'].includes(d.status))return fail();
 if((d.checkpointBlock===undefined)!==(d.checkpointHash===undefined))return fail();
 if(d.checkpointBlock!==undefined&&(!decimal(d.checkpointBlock)||!H.test(d.checkpointHash!)||BigInt(d.checkpointBlock)<BigInt(d.anchorBlock)||BigInt(d.checkpointBlock)+1n!==BigInt(d.nextBlock)))return fail();
 if(d.checkpointBlock===undefined&&d.nextBlock!==d.anchorBlock)return fail();
 if(d.candidateHash!==undefined&&(!H.test(d.candidateHash)||d.checkpointBlock===undefined))return fail();
 if(d.status==='found'&&!d.candidateHash)return fail();
return {...d};
}
async function boundedHeads(d:DiscoveryTransport){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([Promise.all([d.primary.reader.getBlockNumber(),d.verification.reader.getBlockNumber()]),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Discovery head unavailable')),5000);})]);}finally{if(timer!==undefined)clearTimeout(timer);}}
export async function reconcilePersistedDiscovery(c:pg.PoolClient,schema:string,r:Attempt,adapter:SyntheticAttemptAdapter):Promise<Reconciled>{
 if(!/^[a-z][a-z0-9_]*$/.test(schema))return fail();
 const d=adapter.discovery;if(!d)return fail();const loaded=load(r);if(!loaded)return {state:'unknown'};const original:DiscoveryProgress=loaded;
 const p=r.preparation;const progress={...original};
 async function save(next:DiscoveryProgress){
  if(r.discovery!==null&&r.discovery!==undefined&&isDeepStrictEqual(original,next))return;
  next={...next,revision:original.revision+1};
  const saved=await c.query('UPDATE '+schema+'.transaction_attempts SET discovery=$2::jsonb WHERE id=$1 AND binding=$3 RETURNING id',[r.id,JSON.stringify(next),r.binding]);if(saved.rows.length!==1)return fail();
 }
 const conflict=async(state:'conflicted'|'reorged'):Promise<Reconciled>=>{await save({...progress,status:state});return {state};};
 if(d.policyHash!==p.policyHash||String(d.policy.chainId)!==p.chainId)return conflict('conflicted');
 const size=d.windowSize??1000;if(!Number.isSafeInteger(size)||size<1||size>1000)return fail();
 // Construction validates explicit Arc committed-inclusion policy and distinct reader identities.
 const canonical=createArcCanonicalAttemptRpc(d.policy,d.primary,d.verification,async()=>progress.candidateHash??null);
 try{
  await canonical.getChainId();const [a,b]=await boundedHeads(d),head=number(a);if(number(b)!==head)return conflict('conflicted');
  if(head<BigInt(progress.anchorBlock))return {state:'unknown'};
  if((await canonical.getBlock(BigInt(progress.anchorBlock))).hash.toLowerCase()!==progress.anchorHash)return conflict('reorged');
  if(progress.checkpointBlock!==undefined){if(head<BigInt(progress.checkpointBlock))return {state:'unknown'};if((await canonical.getBlock(BigInt(progress.checkpointBlock))).hash.toLowerCase()!==progress.checkpointHash)return conflict('reorged');}
  if(progress.candidateHash){const result=await reconcileCanonical({...adapter,rpc:canonical},p,r.tx_hash);return result;}
  const from=BigInt(progress.nextBlock);if(from>head){await save({...progress,status:'caught_up'});return {state:'unknown'};}
  const to=head<from+BigInt(size)-1n?head:from+BigInt(size)-1n;if(to===MAX)return fail();
  const range={fromBlock:from,toBlock:to},query={chainId:BigInt(p.chainId),account:p.actor,nonce:BigInt(p.networkNonce)};
  const [left,right]=await Promise.all([createBoundedDiscoveryScanner(d.primary.reader,range)(query),createBoundedDiscoveryScanner(d.verification.reader,range)(query)]);
  if(!isDeepStrictEqual(left,right))return conflict('conflicted');
  const candidate=left.candidateHash,end=await canonical.getBlock(to);
  if(end.hash.toLowerCase()!==left.checkpointHash)return conflict('reorged');
  if(progress.checkpointHash!==undefined&&left.firstParentHash!==progress.checkpointHash)return conflict('reorged');
  // Recheck old checkpoints after the scan before any durable advancement.
  if((await canonical.getBlock(BigInt(progress.anchorBlock))).hash.toLowerCase()!==progress.anchorHash)return conflict('reorged');
  if(progress.checkpointBlock!==undefined&&(await canonical.getBlock(BigInt(progress.checkpointBlock))).hash.toLowerCase()!==progress.checkpointHash)return conflict('reorged');
  const next:DiscoveryProgress={...progress,nextBlock:String(to+1n),checkpointBlock:String(to),checkpointHash:end.hash.toLowerCase(),status:candidate?'found':to===head?'caught_up':'searching',...(candidate?{candidateHash:candidate}:{})};
  // Outcome failure throws before save. The enclosing API transaction also rolls back on auth/session failure.
  const result=candidate?await reconcileCanonical({...adapter,rpc:createArcCanonicalAttemptRpc(d.policy,d.primary,d.verification,async()=>candidate)},p,r.tx_hash):{state:'unknown' as const};
  if(result.state==='conflicted'||result.state==='reorged')return conflict(result.state);
if((await canonical.getBlock(to)).hash.toLowerCase()!==left.checkpointHash)return conflict('reorged');
if((await canonical.getBlock(BigInt(progress.anchorBlock))).hash.toLowerCase()!==progress.anchorHash)return conflict('reorged');
await save(next);return result;
 }catch(e){if(e instanceof Error&&e.message.startsWith('EVIDENCE_CONFLICT:'))return conflict('conflicted');throw e;}
}
