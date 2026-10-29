import {DraftReviewClient} from './draft-review.js';
import type {Session} from './draft-review.js';
export type WalletContext={address:string;chainId:number};
export interface WalletPort {onChange?(fn:()=>void):()=>void;connect():Promise<WalletContext>;context():Promise<WalletContext>;signMessage(message:string,context:WalletContext):Promise<string>;}
export class AuthFlow {
 private epoch=0;
 private uncertain=false;
 private active:Promise<Session>|null=null;
 private cleanup:Promise<void>|null=null;
 constructor(private readonly api:DraftReviewClient,private readonly origin:string,private readonly chainId:number){}
 get pending(){return this.active!==null;}
 get busy(){return this.active!==null||this.cleanup!==null||this.uncertain;}
 signIn(wallet:WalletPort):Promise<Session>{
  if(this.busy)return Promise.reject(new Error('A sign-in or sign-out is already pending.'));
  const epoch=++this.epoch;
  const run=async()=>{
   const current=()=>{if(epoch!==this.epoch)throw new Error('Sign-in cancelled or wallet changed.');};
   let unsubscribe=()=>{};
   try{
    // No old session may be mistaken for this attempt's identity.
    await this.api.logout();current();
    const account=await wallet.connect();current();
    if(!/^0x[0-9a-f]{40}$/i.test(account.address)||account.chainId!==this.chainId)throw new Error('Select the configured network in your wallet before signing in.');
    unsubscribe=wallet.onChange?.(()=>{++this.epoch;})??(()=>{});
    const same=async()=>{const value=await wallet.context();current();if(value.address.toLowerCase()!==account.address.toLowerCase()||value.chainId!==account.chainId)throw new Error('Wallet account or network changed. Start sign-in again.');};
    const challenge=await this.api.challenge(account.address,account.chainId);current();
    const issued=new Date(challenge.issuedAt),expires=new Date(challenge.expiresAt),origin=new URL(this.origin);
    if(origin.origin!==this.origin||!Number.isFinite(issued.getTime())||!Number.isFinite(expires.getTime())||issued.getTime()>Date.now()+5000||expires.getTime()<=Date.now()||expires<=issued||!/^[0-9a-f]{32}$/.test(challenge.nonce))throw new Error('The sign-in challenge is invalid or expired. Try again.');
    const expected=[origin.hostname+' wants you to sign in with your Ethereum account:',account.address.toLowerCase(),'','URI: '+this.origin+'/auth/verify','Version: 1','Chain ID: '+account.chainId,'Nonce: '+challenge.nonce,'Issued At: '+issued.toISOString(),'Expiration Time: '+expires.toISOString()].join(String.fromCharCode(10));
    if(challenge.message!==expected)throw new Error('Unexpected sign-in message. Nothing was signed.');
    await same();
    const signature=await wallet.signMessage(challenge.message,account);await same();
    if(expires.getTime()<=Date.now())throw new Error('The sign-in challenge expired. Try again.');
    if(!/^0x[0-9a-f]{130}$/i.test(signature))throw new Error('The wallet returned an invalid signature.');
    await this.api.verify(account.address,account.chainId,challenge.nonce,signature);await same();
    const session=await this.api.session();await same();
    if(session.address.toLowerCase()!==account.address.toLowerCase()||session.chainId!==String(account.chainId)||Date.parse(session.expiresAt)<=Date.now())throw new Error('The session does not match the selected wallet.');
    return session;
   }catch(error){
    // Verification may have set an HttpOnly cookie even after a UI cancellation.
    try{await this.api.logout();}catch{this.uncertain=true;throw new Error('Sign-in failed and session cleanup could not be confirmed. Use Sign out and retry.');}
    throw error;
   }finally{unsubscribe();this.active=null;}
  };
  this.active=run();return this.active;
 }
 signOut():Promise<void>{
  ++this.epoch;
  if(this.cleanup)return this.cleanup;
  const pending=this.active;
  this.cleanup=(async()=>{try{if(pending)await pending.catch(()=>{});await this.api.logout();this.uncertain=false;}catch(error){this.uncertain=true;throw error;}finally{this.cleanup=null;}})();
  return this.cleanup;
 }
}
