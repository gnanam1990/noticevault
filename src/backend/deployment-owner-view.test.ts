import {createHash} from 'node:crypto';
import {encodeAbiParameters,parseAbiParameters,keccak256,type Hex} from 'viem';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {mountOwnerDeployment} from './deployment-owner-view';
class Control {
 afterNode?:Control;removed=false;after(node:Control){this.afterNode=node;}remove(){this.removed=true;}
 setAttribute(_name:string,_value:string){}
 focused=false;scrolled=false;focus(){this.focused=true;}scrollIntoView(){this.scrolled=true;}
 disabled=false;checked=false;value='';textContent='';files?:{size:number;text:()=>Promise<string>}[];
 onclick:(()=>void)|null=null;onchange:(()=>void)|null=null;
 listeners=new Map<string,()=>void>();options:Control[]=[];
 constructor(text='',value=''){this.textContent=text;this.value=value;}
 add(option:Control){this.options.push(option);}replaceChildren(...options:Control[]){this.options=options;}
 addEventListener(type:string,fn:()=>void){this.listeners.set(type,fn);}removeEventListener(type:string,fn:()=>void){if(this.listeners.get(type)===fn)this.listeners.delete(type);}
}
function view(data=new Map<string,string>()){
 for(const key of ['HTMLInputElement','HTMLTextAreaElement','HTMLButtonElement','HTMLSelectElement','HTMLPreElement','HTMLParagraphElement','Option'])vi.stubGlobal(key,Control);
 const ids=['bundle','bundle-text','checksum','inspect','wallet','authorize','send','details','gas','status','wallet-scan','wallet-provider','wallet-check','wallet-connect','wallet-status'];
 const controls=new Map(ids.map(id=>[id,new Control()]));
 const get=(id:string)=>{const c=controls.get(id);if(!c)throw Error('Fixture control missing');return c;};
 const request=vi.fn<(args:{method:string;params?:unknown[]})=>Promise<unknown>>();const events=new Map<string,()=>void>();
 const host=Object.assign(new EventTarget(),{ethereum:{request,on:(e:string,f:()=>void)=>events.set(e,f),removeListener:(e:string)=>events.delete(e)},top:null});
 vi.stubGlobal('window',host);vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)});
 const root={ownerDocument:{createElement:(tag:string)=>{if(tag!=='button'&&tag!=='p')throw Error('Unsupported fixture element');return new Control();}},querySelector:(selector:string)=>controls.get(selector.slice(1))??null} as unknown as HTMLElement;
 const dispose=mountOwnerDeployment(root,host as unknown as Window);
 get('wallet-scan').onclick?.();get('wallet-provider').value='0';get('wallet-provider').onchange?.();
 return {get,request,events,data,dispose};
}
afterEach(()=>vi.unstubAllGlobals());
describe('owner view SPA lifecycle',()=>{
 it('does not contact wallet on mount or missing input and removes handlers on exit',async()=>{
  const v=view();expect(v.request).not.toHaveBeenCalled();v.get('inspect').onclick?.();
  await vi.waitFor(()=>expect(v.get('status').textContent).toContain('Choose the fresh'));
  expect(v.get('wallet').disabled).toBe(true);expect(v.get('status').focused).toBe(true);expect(v.get('status').scrolled).toBe(true);v.dispose();
  expect(v.get('inspect').onclick).toBeNull();expect(v.get('send').onclick).toBeNull();
  expect(v.get('bundle-text').listeners.size).toBe(0);expect(v.request).not.toHaveBeenCalled();
 });
 it('rejects ambiguous file plus paste and oversized paste without wallet access',async()=>{
  const v=view();v.get('bundle').files=[{size:2,text:()=>Promise.resolve('{}')}];v.get('bundle-text').value='{}';v.get('inspect').onclick?.();
  await vi.waitFor(()=>expect(v.get('status').textContent).toContain('not both'));
  v.get('bundle').files=undefined;v.get('bundle-text').value='x'.repeat(1000001);v.get('inspect').onclick?.();
  await vi.waitFor(()=>expect(v.get('status').textContent).toContain('maximum 1 MB'));
  expect(v.get('wallet').disabled).toBe(true);expect(v.request).not.toHaveBeenCalled();v.dispose();
 });
});

