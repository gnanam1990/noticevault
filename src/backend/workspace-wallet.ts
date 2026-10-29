import {injectedWallet,type InjectedProvider} from './injected-wallet';
import type {WalletContext,WalletPort} from './auth-flow';
/** Sign-in consumes an explicitly connected identity; it never requests account permissions. */
export function connectedWorkspaceWallet(provider:InjectedProvider,expected:WalletContext):WalletPort{
 const wallet=injectedWallet(provider),identity=Object.freeze({...expected});
 const checked=async()=>{const current=await wallet.context();if(current.address.toLowerCase()!==identity.address.toLowerCase()||current.chainId!==identity.chainId)throw new Error('Wallet account or network changed. Check wallet status before signing in.');return current;};
 return {...wallet,connect:checked,context:checked,signMessage:async(message,account)=>{await checked();if(account.address.toLowerCase()!==identity.address.toLowerCase()||account.chainId!==identity.chainId)throw new Error('Signature account or network does not match the connected wallet.');return wallet.signMessage(message,account);}};
}
