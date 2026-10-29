import {describe,it,expect,vi} from 'vitest';
import {OWNER_JOURNAL_KEY,readOwnerJournal} from './owner-journal-status';
const entry={state:'unknown',chainId:5042,from:'0xff525d6940ad0e308ed6eda443c792694353f9da',nonce:'47',checksum:'a'.repeat(64),initCodeKeccak:'0x'+'b'.repeat(64)};
describe('exact-key read-only owner journal',()=>{
 it('reads exactly one key and does not claim global clearance',()=>{const read=vi.fn(()=>null);expect(readOwnerJournal(read)).toContain('does not clear other origins');expect(read.mock.calls).toEqual([[OWNER_JOURNAL_KEY]]);});
 it('reports unknown attempts without clearing them',()=>{expect(readOwnerJournal(()=>JSON.stringify(entry))).toContain('Prior attempt: unknown; chain 5042; nonce 47');});
 it('reports a submitted transaction hash',()=>{const hash='0x'+'c'.repeat(64);expect(readOwnerJournal(()=>JSON.stringify({...entry,state:'submitted',hash}))).toContain(hash);});
 it.each([null,[],{...entry,chainId:5042002},{...entry,from:'0x'+'0'.repeat(40)},{...entry,nonce:'-1'},{...entry,nonce:String(2n**256n)},{...entry,state:'submitted',hash:'invalid'}])('blocks malformed or mismatched record %j',value=>{expect(readOwnerJournal(()=>JSON.stringify(value))).toMatch(/blocked/);});
 it('does not leak malformed content or exceptions',()=>{expect(readOwnerJournal(()=>'{private data')).not.toContain('private data');expect(readOwnerJournal(()=>{throw Error('private data')})).not.toContain('private data');});
 it('bounds record size',()=>{expect(readOwnerJournal(()=>'x'.repeat(4097))).toContain('blocked');});
});
