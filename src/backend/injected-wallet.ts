import type {WalletContext,WalletPort} from './auth-flow.js';
export interface InjectedProvider {request(args:{method:string;params?:unknown[]}):Promise<unknown>;on?(event:string,fn:()=>void):void;removeListener?(event:string,fn:()=>void):void;}
export function injectedWallet(provider:InjectedProvider):WalletPort{
 async function context(connect=false):Promise<WalletContext>{
  const accounts=await provider.request({method:connect?'eth_requestAccounts':'eth_accounts'}),chain=await provider.request({method:'eth_chainId'});
  if(!Array.isArray(accounts)||typeof accounts[0]!=='string'||!/^0x[0-9a-f]{40}$/i.test(accounts[0])||typeof chain!=='string'||!/^0x[0-9a-f]+$/i.test(chain))throw new Error('Wallet account or network is unavailable.');
  const chainId=Number(BigInt(chain));if(!Number.isSafeInteger(chainId)||chainId<=0||chainId>2147483647)throw new Error('Unsupported wallet network.');
  return {address:accounts[0],chainId};
 }
 return {connect:()=>context(true),context:()=>context(),signMessage:async(message,account)=>{
  const hex='0x'+Array.from(new TextEncoder().encode(message),b=>b.toString(16).padStart(2,'0')).join('');
  const signature=await provider.request({method:'personal_sign',params:[hex,account.address]});if(typeof signature!=='string')throw new Error('Wallet signature unavailable.');return signature;
 },onChange:fn=>{for(const event of ['accountsChanged','chainChanged','disconnect'])provider.on?.(event,fn);return()=>{for(const event of ['accountsChanged','chainChanged','disconnect'])provider.removeListener?.(event,fn);};}};
}
