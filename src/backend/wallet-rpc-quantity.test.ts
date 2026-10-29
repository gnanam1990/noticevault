import {describe,it,expect} from 'vitest';
import {parseWalletQuantity} from './wallet-rpc-quantity';
describe('observed numeric wallet nonce compatibility',()=>{
 it('maps observed 47 exactly to canonical 0x2f without changing its value',()=>{expect(parseWalletQuantity(47,'eth_getTransactionCount')).toBe(47n);expect(parseWalletQuantity('0x2f','eth_getTransactionCount')).toBe(47n);});
 it('supports exact safe-integer boundaries and uint64 hex',()=>{expect(parseWalletQuantity(0,'eth_getTransactionCount')).toBe(0n);expect(parseWalletQuantity(Number.MAX_SAFE_INTEGER,'eth_getTransactionCount')).toBe(BigInt(Number.MAX_SAFE_INTEGER));expect(parseWalletQuantity('0xffffffffffffffff','eth_getTransactionCount')).toBe((1n<<64n)-1n);});
 it.each([-1,-0,1.5,Number.MAX_SAFE_INTEGER+1,NaN,Infinity,-Infinity,null,undefined,47n,{},[],true,'47','0x','0x00','0x02f','0X2f',' 0x2f','0x-1','0x10000000000000000'])('rejects invalid nonce representation %#',value=>{expect(()=>parseWalletQuantity(value,'eth_getTransactionCount')).toThrow('eth_getTransactionCount');});
 it.each(['eth_chainId','eth_estimateGas','eth_gasPrice','eth_getBalance'])('does not broaden numeric acceptance for %s',method=>{expect(()=>parseWalletQuantity(47,method)).toThrow(method);expect(parseWalletQuantity('0x2f',method)).toBe(47n);});
 it('enforces canonical hex and uint256 bounds for other quantities',()=>{expect(parseWalletQuantity('0x0','eth_gasPrice')).toBe(0n);expect(parseWalletQuantity('0x'+'f'.repeat(64),'eth_getBalance')).toBe((1n<<256n)-1n);for(const value of ['0x00','0x01','0x'+'1'.repeat(65),{result:'0x2f'}])expect(()=>parseWalletQuantity(value,'eth_gasPrice')).toThrow('eth_gasPrice');});
 it('never echoes raw provider strings or error envelopes',()=>{const secret='https://provider.invalid/private-token';expect(()=>parseWalletQuantity(secret,'eth_gasPrice')).toThrow('type string');try{parseWalletQuantity(secret,'eth_gasPrice');}catch(error){expect(String(error)).not.toContain(secret);}});
});