const signer=('0x'+'1'.repeat(40)) as Hex,token=('0x'+'2'.repeat(40)) as Hex;
function bundle(){const args=[signer,token,'10000000','1000000'];const data=('0x6000'+encodeAbiParameters(parseAbiParameters('address,address,uint256,uint256'),[signer,token,10000000n,1000000n]).slice(2)) as Hex;const createdAt=Date.now();const artifact={format:'NOTICEVAULT_UNSIGNED_DEPLOYMENT_V1',purpose:'PREPARE_ONLY_NO_BROADCAST',executionEnabled:false,reviewSha256:'d'.repeat(64),sourceHead:'a'.repeat(40),artifactSha256:'b'.repeat(64),createdAt,expiresAt:createdAt+300000,transaction:{chainId:5042,from:signer,to:null,data,value:'0'},constructorArgs:args,initCodeKeccak:keccak256(data)};const sha256=createHash('sha256').update(JSON.stringify(artifact)).digest('hex');return {raw:JSON.stringify({artifact,sha256,checksumMeaning:'INTEGRITY_ONLY_NOT_AUTHORITY'}),sha256,artifact};}

it('invalidates a pending file read on exit and starts a fresh review on remount',async()=>{
 const b=bundle();let complete:(value:string)=>void=()=>{throw Error('Read not started');};
 const pending=new Promise<string>(resolve=>{complete=resolve;});const v=view();
 v.get('bundle').files=[{size:b.raw.length,text:()=>pending}];v.get('checksum').value=b.sha256;
 v.get('inspect').onclick?.();v.dispose();complete(b.raw);
 await new Promise(resolve=>setTimeout(resolve,20));
 expect(v.get('wallet').disabled).toBe(true);expect(v.get('send').disabled).toBe(true);expect(v.request).not.toHaveBeenCalled();
 const next=view();expect(next.get('wallet').disabled).toBe(true);expect(next.get('send').disabled).toBe(true);next.dispose();
});
it('accepts complete pasted fixture, renders exact caps and invalidates it on edit',async()=>{
 const b=bundle(),v=view();v.get('bundle-text').value=b.raw;v.get('checksum').value=b.sha256;v.get('inspect').onclick?.();
 await vi.waitFor(()=>expect(v.get('status').textContent).toContain('Integrity checked'));
 expect(v.get('details').textContent).toContain('Immutable factory cap: 10 USDC; agreement cap: 1 USDC');
 expect(v.get('wallet').disabled).toBe(false);expect(v.get('authorize').disabled).toBe(true);expect(v.get('send').disabled).toBe(true);
 v.get('checksum').listeners.get('input')?.();expect(v.get('wallet').disabled).toBe(true);expect(v.request).not.toHaveBeenCalled();v.dispose();
});
it('rejects a correctly checksummed expired fixture without enabling wallet controls',async()=>{
 const b=bundle();b.artifact.createdAt=Date.now()-600000;b.artifact.expiresAt=Date.now()-300000;
 const sha256=createHash('sha256').update(JSON.stringify(b.artifact)).digest('hex');
 const v=view();v.get('bundle-text').value=JSON.stringify({artifact:b.artifact,sha256,checksumMeaning:'INTEGRITY_ONLY_NOT_AUTHORITY'});v.get('checksum').value=sha256;v.get('inspect').onclick?.();
 await vi.waitFor(()=>expect(v.get('status').textContent).toMatch(/expired/i));
 expect(v.get('wallet').disabled).toBe(true);expect(v.request).not.toHaveBeenCalled();v.dispose();
});
it('blocks further wallet reads after leaving during an account request',async()=>{
 const b=bundle(),v=view();v.get('bundle-text').value=b.raw;v.get('checksum').value=b.sha256;v.get('inspect').onclick?.();
 await vi.waitFor(()=>expect(v.get('wallet').disabled).toBe(false));
 let finish:(accounts:string[])=>void=()=>{throw Error('Not started');};v.request.mockImplementation(()=>new Promise<string[]>(resolve=>{finish=resolve;}));
 v.get('wallet').onclick?.();await vi.waitFor(()=>expect(v.request).toHaveBeenCalledTimes(1));v.dispose();finish([signer]);
 await new Promise(resolve=>setTimeout(resolve,20));
 expect(v.request).toHaveBeenCalledTimes(1);expect(v.get('send').disabled).toBe(true);
});

