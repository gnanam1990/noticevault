import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,it,expect,vi} from 'vitest';
import {parseArcTestnetManifest,loadArcTestnetManifest} from '../deployment-manifest.js';
const fixture=()=>({configIdentity:'ARC_TESTNET',chainId:'5042002',factoryAddress:'0x'+'1'.repeat(40),allowlistedToken:'0x'+'2'.repeat(40),expectedFactoryCodeHash:'0x'+'a'.repeat(64),expectedTokenCodeHash:'0x'+'b'.repeat(64),isLive:false,label:'[TEST DATA] Synthetic test manifest'});
describe('strict Arc testnet manifest',()=>{
 it('uses the real filesystem loader only for an isolated synthetic file',()=>{const dir=mkdtempSync(join(tmpdir(),'noticevault-manifest-test-'));try{const path=join(dir,'manifest.json');writeFileSync(path,JSON.stringify(fixture()));expect(loadArcTestnetManifest(path).factoryAddress).toBe(fixture().factoryAddress);}finally{rmSync(dir,{recursive:true,force:true});}});
 it('does not interpret quoted label content as object fields',()=>{const f=fixture();f.label='Synthetic "chainId": label';expect(parseArcTestnetManifest(JSON.stringify(f)).label).toBe(f.label);});
 it('parses owned immutable descriptor without treating it as deployment proof',()=>{const parsed=parseArcTestnetManifest(JSON.stringify(fixture()));expect(parsed.chainId).toBe(5042002n);expect(parsed.isLive).toBe(false);expect(Object.isFrozen(parsed)).toBe(true);});
 it.each(Object.keys(fixture()))('rejects missing %s',key=>{const f:Record<string,unknown>=fixture();delete f[key];expect(()=>parseArcTestnetManifest(JSON.stringify(f))).toThrow();});
 it.each([{chainId:5042002},{chainId:'05042002'},{chainId:'1'},{configIdentity:'LOCAL_FIXTURE'},{isLive:true},{factoryAddress:null},{factoryAddress:'0x'+'0'.repeat(40)},{allowlistedToken:'bad'},{expectedFactoryCodeHash:'0x'+'0'.repeat(64)},{expectedTokenCodeHash:12},{label:''},{label:'x'.repeat(257)},{label:'bad\nlabel'},{extra:'ignored'},{rpcUrl:'https://invalid.example'}])('rejects invalid or unknown descriptor fields',change=>{expect(()=>parseArcTestnetManifest(JSON.stringify({...fixture(),...change}))).toThrow();});
 it.each(['null','[]','{}','{bad','x'.repeat(16385)])('rejects malformed document',text=>{expect(()=>parseArcTestnetManifest(text)).toThrow();});
 it('rejects duplicate keys including escaped key spelling',()=>{const s=JSON.stringify(fixture());expect(()=>parseArcTestnetManifest(s.replace('{','{"chainId":"1",'))).toThrow();expect(()=>parseArcTestnetManifest(s.replace('{','{"chain\\u0049d":"1",'))).toThrow();});
 it('loads only an explicit local path through the supplied reader',()=>{const read=vi.fn(()=>JSON.stringify(fixture()));expect(loadArcTestnetManifest('/synthetic/manifest.json',read).chainId).toBe(5042002n);expect(read).toHaveBeenCalledWith('/synthetic/manifest.json');});
 it.each(['','relative.json','https://invalid.example/manifest','/bad\0path'])('rejects invalid path before reading',path=>{const read=vi.fn();expect(()=>loadArcTestnetManifest(path,read)).toThrow();expect(read).not.toHaveBeenCalled();});
 it('propagates missing file without fallback descriptor',()=>{expect(()=>loadArcTestnetManifest('/missing.json',()=>{throw new Error('missing');})).toThrow();});
});
