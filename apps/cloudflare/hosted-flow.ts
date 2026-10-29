import assert from 'node:assert/strict';
import {privateKeyToAccount} from 'viem/accounts';
import {keccak256,toHex} from 'viem';
import {randomUUID} from 'node:crypto';
export async function checkFlows(results:unknown[],measure:(name:string,count:number,action:()=>Promise<void>)=>Promise<void>){
 // Published Hardhat fixture key, never a user wallet or deployed account.
 const account=privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
 const origin='https://noticevault.gnanasekaran-sekareee.workers.dev',base=origin+'/api',headers={Origin:origin,'X-Requested-With':'XMLHttpRequest','Content-Type':'application/json'};let cookie='';
 const req=async(name:string,path:string,status:number,method='GET',body?:unknown,key?:string,session=cookie)=>{const r=await fetch(base+path,{method,headers:{...headers,...(session?{Cookie:session}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});const text=await r.text();results.push({name,status:r.status,expected:status});assert.equal(r.status,status,name+': '+text);return {body:text?JSON.parse(text):null,headers:r.headers};};
 const challenge=(await req('fresh-auth-challenge','/auth/challenge',200,'POST',{address:account.address,chainId:5042002})).body;
 assert.ok(challenge.message.includes(origin+'/auth/verify'));assert.ok(challenge.message.includes('5042002'));
 const auth={address:account.address,chainId:5042002,nonce:challenge.nonce,signature:await account.signMessage({message:challenge.message})};
 const verified=await req('real-ecdsa-fixture-login','/auth/verify',200,'POST',auth);cookie=verified.headers.get('set-cookie')!.split(';')[0];assert.ok(cookie.startsWith('nv_session='));
 await req('nonce-replay','/auth/verify',401,'POST',auth);
 await req('session-restored','/auth/me',200);
 const key=randomUUID(),workspace={name:'Synthetic Workers acceptance — no real parties'};
 const ws=(await req('workspace-create','/workspaces',201,'POST',workspace,key)).body;
 assert.equal((await req('workspace-idempotent-retry','/workspaces',201,'POST',workspace,key)).body.id,ws.id);
 const document='Synthetic hosted acceptance document. No actual agreement.',now=Math.floor(Date.now()/1000);
 const terms={schemaVersion:1,client:account.address,provider:'0x'+'22'.repeat(20),token:'0x'+'44'.repeat(20),amountPerPeriod:'3000000000',periodSeconds:'2592000',noticeSeconds:'2592000',startAt:String(now+7200),clientNonce:'0',acceptanceDeadline:String(now+3600),termsDocumentHash:keccak256(toHex(document))};
 const payload={termsJson:terms,documentText:document,expectedRevisionNumber:0},draftKey=randomUUID(),root='/workspaces/'+ws.id;
 const draft=(await req('immutable-document-create',root+'/immutable-drafts',201,'POST',payload,draftKey)).body;
 assert.equal((await req('document-idempotent-retry',root+'/immutable-drafts',201,'POST',payload,draftKey)).body.id,draft.id);
 const packet=root+'/revisions/'+draft.id+'/acceptance-packet',p=(await req('private-document-read',packet,200)).body;assert.equal(p.documentText,document);assert.equal(p.consentAvailable,false);
 await req('private-document-anonymous',packet,401,'GET',undefined,undefined,'');
 await req('document-hash-tamper',root+'/immutable-drafts',409,'POST',{...payload,documentText:'tampered'},randomUUID());
 const revisionPath=root+'/drafts/'+draft.id+'/revisions';
 const next=(await req('immutable-next-revision',revisionPath,201,'POST',{...payload,expectedRevisionNumber:1},randomUUID())).body;assert.notEqual(next.id,draft.id);
 await req('stale-revision-rejected',revisionPath,409,'POST',{...payload,expectedRevisionNumber:1},randomUUID());
 assert.equal((await req('original-bytes-preserved',packet,200)).body.documentText,document);
 await req('membership-read',root+'/memberships',200);
 await req('execution-disabled','/readiness',503);
 await req('logout','/auth/logout',200,'POST',{});await req('revoked-session-denied','/auth/me',401);
 return {workspaceId:ws.id,revisionId:draft.id};
}
