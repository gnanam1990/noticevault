import {describe,it,expect,vi} from 'vitest';
import {mkdtemp,writeFile,chmod,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ALCHEMY_MAINNET_ORIGIN as origin,resolveRpcEndpoint,createSecretRpcRequest,createOperatorReaderFactory} from '../operator-rpc.js';
import {loadOperatorRpcEndpoints} from '../operator-rpc-file.js';
const dummy='DUMMY_SYNTHETIC_KEY_12345';
const endpoint=origin+'/v2/'+dummy;
const endpoints={[origin]:endpoint};
const circle='https://rpc.mainnet.arc.io';
const reply=(result:unknown)=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,result}),{headers:{'Content-Type':'application/json'}});
describe('server-only secret RPC transport (synthetic credentials, no network)',()=>{
 it('keeps pinned public origins separate from exact path credentials',()=>{
  expect(resolveRpcEndpoint(origin,endpoints)).toBe(endpoint);
  expect(resolveRpcEndpoint(circle,endpoints)).toBe(circle);
  expect(()=>resolveRpcEndpoint(origin)).toThrow('REQUIRED');
  expect(()=>resolveRpcEndpoint(endpoint,endpoints)).toThrow('ORIGIN_INVALID');
 });
 it.each([origin+'/v2/short',endpoint+'?key=x',endpoint+'#x',endpoint+'/',endpoint+'\n',origin+'/v2/%44UMMY_SYNTHETIC_KEY_12345','http://arc-mainnet.g.alchemy.com/v2/'+dummy,'https://attacker.invalid/v2/'+dummy,'https://user:pass@arc-mainnet.g.alchemy.com/v2/'+dummy,'https://arc-mainnet.g.alchemy.com:444/v2/'+dummy])('rejects malformed or unreviewed endpoint %s',(value)=>{
  expect(()=>resolveRpcEndpoint(origin,{[origin]:value})).toThrow();
 });
 it('refuses arbitrary secret-origin maps and endpoint substitution',()=>{
  expect(()=>createOperatorReaderFactory({[circle]:endpoint})).toThrow('MAPPING_INVALID');
  expect(()=>resolveRpcEndpoint(circle,{[circle]:endpoint})).toThrow('ORIGIN_MISMATCH');
 });
 it('preserves separate provider destinations, exact fixed-block params and headers',async()=>{
  const calls:{url:string;init:RequestInit|undefined}[]=[];
  const block={number:'0x1a',hash:'0x'+'11'.repeat(32),parentHash:'0x'+'22'.repeat(32),stateRoot:'0x'+'33'.repeat(32)};
  const fetcher=vi.fn(async(url:unknown,init?:RequestInit)=>{calls.push({url:String(url),init});return reply(block);}) as unknown as typeof fetch;
  const a=await createSecretRpcRequest(origin,endpoints,fetcher)({method:'eth_getBlockByNumber',params:['0x1a',false]});
  const b=await createSecretRpcRequest(circle,endpoints,fetcher)({method:'eth_getBlockByNumber',params:['0x1a',false]});
  expect(a).toEqual(block);expect(b).toEqual(block);
  expect(calls.map(c=>new URL(c.url).origin)).toEqual([origin,circle]);
  for(const c of calls){expect(c.init?.redirect).toBe('error');expect(JSON.parse(String(c.init?.body)).params).toEqual(['0x1a',false]);expect(c.init?.signal).toBeInstanceOf(AbortSignal);}
 });
 it('does not hide divergent provider results or rewrite chain IDs',async()=>{
  const fetcher=vi.fn(async(url:unknown)=>reply(String(url)===endpoint?'0x13b2':'0x4cef52')) as unknown as typeof fetch;
  const a=await createOperatorReaderFactory(endpoints,fetcher)(origin).getChainId();
  const b=await createOperatorReaderFactory(endpoints,fetcher)(circle).getChainId();
  expect(a).toBe(5042);expect(b).not.toBe(a);
 });
 it.each([302,401,500])('rejects HTTP %s without echoing response body',async status=>{
  const fetcher=vi.fn(async()=>new Response(endpoint,{status,headers:{Location:'https://attacker.invalid'}})) as unknown as typeof fetch;
  await expect(createSecretRpcRequest(origin,endpoints,fetcher)({method:'eth_chainId'})).rejects.toThrow('RPC_TRANSPORT_FAILED');expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('rejects unexpected redirect and malformed/oversize/RPC-error responses',async()=>{
  const redirected=reply('0x13b2');Object.defineProperty(redirected,'redirected',{value:true});
  for(const response of [redirected,new Response('invalid '+endpoint),new Response('x'.repeat(2097153)),new Response(JSON.stringify({jsonrpc:'2.0',id:1,error:{message:endpoint}})),new Response(JSON.stringify({jsonrpc:'2.0',id:2,result:'0x13b2'}))]){
   const f=vi.fn(async()=>response) as unknown as typeof fetch;
   await expect(createSecretRpcRequest(origin,endpoints,f)({method:'eth_chainId'})).rejects.toThrow('RPC_TRANSPORT_FAILED');
  }
 });
 it('redacts thrown upstream URLs through actual viem reader with no retries',async()=>{
  const f=vi.fn(async()=>{throw new Error('failed '+endpoint);}) as unknown as typeof fetch;
  const reader=createOperatorReaderFactory(endpoints,f)(origin);
  let error:unknown;try{await reader.getBlockNumber();}catch(e){error=e;}
  expect(error).toBeDefined();expect(String(error)+JSON.stringify(error)).not.toContain(dummy);expect(String(error)).toContain('RPC_TRANSPORT_FAILED');expect(f).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(reader)).not.toContain(dummy);
 });
 it('refuses transactions and signing without reaching fetch',async()=>{
  const f=vi.fn() as unknown as typeof fetch;
  for(const method of ['eth_sendRawTransaction','eth_sendTransaction','personal_sign','wallet_switchEthereumChain'])await expect(createSecretRpcRequest(origin,endpoints,f)({method})).rejects.toThrow('READ_METHOD_REQUIRED');
  expect(f).not.toHaveBeenCalled();
 });
 it('loads only a protected regular single-key file; rejects permissive mode, symlink and malformed contents',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'nv-rpc-dummy-'));const path=join(dir,'.env.rpc.local');
  try{
   expect(await loadOperatorRpcEndpoints(undefined)).toEqual({});
   await writeFile(path,'ALCHEMY_MAINNET_RPC_URL='+endpoint+'\n',{mode:0o600});expect(await loadOperatorRpcEndpoints(path)).toEqual(endpoints);
   await chmod(path,0o644);await expect(loadOperatorRpcEndpoints(path)).rejects.toThrow('FILE_INVALID');await chmod(path,0o600);
   await symlink(path,join(dir,'link'));await expect(loadOperatorRpcEndpoints(join(dir,'link'))).rejects.toThrow('FILE_INVALID');
   for(const content of ['OTHER='+endpoint+'\n','ALCHEMY_MAINNET_RPC_URL='+endpoint+'\nEXTRA=x\n','ALCHEMY_MAINNET_RPC_URL="'+endpoint+'"\n']){await writeFile(path,content);await expect(loadOperatorRpcEndpoints(path)).rejects.toThrow('FILE_INVALID');}
   await expect(loadOperatorRpcEndpoints(join(dir,'missing'))).rejects.toThrow('FILE_INVALID');
  }finally{await rm(dir,{recursive:true,force:true});}
 });
});
