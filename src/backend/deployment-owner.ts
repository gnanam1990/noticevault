import {parseWalletQuantity} from './wallet-rpc-quantity';
import {encodeAbiParameters,getAddress,isAddress,keccak256,parseAbiParameters,type Hex} from 'viem';
export interface OwnerWallet {request(args:{method:string;params?:unknown[]}):Promise<unknown>}
export interface OwnerStore {getItem(key:string):string|null;setItem(key:string,value:string):void}
export interface OwnerLocks {request<T>(name:string,run:()=>Promise<T>):Promise<T>}
const fail=(message:string):never=>{throw Error(message);};
const record=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:fail('Invalid unsigned bundle');
const text=(v:unknown):string=>typeof v==='string'?v:fail('Missing review field');
const hex=(v:unknown):Hex=>typeof v==='string'&&/^0x(?:[0-9a-f]{2})+$/i.test(v)?v as Hex:fail('Invalid transaction bytes');
const quantity=parseWalletQuantity;
const sha=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))).map(x=>x.toString(16).padStart(2,'0')).join('');
export type OwnerPlan=Readonly<{checksum:string;chainId:5042|5042002;from:Hex;data:Hex;expiresAt:number;sourceHead:string;artifactSha256:string;initCodeKeccak:Hex;constructorArgs:readonly string[]}>;
export async function inspectOwnerBundle(raw:string,independentChecksum:string,now=Date.now()):Promise<OwnerPlan>{
 if(raw.length>1000000||!/^[0-9a-f]{64}$/.test(independentChecksum))return fail('Fresh preflight checksum from Arc is required');
 const b=record(JSON.parse(raw)),a=record(b.artifact),t=record(a.transaction);
 if(Object.keys(b).sort().join()!=='artifact,checksumMeaning,sha256'||b.checksumMeaning!=='INTEGRITY_ONLY_NOT_AUTHORITY'||b.sha256!==independentChecksum||await sha(JSON.stringify(a))!==independentChecksum)return fail('Unsigned bundle checksum differs from independent review');
 if(a.format!=='NOTICEVAULT_UNSIGNED_DEPLOYMENT_V1'||a.purpose!=='PREPARE_ONLY_NO_BROADCAST'||a.executionEnabled!==false||Object.keys(t).sort().join()!=='chainId,data,from,to,value'||t.to!==null||t.value!=='0')return fail('Only reviewed zero-value factory creation is supported');
 if(t.chainId!==5042&&t.chainId!==5042002)return fail('Unsupported Arc chain');
 if(typeof a.createdAt!=='number'||typeof a.expiresAt!=='number'||!Number.isSafeInteger(a.createdAt)||a.createdAt>now||a.expiresAt!==a.createdAt+300000||now>=a.expiresAt)return fail('Unsigned review expired; rerun exact preflight in Arc');
 if(!isAddress(text(t.from),{strict:true})||BigInt(text(t.from))===0n)return fail('Invalid reviewed signer address');
 const from=getAddress(text(t.from)),data=hex(t.data),initCodeKeccak=hex(a.initCodeKeccak);
 if(data.length>300000||keccak256(data)!==initCodeKeccak)return fail('Init-code checksum mismatch');
 if(!Array.isArray(a.constructorArgs)||a.constructorArgs.length!==4)return fail('Constructor review missing');
 const args=a.constructorArgs.map(text);if(!isAddress(args[0],{strict:true})||!isAddress(args[1],{strict:true})||BigInt(args[0])===0n||BigInt(args[1])===0n)return fail('Invalid constructor address');const guardian=getAddress(args[0]),token=getAddress(args[1]);
 if(!/^[1-9][0-9]*$/.test(args[2])||!/^[1-9][0-9]*$/.test(args[3])||BigInt(args[3])>BigInt(args[2]))return fail('Invalid immutable liability caps');
 const tail=encodeAbiParameters(parseAbiParameters('address,address,uint256,uint256'),[guardian,token,BigInt(args[2]),BigInt(args[3])]).slice(2);
 if(!data.toLowerCase().endsWith(tail.toLowerCase()))return fail('Displayed constructor does not match transaction');
 const sourceHead=text(a.sourceHead),artifactSha256=text(a.artifactSha256);if(!/^[0-9a-f]{40}$/.test(sourceHead)||!/^[0-9a-f]{64}$/.test(artifactSha256))return fail('Source/artifact identity missing');
 return Object.freeze({checksum:independentChecksum,chainId:t.chainId,from,data,expiresAt:a.expiresAt,sourceHead,artifactSha256,initCodeKeccak,constructorArgs:Object.freeze(args)});
}
export type OwnerReview=Readonly<{plan:OwnerPlan;nonce:bigint;nonceEncoding?:"hex"|"safe-integer-number";gas:bigint;gasPrice:bigint;maximumEstimatedFee:bigint;reviewedAt:number}>;
async function context(wallet:OwnerWallet,plan:OwnerPlan){const accounts=await wallet.request({method:'eth_accounts'});if(!Array.isArray(accounts)||accounts.length!==1||typeof accounts[0]!=='string'||getAddress(accounts[0])!==plan.from)return fail('Select only the exact reviewed deployment account');const actualChain=quantity(await wallet.request({method:'eth_chainId'}),'eth_chainId');if(actualChain!==BigInt(plan.chainId))return fail('Selected provider reports site chain '+actualChain+'; reviewed chain is '+plan.chainId+'. Change the site connection in your wallet, not its token-display filter; then Check wallet status.');if(Date.now()>=plan.expiresAt)return fail('Unsigned review expired');}
export async function reviewOwnerWallet(wallet:OwnerWallet,plan:OwnerPlan,requestAccounts=true):Promise<OwnerReview>{
 if(Date.now()>=plan.expiresAt)return fail('Unsigned review expired');if(requestAccounts)await wallet.request({method:'eth_requestAccounts'});await context(wallet,plan);
 const rawNonce=await wallet.request({method:'eth_getTransactionCount',params:[plan.from,'pending']});const nonce=quantity(rawNonce,'eth_getTransactionCount');
 const gas=quantity(await wallet.request({method:'eth_estimateGas',params:[{from:plan.from,data:plan.data,value:'0x0'}]}),'eth_estimateGas')*120n/100n;
 const gasPrice=quantity(await wallet.request({method:'eth_gasPrice'}),'eth_gasPrice');if(gas<=0n||gasPrice<=0n)return fail('Positive gas estimate required');
 const maximumEstimatedFee=gas*gasPrice,balance=quantity(await wallet.request({method:'eth_getBalance',params:[plan.from,'latest']}),'eth_getBalance');if(balance<maximumEstimatedFee)return fail('Deployment wallet cannot cover the estimated gas fee');await context(wallet,plan);
 return Object.freeze({plan,nonce,nonceEncoding:typeof rawNonce==="number"?"safe-integer-number":"hex",gas,gasPrice,maximumEstimatedFee,reviewedAt:Date.now()});
}
export async function requestOwnerDeployment(wallet:OwnerWallet,review:OwnerReview,store:OwnerStore,locks:OwnerLocks,ownerConfirmed:boolean):Promise<Hex>{
 if(!ownerConfirmed)return fail('Owner deployment authorization is required');
 const p=review.plan,key='noticevault:owner-deployment:'+p.chainId+':'+p.from.toLowerCase();
 return locks.request(key,async()=>{if(store.getItem(key)!==null)return fail('Prior deployment attempt must be independently reconciled; repeat is blocked');if(Date.now()-review.reviewedAt>60000||Date.now()<review.reviewedAt)return fail('Gas/nonce review expired');await context(wallet,p);
 const nonce=quantity(await wallet.request({method:'eth_getTransactionCount',params:[p.from,'pending']}),'eth_getTransactionCount');if(nonce!==review.nonce)return fail('Wallet nonce changed; review again');
  if(Date.now()-review.reviewedAt>60000||Date.now()<review.reviewedAt||Date.now()>=p.expiresAt)return fail('Deployment review expired during wallet read');
 const entry={state:'unknown',checksum:p.checksum,nonce:String(nonce),chainId:p.chainId,from:p.from,initCodeKeccak:p.initCodeKeccak};store.setItem(key,JSON.stringify(entry));if(store.getItem(key)!==JSON.stringify(entry))return fail('Durable deployment journal unavailable');
 const hash=await wallet.request({method:'eth_sendTransaction',params:[{from:p.from,data:p.data,value:'0x0',chainId:'0x'+p.chainId.toString(16),nonce:'0x'+nonce.toString(16),gas:'0x'+review.gas.toString(16),gasPrice:'0x'+review.gasPrice.toString(16)}]});
 if(typeof hash!=='string'||!/^0x[0-9a-f]{64}$/i.test(hash))return fail('Wallet result uncertain; repeat remains blocked');store.setItem(key,JSON.stringify({...entry,state:'submitted',hash}));return hash as Hex;});
}
