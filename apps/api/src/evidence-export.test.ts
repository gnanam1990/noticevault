import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {publicFields,sealEvidence} from './evidence-export.js';
describe('evidence export privacy boundary',()=>{
 it('allowlists scalar public fields and drops private nested data',()=>{const input={amount:'0',recipient:'0x'+'1'.repeat(40),contact:'PRIVATE_CANARY',document:{text:'PRIVATE_CANARY'},unexpected:'42'};const result=publicFields(input,['amount','recipient']);expect(result).toEqual({amount:'0',recipient:input.recipient});expect(JSON.stringify(result)).not.toContain('PRIVATE_CANARY');});
 it('never carries arbitrary text or nested data in numeric/address fields',()=>{expect(publicFields({amount:'PRIVATE_CANARY',recipient:{email:'PRIVATE_CANARY'}},['amount','recipient'])).toEqual({});});
 it('checksum covers exact artifact bytes including missing evidence',()=>{const artifact={status:'INCOMPLETE',missing:['receipts'],amount:'0'};const sealed=sealEvidence(artifact);expect(sealed.sha256).toBe(createHash('sha256').update(JSON.stringify(artifact)).digest('hex'));expect(sealEvidence({...artifact,amount:'1'}).sha256).not.toBe(sealed.sha256);});
});
