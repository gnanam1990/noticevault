import {describe,it,expect,vi} from 'vitest';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {WorkspaceWallet} from './WorkspaceWallet';
import {connectedWorkspaceWallet} from './workspace-wallet';
import {OwnerWalletSession} from './owner-wallet-session';
import {AuthFlow} from './auth-flow';
import {DraftReviewClient} from './draft-review';
import type {InjectedProvider} from './injected-wallet';
const address='0x1111111111111111111111111111111111111111',other='0x2222222222222222222222222222222222222222';
function fixture(chain=5042){let account=address;const methods:string[]=[];const listeners=new Map<string,()=>void>();const provider:InjectedProvider={request:({method})=>{methods.push(method);if(method==='eth_chainId')return Promise.resolve('0x'+chain.toString(16));if(method==='eth_accounts'||method==='eth_requestAccounts')return Promise.resolve([account]);if(method==='personal_sign')return Promise.resolve('0x'+'a'.repeat(130));return Promise.reject(Error('Unexpected method'));},on:(event,fn)=>{listeners.set(event,fn);},removeListener:event=>{listeners.delete(event);}};return{provider,methods,change(next:string){account=next;listeners.get('accountsChanged')?.();}};}
describe('main workspace connection is separate from authentication',()=>{
 it('renders explicit account-only and read-only controls with honest network/mobile limits',()=>{const html=renderToStaticMarkup(React.createElement(WorkspaceWallet,{network:{configIdentity:'ARC_TESTNET',chainId:5042002,label:'Arc Testnet'},disabled:false,onProvider:()=>{},onStatus:()=>{}}));expect(html).toContain('Connect wallet (account access only)');expect(html).toContain('Check wallet status (read only)');expect(html).toContain('5042002');expect(html).toContain('not mainnet acceptance');expect(html).toContain('does not currently provide a WalletConnect');expect(html).toContain('disabled');});
 it.each([5042,5042002])('status on chain %s never requests permissions or signs',async(chain)=>{const f=fixture(chain),s=new OwnerWalletSession(f.provider,()=>{});expect((await s.status()).chainId).toBe(BigInt(chain));expect(f.methods).toEqual(['eth_accounts','eth_chainId']);s.dispose();});
 it('connection invokes only account access and status, independently of backend cleanup',async()=>{const f=fixture(),s=new OwnerWalletSession(f.provider,()=>{});const p=s.connect();expect(f.methods[0]).toBe('eth_requestAccounts');await p;expect(f.methods).toEqual(['eth_requestAccounts','eth_accounts','eth_chainId']);const api=new DraftReviewClient(()=>Promise.resolve(new Response('{}',{status:503})));const auth=new AuthFlow(api,'https://workspace.invalid',5042);await expect(auth.signIn(connectedWorkspaceWallet(f.provider,{address,chainId:5042}))).rejects.toThrow(/cleanup/);expect(auth.busy).toBe(true);expect((await s.status()).accounts[0].toLowerCase()).toBe(address);expect(f.methods).not.toContain('personal_sign');s.dispose();});
 it('already-connected sign-in adapter uses read-only context, never requests account access again',async()=>{const f=fixture(),wallet=connectedWorkspaceWallet(f.provider,{address,chainId:5042});await wallet.connect();expect(f.methods).toEqual(['eth_accounts','eth_chainId']);});
 it('rejects changed account, wrong chain and mismatching signature account before signing',async()=>{const f=fixture(),wallet=connectedWorkspaceWallet(f.provider,{address,chainId:5042});await expect(wallet.signMessage('message',{address:other,chainId:5042})).rejects.toThrow(/account|network/);f.change(other);await expect(wallet.connect()).rejects.toThrow(/changed/);const wrong=fixture(5042002);await expect(connectedWorkspaceWallet(wrong.provider,{address,chainId:5042}).connect()).rejects.toThrow(/changed/);expect(f.methods).not.toContain('personal_sign');});
 it('account changes invalidate connection review and disposed views reject delayed results',async()=>{const f=fixture(),invalidated=vi.fn(),s=new OwnerWalletSession(f.provider,invalidated);await s.status();f.change(other);expect(invalidated).toHaveBeenCalledOnce();s.dispose();await expect(s.status()).rejects.toThrow(/changed/);});
});

describe('workspace sign-in rejects identity races after connection',()=>{
 it.each(['during-signature','after-verification'])('does not accept a session when account changes %s',async(stage)=>{
  const f=fixture();const origin='https://workspace.invalid';const nonce='a'.repeat(32);const issuedAt=new Date().toISOString(),expiresAt=new Date(Date.now()+300000).toISOString();
  const message=[new URL(origin).hostname+' wants you to sign in with your Ethereum account:',address,'','URI: '+origin+'/auth/verify','Version: 1','Chain ID: 5042','Nonce: '+nonce,'Issued At: '+issuedAt,'Expiration Time: '+expiresAt].join('\n');
  const calls:string[]=[];const api=new DraftReviewClient(input=>{const path=String(input);calls.push(path);if(path.endsWith('/auth/challenge'))return Promise.resolve(new Response(JSON.stringify({nonce,message,issuedAt,expiresAt}),{status:200,headers:{'Content-Type':'application/json'}}));if(path.endsWith('/auth/verify')){if(stage==='after-verification')f.change(other);return Promise.resolve(new Response('{}',{status:200,headers:{'Content-Type':'application/json'}}));}if(path.endsWith('/auth/logout'))return Promise.resolve(new Response('{}',{status:200,headers:{'Content-Type':'application/json'}}));return Promise.reject(Error('Session should not be accepted'));});
  const request=f.provider.request.bind(f.provider);f.provider.request=args=>{if(args.method==='personal_sign'&&stage==='during-signature')f.change(other);return request(args);};
  const flow=new AuthFlow(api,origin,5042);await expect(flow.signIn(connectedWorkspaceWallet(f.provider,{address,chainId:5042}))).rejects.toThrow(/changed|cancelled/);
  expect(calls.filter(p=>p.endsWith('/auth/logout')).length).toBe(2);expect(calls.some(p=>p.endsWith('/auth/session'))).toBe(false);expect(f.methods).not.toContain('eth_requestAccounts');
  expect(calls.some(p=>p.endsWith('/auth/verify'))).toBe(stage==='after-verification');
 });
});
