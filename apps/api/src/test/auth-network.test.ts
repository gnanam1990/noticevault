import {describe,it,expect,vi} from 'vitest';
import Fastify from 'fastify';
import {authRoutes} from '../routes/auth.js';
import type {ApiConfig} from '../config.js';
describe.each([['ARC_TESTNET',5042002,5042],['ARC_MAINNET',5042,5042002]] as const)('%s auth network', (configIdentity,chainId,wrongChain)=>{
 it('returns selected network and rejects wrong-chain challenge/verify before DB work',async()=>{
 const app=Fastify(),query=vi.fn(()=>{throw Error('Unexpected DB work');});
 const cfg={configIdentity,db:{schema:'synthetic'},allowedOrigins:['https://synthetic.invalid'],allowedDomains:['synthetic.invalid']} as unknown as ApiConfig;
 await authRoutes(app,{query} as never,cfg,{verify:vi.fn()} as never);
 try{expect((await app.inject({method:'GET',url:'/auth/network'})).json()).toEqual({configIdentity,chainId:String(chainId)});
 for(const url of ['/auth/challenge','/auth/verify']){const r=await app.inject({method:'POST',url,headers:{origin:'https://synthetic.invalid','x-requested-with':'XMLHttpRequest'},payload:{address:'0x'+'11'.repeat(20),chainId:wrongChain,nonce:'a'.repeat(32),signature:'0x11'}});expect(r.statusCode).toBe(403);}expect(query).not.toHaveBeenCalled();}finally{await app.close();}
 });
});
import cookie from '@fastify/cookie';
it.each([['ARC_TESTNET','5042'],['ARC_MAINNET','5042002']] as const)('rejects a restored session from the other chain on %s',async(configIdentity,chain_id)=>{
 const app=Fastify();await app.register(cookie);
 const query=vi.fn(async()=>({rows:[{id:'00000000-0000-4000-8000-000000000001',member_address:'0x'+'11'.repeat(20),chain_id,workspace_id:null,expires_at:new Date(Date.now()+60000)}]}));
 const cfg={configIdentity,db:{schema:'synthetic'}} as unknown as ApiConfig;
 await authRoutes(app,{query} as never,cfg,{verify:vi.fn()} as never);
 try{const r=await app.inject({method:'GET',url:'/auth/me',headers:{cookie:'nv_session=00000000-0000-4000-8000-000000000001'}});expect(r.statusCode).toBe(403);expect(query).toHaveBeenCalledTimes(1);}finally{await app.close();}
});
