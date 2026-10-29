import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {privateKeyToAccount} from 'viem/accounts';
import {keccak256,toHex,type Hex} from 'viem';
export async function checkIsolation(results:unknown[],measure:(name:string,count:number,action:()=>Promise<void>)=>Promise<void>){
 const origin='https://noticevault.gnanasekaran-sekareee.workers.dev',base=origin+'/api',headers={Origin:origin,'X-Requested-With':'XMLHttpRequest','Content-Type':'application/json'};
 const send=async(path:string,method='GET',body?:unknown,cookie='',extra:Record<string,string>={})=>fetch(base+path,{method,headers:{...headers,...(cookie?{Cookie:cookie}:{}),...extra},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
 async function login(key:'01'|'02'){const a=privateKeyToAccount(('0x'+key.repeat(32)) as Hex);const c=await (await send('/auth/challenge','POST',{address:a.address,chainId:5042002})).json() as {message:string;nonce:string};const body={address:a.address,chainId:5042002,nonce:c.nonce,signature:await a.signMessage({message:c.message})};const r=await send('/auth/verify','POST',body);assert.equal(r.status,200);await r.text();return {address:a.address,cookie:r.headers.get('set-cookie')!.split(';')[0]};}
 const [a,b]=await Promise.all([login('01'),login('02')]);
 const create=async(who:typeof a,name:string)=>{const r=await send('/workspaces','POST',{name},who.cookie,{'idempotency-key':randomUUID()});assert.equal(r.status,201);return await r.json() as {id:string};};
 const [wa,wb]=await Promise.all([create(a,'Synthetic isolated A'),create(b,'Synthetic isolated B')]);
 for(let i=0;i<12;i++){const [ra,rb]=await Promise.all([send('/auth/me','GET',undefined,a.cookie),send('/auth/me','GET',undefined,b.cookie)]);assert.equal(ra.status,200);assert.equal(rb.status,200);assert.notDeepEqual(await ra.json(),await rb.json());}
 for(const [cookie,ws] of [[a.cookie,wb],[b.cookie,wa]] as const){const r=await send('/workspaces/'+ws.id,'GET',undefined,cookie);assert.equal(r.status,403);await r.text();}
 const now=Math.floor(Date.now()/1000),doc='Synthetic actor A private bytes',terms={schemaVersion:1,client:a.address,provider:b.address,token:'0x'+'44'.repeat(20),amountPerPeriod:'3000000000',periodSeconds:'2592000',noticeSeconds:'2592000',startAt:String(now+7200),clientNonce:'0',acceptanceDeadline:String(now+3600),termsDocumentHash:keccak256(toHex(doc))};
 const d=await send('/workspaces/'+wa.id+'/immutable-drafts','POST',{termsJson:terms,documentText:doc,expectedRevisionNumber:0},a.cookie,{'idempotency-key':randomUUID()});assert.equal(d.status,201);const draft=await d.json() as {id:string};
 const packet='/workspaces/'+wa.id+'/revisions/'+draft.id+'/acceptance-packet';
 for(const ip of ['hosted-route']){const r=await send(packet,'GET',undefined,b.cookie,{});assert.equal(r.status,403);await r.text();const own=await send(packet,'GET',undefined,a.cookie,{});assert.equal(own.status,200);assert.equal((await own.json() as {documentText:string}).documentText,doc);}
 for(const extra of [{Origin:''},{Origin:'https://forged.invalid'},{'X-Requested-With':''}]){const r=await send('/auth/logout','POST',{},a.cookie,extra);assert.equal(r.status,403);await r.text();}
 const key=randomUUID(),body={name:'Synthetic interrupted '+key},controller=new AbortController();const pending=fetch(base+'/workspaces',{method:'POST',headers:{...headers,Cookie:a.cookie,'idempotency-key':key},body:JSON.stringify(body),signal:controller.signal});setTimeout(()=>controller.abort(),2);let interrupted=false;try{const r=await pending;await r.text();}catch{interrupted=true;}
 const retry=await send('/workspaces','POST',body,a.cookie,{'idempotency-key':key}),again=await send('/workspaces','POST',body,a.cookie,{'idempotency-key':key});assert.equal(retry.status,201);assert.equal(again.status,201);assert.equal((await retry.json() as {id:string}).id,(await again.json() as {id:string}).id);
 const logout=await send('/auth/logout','POST',{},a.cookie);assert.equal(logout.status,200);await logout.text();assert.equal((await send('/auth/me','GET',undefined,a.cookie)).status,401);assert.equal((await send('/auth/me','GET',undefined,b.cookie)).status,200);await send('/auth/logout','POST',{},b.cookie);
 results.push({name:'concurrent-user-isolation',passed:true,hostedRouting:true,bucketDistributionNotMeasured:true,originCsrfPreserved:true,interruptedClient:interrupted,idempotentRetry:true,revocationIsolated:true});
}
