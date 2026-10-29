import {getAddress} from 'viem';
import type {OwnerWallet} from './deployment-owner';
export interface InjectedOwnerWallet extends OwnerWallet {
 on?(event:string,listener:()=>void):void;
 removeListener?(event:string,listener:()=>void):void;
}
export type WalletChoice={id:string;label:string;provider:InjectedOwnerWallet};
export function isOwnerProvider(value:unknown):value is InjectedOwnerWallet {
 return !!value&&typeof value==='object'&&'request' in value&&typeof value.request==='function';
}
export function discoverOwnerWallets(host:Window,changed:(choices:readonly WalletChoice[])=>void){
 const choices:WalletChoice[]=[];
 const add=(provider:unknown,label:string)=>{if(!isOwnerProvider(provider)||choices.some(c=>c.provider===provider))return;choices.push({id:String(choices.length),label:label.slice(0,100),provider});changed([...choices]);};
 const announce=(event:Event)=>{if(!('detail' in event))return;const d:unknown=event.detail;if(!d||typeof d!=='object'||!('provider' in d)||!('info' in d))return;const info=d.info;if(!info||typeof info!=='object'||!('name' in info)||typeof info.name!=='string')return;add(d.provider,info.name+' (wallet-reported identity)');};
 host.addEventListener('eip6963:announceProvider',announce);
 return {refresh(){const injected:unknown=Reflect.get(host,'ethereum');host.dispatchEvent(new Event('eip6963:requestProvider'));if(injected&&typeof injected==='object'&&'providers' in injected&&Array.isArray(injected.providers)){for(const p of injected.providers)add(p,'Legacy injected wallet '+(choices.length+1));}else add(injected,'Injected wallet (identity not verified)');changed([...choices]);},dispose(){host.removeEventListener('eip6963:announceProvider',announce);}};
}
const pendingAccess=new WeakMap<InjectedOwnerWallet,Promise<unknown>>();
const externalPending=new WeakSet<InjectedOwnerWallet>();
export function walletFailure(error:unknown):string {
 const code=error&&typeof error==='object'&&'code' in error?error.code:undefined;
 if(code===4001)return 'Wallet connection was declined. No transaction was requested. You can choose Connect again.';
 if(code===-32002)return 'A wallet request is already pending. Open the extension and finish or cancel it, then use Check wallet status. Do not repeat Connect.';
 if(code===4100)return 'This page is not authorized for the selected wallet. Use Connect wallet and approve account access yourself.';
 if(code===4900||code===4901)return 'Wallet is disconnected from its network. Restore it in the extension, then Check wallet status.';
 return error instanceof WalletStateError?error.message:'Wallet request failed. Check the selected extension and site connection; no automatic retry was made.';
}
export class WalletStateError extends Error {}
export function boundedWalletRequest<T>(promise:Promise<T>,ms:number):Promise<T>{
 return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new WalletStateError('Wallet response timed out. The original request may still be pending; inspect the extension before another action.')),ms);promise.then(v=>{clearTimeout(timer);resolve(v);},(e:unknown)=>{clearTimeout(timer);reject(e instanceof Error?e:new WalletStateError(walletFailure(e)));});});
}
export type WalletStatus=Readonly<{accounts:readonly string[];chainId:bigint}>;
export class OwnerWalletSession {
 private epoch=0;private disposed=false;
 private readonly changed=()=>{if(this.disposed)return;this.epoch++;this.invalidate();};
 constructor(readonly provider:InjectedOwnerWallet,private readonly invalidate:()=>void,private readonly timeout=15000){for(const e of ['accountsChanged','chainChanged','disconnect'])provider.on?.(e,this.changed);}
 private assert(epoch:number){if(this.disposed||epoch!==this.epoch)throw new WalletStateError('Wallet account/network or view changed. Previous review is invalid; check wallet status again.');}
 readonly wallet:OwnerWallet={request:async args=>{const epoch=this.epoch;this.assert(epoch);const value=await boundedWalletRequest(Promise.resolve().then(()=>{this.assert(epoch);return this.provider.request(args).catch((error:unknown)=>{throw new WalletStateError(walletFailure(error));});}),this.timeout);this.assert(epoch);return value;}};
 async status():Promise<WalletStatus>{const epoch=this.epoch;const accounts=await this.wallet.request({method:'eth_accounts'});const chain=await this.wallet.request({method:'eth_chainId'});this.assert(epoch);if(!Array.isArray(accounts)||!accounts.every((a:unknown)=>typeof a==='string'&&/^0x[0-9a-f]{40}$/i.test(a))||typeof chain!=='string'||!/^0x[0-9a-f]+$/i.test(chain))throw new WalletStateError('Wallet returned malformed account or chain data.');const result=Object.freeze({accounts:Object.freeze(accounts.map((a:string)=>getAddress(a))),chainId:BigInt(chain)});if(result.accounts.length&&!pendingAccess.has(this.provider))externalPending.delete(this.provider);return result;}
 async connect():Promise<WalletStatus>{
 const epoch=this.epoch;this.assert(epoch);
 if(pendingAccess.has(this.provider)||externalPending.has(this.provider))throw new WalletStateError('A wallet request is already pending. Finish or cancel it in the extension, then Check wallet status.');
 // Invoke directly within the click handler, before any await, preserving the user gesture.
 let request:Promise<unknown>;try{request=Promise.resolve(this.provider.request({method:'eth_requestAccounts'}));}catch(error){if(error&&typeof error==='object'&&'code' in error&&error.code===-32002)externalPending.add(this.provider);throw error;}
 pendingAccess.set(this.provider,request);
 void request.then(()=>{pendingAccess.delete(this.provider);},(error:unknown)=>{pendingAccess.delete(this.provider);if(error&&typeof error==='object'&&'code' in error&&error.code===-32002)externalPending.add(this.provider);});
 await boundedWalletRequest(request,60000);this.assert(this.epoch);return this.status();
 }
 dispose(){this.disposed=true;this.epoch++;for(const e of ['accountsChanged','chainChanged','disconnect'])this.provider.removeListener?.(e,this.changed);}
}
