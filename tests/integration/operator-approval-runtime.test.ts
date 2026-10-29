import {describe,it,expect} from 'vitest';
import {operatorFixture} from './operator-approval.fixture';
import {validatePreparation} from '../../apps/api/src/attempt-evidence';
import {assertOperatorApprovalBinding} from '../../apps/api/src/operator-approval';
const ws='11111111-1111-4111-8111-111111111111',draft='22222222-2222-4222-8222-222222222222';
const input=(account:string)=>({workspaceId:ws,actor:account,chainId:'5042002',resource:'draft:'+draft,action:'approve-creation'});
describe('synthetic operator API composition',()=>{
 it('verifies artifacts then prepares only the SDK exact initial funding approval',async()=>{const f=await operatorFixture(),i=input(f.account),p=await f.composed.adapter.prepare(i);validatePreparation(p,i);expect(p.source).toBe('OPERATOR_CONFIGURED');expect(p.approval?.amount).toBe('4000000');expect(p.value).toBe('0');expect(p.networkNonce).toBe('0');expect(p.approval?.spender).toBe(f.f.config.deployment.factoryAddress);});
 it('rejects another actor and action',async()=>{const f=await operatorFixture();await expect(f.composed.adapter.prepare(input('0x'+'9'.repeat(40)))).rejects.toThrow('client');await expect(f.composed.adapter.prepare({...input(f.account),action:'fund-next-period'})).rejects.toThrow('Only');});
 it('blocks paired nonce disagreement',async()=>{const f=await operatorFixture();f.setDisagree();await expect(f.composed.adapter.prepare(input(f.account))).rejects.toThrow('Nonce');});
 it('binds the adapter to its exact server runtime and pool',async()=>{const f=await operatorFixture();expect(()=>assertOperatorApprovalBinding(f.composed.adapter,f.cfg,f.pool,f.composed.runtime)).not.toThrow();expect(()=>assertOperatorApprovalBinding(f.composed.adapter,f.cfg,f.pool,{})).toThrow('binding');});
});
