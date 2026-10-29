import {it,expect} from 'vitest';
import {recoveryWallet} from './wallet';
import {RecoveryClaims} from './claims';
it('requires explicit connection and never sends during connect',async()=>{const methods:string[]=[];const w=recoveryWallet({request:async({method})=>{methods.push(method);return method==='eth_chainId'?'0x4cef52':['0x1111111111111111111111111111111111111111'];}});expect(methods).toEqual([]);await w.connect();expect(methods).toEqual(['eth_requestAccounts','eth_chainId','eth_accounts','eth_chainId']);});
it('exports the guarded recovery lifecycle',()=>{expect(typeof RecoveryClaims).toBe('function');});
