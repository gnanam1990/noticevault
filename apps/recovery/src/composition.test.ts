import {describe,it,expect,vi} from 'vitest';
import {keccak256} from 'viem';
import {composeRecoveryClaims} from './composition';
import {parseRecoveryConfig} from './config';
import {stringify} from './recovery';
import {agreementFixture} from './fixture';
import {browserClaimJournal} from './journal';
import {reconcileCanonical} from '../../../apps/api/src/canonical-reconciliation';
import {businessFixture} from '../../../apps/api/src/test/business-fixture';
function config(){const f=agreementFixture();return parseRecoveryConfig(stringify({schemaVersion:1,manifest:f.dep,agreementCodeHash:keccak256('0x6002'),primaryRpcOrigin:'https://primary.example',verificationRpcOrigin:'https://verification.example'}));}
const finality={network:'ARC_TESTNET' as const,chainId:5042002n,kind:'COMMITTED_INCLUSION' as const,verification:'TWO_PROVIDERS' as const};
const journal=browserClaimJournal({getItem:()=>null,setItem:()=>{},key:()=>null,length:0},{request:async(_name,fn)=>fn()});
describe('production recovery composition gates',()=>{
it('missing deployment acceptance prevents even wallet connection with no network calls',async()=>{const request=vi.fn(),fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('unexpected network'));try{const runtime=composeRecoveryClaims(config(),finality,{request},journal);await expect(runtime.connect()).rejects.toThrow('DEPLOYMENT_ARTIFACT_ACCEPTANCE_REQUIRED');expect(request).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();runtime.dispose();}finally{fetch.mockRestore();}});
it('rejects unsupported finality before any wallet request',()=>{const request=vi.fn();expect(()=>composeRecoveryClaims(config(),{...finality,kind:'CONFIRMATIONS'} as never,{request},journal)).toThrow();expect(request).not.toHaveBeenCalled();});
it('rejects mismatched acceptance instead of a boolean enable flag',async()=>{const request=vi.fn();const runtime=composeRecoveryClaims(config(),finality,{request},journal,{verify:async()=>({configurationDigest:keccak256('0x'),manifestDigest:keccak256('0x'),agreementCodeHash:keccak256('0x'),finalityDigest:keccak256('0x'),expiresAt:Date.now()+1000})});await expect(runtime.connect()).rejects.toThrow('DEPLOYMENT_ACCEPTANCE_MISMATCH');expect(request).not.toHaveBeenCalled();});
it.each(['claim-provider','claim-client-refund'] as const)('shared browser-safe reconciliation verifies real %s payout evidence',async action=>{const f=businessFixture(action);const r=await reconcileCanonical(f.adapter,f.p);expect(r.state).toBe('confirmed');expect(r.proof?.outcome?.kind).toBe('TRANSFER');});
it('zero claim verifies NO_CHANGE rather than fabricating a transfer',async()=>{const f=businessFixture('claim-provider',true);const r=await reconcileCanonical(f.adapter,f.p);expect(r.state).toBe('confirmed');expect(r.proof?.outcome?.kind).toBe('NO_CHANGE');});
it('forged payout and conflicting identity do not resolve unknowns',async()=>{const f=businessFixture('claim-provider');await expect(reconcileCanonical({...f.adapter,verifyBusiness:async()=>({kind:'TRANSFER'} as never)},f.p)).rejects.toThrow();const r=await reconcileCanonical(f.adapter,{...f.p,actor:'0x9999999999999999999999999999999999999999'});expect(r.state).not.toBe('confirmed');});
});