function ready(v:ReturnType<typeof view>){v.request.mockImplementation(({method}:{method:string})=>Promise.resolve(method==='eth_accounts'?[signer]:method==='eth_chainId'?'0x13b2':method==='eth_getTransactionCount'?'0x2':method==='eth_estimateGas'?'0x5208':method==='eth_gasPrice'?'0x1':method==='eth_getBalance'?'0xffffffffffff':[]));}
async function loaded(v:ReturnType<typeof view>){const b=bundle();v.get('bundle-text').value=b.raw;v.get('checksum').value=b.sha256;v.get('inspect').onclick?.();await vi.waitFor(()=>expect(v.get('status').textContent).toContain('Integrity checked'));}
it('checks existing access and numeric chain before a bundle without requesting permission',async()=>{const v=view();ready(v);v.get('wallet-check').onclick?.();await vi.waitFor(()=>expect(v.get('wallet-status').textContent).toContain('5042'));expect(v.request.mock.calls.map(c=>c[0].method)).toEqual(['eth_accounts','eth_chainId']);expect(v.get('send').disabled).toBe(true);v.dispose();});
it('reports testnet numeric chain before preparation and never switches networks',async()=>{const v=view();ready(v);v.request.mockImplementation(({method}:{method:string})=>Promise.resolve(method==='eth_accounts'?[signer]:'0x4cef52'));v.get('wallet-check').onclick?.();await vi.waitFor(()=>expect(v.get('wallet-status').textContent).toContain('5042002'));expect(v.get('wallet-status').textContent).toContain('token-display filter');expect(v.request).toHaveBeenCalledTimes(2);v.dispose();});
it('gas review uses existing access and invalidates on chain or account events',async()=>{const v=view();ready(v);await loaded(v);v.get('wallet').onclick?.();await vi.waitFor(()=>expect(v.get('authorize').disabled).toBe(false));expect(v.request.mock.calls.some(c=>c[0].method==='eth_requestAccounts')).toBe(false);v.get('authorize').checked=true;v.get('authorize').onchange?.();expect(v.get('send').disabled).toBe(false);v.events.get('chainChanged')?.();expect(v.get('send').disabled).toBe(true);expect(v.get('authorize').checked).toBe(false);expect(v.get('wallet-status').textContent).toContain('changed');v.dispose();expect(v.events.size).toBe(0);});
it('shows rejection and pending connection errors inline without a transaction request',async()=>{const v=view();v.request.mockRejectedValue({code:4001});v.get('wallet-connect').onclick?.();await vi.waitFor(()=>expect(v.get('wallet-status').textContent).toContain('declined'));v.request.mockRejectedValue({code:-32002});v.get('wallet-connect').onclick?.();await vi.waitFor(()=>expect(v.get('wallet-status').textContent).toContain('already pending'));v.get('wallet-connect').onclick?.();await vi.waitFor(()=>expect(v.get('wallet-status').textContent).toContain('already pending'));expect(v.request).toHaveBeenCalledTimes(2);expect(v.get('wallet-status').focused).toBe(true);v.dispose();});
it('blocks a persisted unknown attempt after remount without clearing the journal',async()=>{const v=view();ready(v);const key='noticevault:owner-deployment:5042:'+signer.toLowerCase();v.data.set(key,'{"state":"unknown"}');const b=bundle();v.get('bundle-text').value=b.raw;v.get('checksum').value=b.sha256;v.get('inspect').onclick?.();await vi.waitFor(()=>expect(v.get('status').textContent).toContain('independently reconciled'));expect(v.get('wallet').disabled).toBe(true);expect(v.data.get(key)).toBe('{"state":"unknown"}');expect(v.request).not.toHaveBeenCalled();v.dispose();});

it('rejects a fee response arriving after bundle expiry without restoring authorization',async()=>{const v=view();ready(v);await loaded(v);const now=Date.now();const clock=vi.spyOn(Date,'now');v.request.mockImplementation(({method}:{method:string})=>{if(method==='eth_gasPrice')clock.mockReturnValue(now+300001);return Promise.resolve(method==='eth_accounts'?[signer]:method==='eth_chainId'?'0x13b2':method==='eth_getTransactionCount'?'0x2':method==='eth_estimateGas'?'0x5208':method==='eth_gasPrice'?'0x1':'0xffffffffffff');});v.get('wallet').onclick?.();await vi.waitFor(()=>expect(v.get('status').textContent).toContain('expired'));expect(v.get('authorize').disabled).toBe(true);expect(v.get('send').disabled).toBe(true);clock.mockRestore();v.dispose();});
it('checks actual numeric chain and exact account during fee review without permission or send calls',async()=>{const v=view();ready(v);await loaded(v);v.request.mockImplementation(({method}:{method:string})=>Promise.resolve(method==='eth_accounts'?[signer]:'0x4cef52'));v.get('wallet').onclick?.();await vi.waitFor(()=>expect(v.get('status').textContent).toContain('site chain 5042002'));expect(v.get('status').textContent).toContain('5042');expect(v.get('send').disabled).toBe(true);v.dispose();});

