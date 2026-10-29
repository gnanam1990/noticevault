import {fixturePromise} from "../../scripts/test-promise.mjs";
import {describe,it,expect,vi,afterEach} from 'vitest';
import {parseAuthNetwork,loadAuthNetwork} from './auth-network';
afterEach(()=>vi.unstubAllGlobals());
describe('API-bound sign-in network',()=>{
 it.each([['ARC_TESTNET','5042002','Arc Testnet'],['ARC_MAINNET','5042','Arc Mainnet']])('uses %s exactly',(configIdentity,chainId,label)=>expect(parseAuthNetwork({configIdentity,chainId})).toEqual({configIdentity,chainId:Number(chainId),label}));
 it.each([{configIdentity:'ARC_MAINNET',chainId:'5042002'},{configIdentity:'ARC_TESTNET',chainId:'5042'},{configIdentity:'LOCAL_FIXTURE',chainId:'31337'},{configIdentity:'ARC_MAINNET',chainId:5042},{configIdentity:'ARC_MAINNET',chainId:'5042',rpc:'https://evil.invalid'},null])('rejects unsupported response',v=>expect(()=>parseAuthNetwork(v)).toThrow());
 it('fails closed on unavailable API without a testnet fallback',async()=>{vi.stubGlobal('fetch',vi.fn(()=>fixturePromise(()=>(new Response('{}',{status:503})))));await expect(loadAuthNetwork(new AbortController().signal)).rejects.toThrow('503');});
});
import {AuthFlow} from './auth-flow';
import {DraftReviewClient} from './draft-review';
it.each([5042,5042002])('completes only exact fake login on chain %s',async chainId=>{
 const origin='https://synthetic.invalid',address='0x'+'11'.repeat(20),nonce='a'.repeat(32),issuedAt=new Date().toISOString(),expiresAt=new Date(Date.now()+300000).toISOString();
 const message=['synthetic.invalid wants you to sign in with your Ethereum account:',address,'','URI: '+origin+'/auth/verify','Version: 1','Chain ID: '+chainId,'Nonce: '+nonce,'Issued At: '+issuedAt,'Expiration Time: '+expiresAt].join('\n');
 const fetcher=vi.fn((path:string)=>fixturePromise(()=>(new Response(JSON.stringify(path.endsWith('/challenge')?{message,nonce,issuedAt,expiresAt}:path.endsWith('/me')?{address,chainId:String(chainId),workspaceId:null,expiresAt}:{}),{headers:{'content-type':'application/json'}}))));
 const signMessage=vi.fn(()=> fixturePromise(()=>('0x'+'aa'.repeat(65)))),wallet={connect:()=>(fixturePromise(()=>({address,chainId}))),context:()=>(fixturePromise(()=>({address,chainId}))),signMessage};
 const flow=new AuthFlow(new DraftReviewClient(fetcher),origin,chainId);
 expect((await flow.signIn(wallet)).chainId).toBe(String(chainId));expect(signMessage).toHaveBeenCalledWith(message,{address,chainId});await flow.signOut();
 signMessage.mockClear();await expect(flow.signIn({...wallet,connect:()=>(fixturePromise(()=>({address,chainId:1})))})).rejects.toThrow('configured network');expect(signMessage).not.toHaveBeenCalled();
});
