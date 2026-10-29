import {fixturePromise} from "../../scripts/test-promise.mjs";
import {it,expect} from 'vitest';
import {keccak256,toHex} from 'viem';
import {AuthoringController,type Journal,type Intent} from './authoring';
import {DraftReviewClient} from './draft-review';
it('retries the exact immutable document and key after a lost response and reload',async()=>{
 const ws='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',key='33333333-3333-4333-8333-333333333333',address='0x'+'1'.repeat(40),documentText='Synthetic private terms — exact UTF-8';
 const terms={schemaVersion:1,client:address,provider:'0x'+'2'.repeat(40),token:'0x'+'3'.repeat(40),amountPerPeriod:'100',periodSeconds:'60',noticeSeconds:'60',startAt:'1',clientNonce:'1',acceptanceDeadline:'2000000000',termsDocumentHash:keccak256(toHex(documentText))};
 let stored:string|null=null,lose=true;const sends:{url:string;body:string;key:string|null}[]=[];
 const journal:Journal={read:()=>stored,write:v=>{stored=v;},clear:()=>{stored=null;},exclusive:fn=>fn()};
 const api=new DraftReviewClient((url,init)=>{return fixturePromise(()=>{if(String(url).endsWith('/auth/me'))return Response.json({address,chainId:'31337',expiresAt:'2030-01-01T00:00:00Z',workspaceId:null});if(typeof init?.body!=='string')throw Error('Expected serialized JSON body');sends.push({url:String(url),body:init.body,key:new Headers(init?.headers).get('Idempotency-Key')});if(lose){lose=false;throw Error('lost response');}return Response.json({id,workspace_id:ws,author_address:address,version:1,status:'draft',doc_hash:terms.termsDocumentHash,terms_json:terms});});});
 const intent:Intent={kind:'create',workspaceId:ws,terms,documentText};const controller=()=>new AuthoringController(api,{address,chainId:'31337'},journal,()=>key);
 await expect(controller().submit(intent)).rejects.toThrow();expect(stored).toContain(documentText);
 await expect(controller().submit({...intent,documentText:'changed'})).rejects.toThrow('uncertain');expect(sends).toHaveLength(1);
 await controller().submit();expect(sends).toHaveLength(2);expect(sends[1]).toEqual(sends[0]);expect(sends[0].url).toBe('/api/workspaces/'+ws+'/immutable-drafts');expect(JSON.parse(sends[0].body)).toEqual({termsJson:terms,documentText,expectedRevisionNumber:0});expect(stored).toBeNull();
});