function fakeLocks(){vi.stubGlobal('navigator',{locks:{request:async<T>(_name:string,run:()=>Promise<T>)=>run()}});}
async function feeReady(v:ReturnType<typeof view>){await loaded(v);v.get('wallet').onclick?.();await vi.waitFor(()=>expect(v.get('authorize').disabled).toBe(false));v.get('authorize').checked=true;v.get('authorize').onchange?.();expect(v.get('send').disabled).toBe(false);}
it('already-authorized connection returns without a popup and explains the next nonfinancial step',async()=>{const v=view();ready(v);v.get('wallet-connect').onclick?.();await vi.waitFor(()=>expect(v.get('wallet-status').textContent).toContain('without opening a popup'));expect(v.request.mock.calls.map(c=>c[0].method)).toEqual(['eth_requestAccounts','eth_accounts','eth_chainId']);expect(v.get('status').textContent).toContain('no transaction popup is expected here');expect(v.get('send').disabled).toBe(true);v.dispose();});
it('full fake UI flow hands off exactly one reviewed transaction only after durable journal and explicit authorization',async()=>{const v=view();ready(v);fakeLocks();await feeReady(v);const original=v.request.getMockImplementation();if(!original)throw Error('Fake missing');const hash='0x'+'7'.repeat(64);let observed:unknown;v.request.mockImplementation(args=>{if(args.method!=='eth_sendTransaction')return original(args);expect([...v.data.values()][0]).toContain('unknown');expect(v.get('status').textContent).toContain('Requesting wallet review');observed=args.params;return Promise.resolve(hash);});v.get('send').onclick?.();await vi.waitFor(()=>expect(v.get('status').textContent).toContain('Confirmation is not verified'));expect(observed).toEqual([{from:signer,data:bundle().artifact.transaction.data,value:'0x0',chainId:'0x13b2',nonce:'0x2',gas:'0x6270',gasPrice:'0x1'}]);expect([...v.data.values()][0]).toContain('submitted');v.get('send').onclick?.();await vi.waitFor(()=>expect(v.get('send').disabled).toBe(true));expect(v.request.mock.calls.filter(c=>c[0].method==='eth_sendTransaction')).toHaveLength(1);expect(v.request.mock.calls.some(c=>c[0].method==='eth_requestAccounts')).toBe(false);v.dispose();});
it('pending fake transaction shows uncertainty and account change plus late response never restores authority',async()=>{const v=view();ready(v);fakeLocks();await feeReady(v);const original=v.request.getMockImplementation();if(!original)throw Error('Fake missing');let finish:(v:unknown)=>void=()=>{throw Error('not started');};v.request.mockImplementation(args=>args.method==='eth_sendTransaction'?new Promise(resolve=>{finish=resolve;}):original(args));v.get('send').onclick?.();await vi.waitFor(()=>expect(v.get('status').textContent).toContain('waiting for a response'));expect(v.get('send').disabled).toBe(true);v.events.get('accountsChanged')?.();finish('0x'+'8'.repeat(64));await vi.waitFor(()=>expect(v.get('status').textContent).toContain('attempt is unresolved'));expect([...v.data.values()][0]).toContain('unknown');expect(v.get('authorize').checked).toBe(false);v.dispose();});
it('lost fake transaction response survives remount and blocks repeat without clearing evidence',async()=>{const v=view();ready(v);fakeLocks();await feeReady(v);const original=v.request.getMockImplementation();if(!original)throw Error('Fake missing');v.request.mockImplementation(args=>args.method==='eth_sendTransaction'?Promise.reject(new Error('transport lost')):original(args));v.get('send').onclick?.();await vi.waitFor(()=>expect(v.get('status').textContent).toContain('attempt is unresolved'));const saved=v.data;v.dispose();const next=view(saved);await loadedBlocked(next);expect(next.request).not.toHaveBeenCalled();expect(next.get('send').disabled).toBe(true);expect([...saved.values()][0]).toContain('unknown');next.dispose();});
async function loadedBlocked(v:ReturnType<typeof view>){const b=bundle();v.get('bundle-text').value=b.raw;v.get('checksum').value=b.sha256;v.get('inspect').onclick?.();await vi.waitFor(()=>expect(v.get('status').textContent).toContain('independently reconciled'));}
it('explains bundle expiry even before fee review and keeps all financial controls disabled',async()=>{const v=view();await loaded(v);const now=Date.now();const clock=vi.spyOn(Date,'now').mockReturnValue(now+300001);await vi.waitFor(()=>expect(v.get('status').textContent).toContain('Unsigned bundle expired'),{timeout:2000});expect(v.get('wallet').disabled).toBe(true);expect(v.get('send').disabled).toBe(true);expect(v.request).not.toHaveBeenCalled();clock.mockRestore();v.dispose();});

