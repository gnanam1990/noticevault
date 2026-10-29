/** Read-only Arc finality composition. No endpoints, wallet or live-mode switch.
 * Policy comes from recovered NoticeVault ARC-NOTES and Arc deterministic-finality docs.
 * Provider separation must be verified operationally; distinct labels alone are not proof.
 */
import {createBoundedCandidateLocator} from './canonical-discovery.js';
import type {DiscoveryRange} from './canonical-discovery.js';
import {arcDeployment} from '@noticevault/sdk';
import {createCanonicalAttemptRpc} from './canonical-attempt-rpc.js';
import type {CanonicalAttemptReader,CandidateLocator} from './canonical-attempt-rpc.js';
import type {SyntheticAttemptAdapter} from './attempt-evidence.js';
export interface ArcFinalityPolicy {readonly network:'ARC_TESTNET'|'ARC_MAINNET';readonly chainId:bigint;readonly kind:'COMMITTED_INCLUSION';readonly verification:'TWO_PROVIDERS';}
export interface NamedCanonicalReader {readonly id:string;readonly reader:CanonicalAttemptReader;}
type Rpc=SyntheticAttemptAdapter['rpc'];
function conflict():never{throw new Error('EVIDENCE_CONFLICT: independent canonical observations disagree');}
function equal(a:unknown,b:unknown):boolean{
 if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>equal(v,b[i]));
 const x=a as Record<string,unknown>,y=b as Record<string,unknown>,kx=Object.keys(x).sort(),ky=Object.keys(y).sort();
 return kx.length===ky.length&&kx.every((k,i)=>k===ky[i]&&equal(x[k],y[k]));
}
async function bounded<T>(promise:Promise<T>):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('EVIDENCE_UNAVAILABLE: canonical read deadline exceeded')),5000);})]);}
 finally{if(timer!==undefined)clearTimeout(timer);}
}
function providerId(value:unknown):boolean{
 if(typeof value!=='string'||value.length>512)return false;
 if(/^[-a-zA-Z0-9_]{1,128}$/.test(value))return true;
 try{const url=new URL(value);return url.protocol==='https:'&&url.origin===value&&!url.username&&!url.password;}catch{return false;}
}
export function createArcCanonicalAttemptRpc(policy:ArcFinalityPolicy,primary:NamedCanonicalReader,verification:NamedCanonicalReader,locate:CandidateLocator,verificationLocate:CandidateLocator=locate):Rpc{
 if(!policy||Object.keys(policy).length!==4||!['ARC_TESTNET','ARC_MAINNET'].includes(policy.network)||policy.chainId!==arcDeployment(policy.network).chainId||policy.kind!=='COMMITTED_INCLUSION'||policy.verification!=='TWO_PROVIDERS')throw new Error('Unsupported or missing Arc finality policy');
 const chainId=policy.chainId;
 if(!primary||!verification||!primary.reader||!verification.reader||primary.reader===verification.reader||typeof primary.id!=='string'||typeof verification.id!=='string'||!providerId(primary.id)||!providerId(verification.id)||primary.id===verification.id)throw new Error('Two distinct configured verification providers are required');
 const a=createCanonicalAttemptRpc(primary.reader,locate),b=createCanonicalAttemptRpc(verification.reader,verificationLocate);
 async function pair<T>(read:(rpc:Rpc)=>Promise<T>):Promise<T>{const [x,y]=await bounded(Promise.all([read(a),read(b)]));if(!equal(x,y))return conflict();return x;}
 async function getChainId(){const current=await pair(r=>r.getChainId());if(current!==chainId)return conflict();return current;}
 return Object.freeze({getChainId,
  async findTransaction(p){if(p.chainId!==String(chainId))return conflict();await getChainId();const tx=await pair(r=>r.findTransaction(p));await getChainId();return tx;},
  async getReceipt(hash){await getChainId();const receipt=await pair(r=>r.getReceipt(hash));await getChainId();return receipt;},
  async getBlock(n){await getChainId();const block=await pair(r=>r.getBlock(n));await getChainId();return block;},
 });
}

/** Independent bounded discovery feeds strict canonical reconciliation. */
export function createDiscoveredArcAttemptRpc(policy:ArcFinalityPolicy,primary:NamedCanonicalReader,verification:NamedCanonicalReader,range:DiscoveryRange):Rpc{
 return createArcCanonicalAttemptRpc(policy,primary,verification,createBoundedCandidateLocator(primary.reader,range),createBoundedCandidateLocator(verification.reader,range));
}