it('keeps all financial controls blocked when journal reads become unavailable during a request',async()=>{
 const v=view();ready(v);fakeLocks();await feeReady(v);const original=v.request.getMockImplementation()!;let unreadable=false;
 vi.stubGlobal('localStorage',{getItem:(key:string)=>{if(unreadable)throw Error('Storage unavailable');return v.data.get(key)??null;},setItem:(key:string,value:string)=>v.data.set(key,value)});
 v.request.mockImplementation(async args=>{if(args.method==='eth_sendTransaction'){unreadable=true;throw Error('Transport lost');}return original(args);});
 v.get('send').onclick?.();await vi.waitFor(()=>expect(v.get('status').textContent).toContain('unresolved'));expect(v.get('send').disabled).toBe(true);expect(v.get('wallet').disabled).toBe(true);expect(v.get('authorize').checked).toBe(false);expect([...v.data.values()][0]).toContain('unknown');v.dispose();
});

it('blocks dispatch if account changes after the final nonce check and journal write',async()=>{
 const v=view();ready(v);fakeLocks();await feeReady(v);
 vi.stubGlobal('localStorage',{getItem:(key:string)=>v.data.get(key)??null,setItem:(key:string,value:string)=>{v.data.set(key,value);v.events.get('accountsChanged')?.();}});
 v.get('send').onclick?.();await vi.waitFor(()=>expect(v.get('status').textContent).toContain('unresolved'));
 expect(v.request.mock.calls.some(([a])=>a.method==='eth_sendTransaction')).toBe(false);expect([...v.data.values()][0]).toContain('unknown');expect(v.get('send').disabled).toBe(true);v.dispose();
});

it('reports a prior journal during read-only readiness without a fresh bundle or permission request',async()=>{const data=new Map<string,string>();data.set('noticevault:owner-deployment:5042:'+signer.toLowerCase(),'existing-unknown');const v=view(data);ready(v);v.get('wallet-check').onclick?.();await vi.waitFor(()=>expect(v.get('wallet-status').textContent).toContain('Prior attempt recorded'));expect(v.data.get('noticevault:owner-deployment:5042:'+signer.toLowerCase())).toBe('existing-unknown');expect(v.request.mock.calls.map(([a])=>a.method)).toEqual(['eth_accounts','eth_chainId']);expect(v.get('send').disabled).toBe(true);v.dispose();});
it('blocks readiness when the attempt journal cannot be read',async()=>{const v=view();ready(v);vi.stubGlobal('localStorage',{getItem:()=>{throw Error('Unavailable');}});v.get('wallet-check').onclick?.();await vi.waitFor(()=>expect(v.get('wallet-status').textContent).toContain('Deployment journal unavailable'));expect(v.get('send').disabled).toBe(true);v.dispose();});

it('diagnoses observed numeric nonce with no signing bundle or permission and cleans up the added control',async()=>{
 const v=view();ready(v);const original=v.request.getMockImplementation();if(!original)throw Error('Fake missing');v.request.mockImplementation(args=>args.method==='eth_getTransactionCount'?Promise.resolve(47):original(args));const diagnostic=v.get('wallet-check').afterNode;if(!diagnostic)throw Error('Diagnostic control missing');diagnostic.onclick?.();await vi.waitFor(()=>expect(v.get('wallet-status').textContent).toContain('type=number, hexQuantity=false, accepted=true 47'));expect(v.get('send').disabled).toBe(true);expect(v.request.mock.calls.some(([a])=>a.method==='eth_requestAccounts'||a.method==='eth_sendTransaction')).toBe(false);v.dispose();expect(diagnostic.removed).toBe(true);
});
