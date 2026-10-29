import assert from 'node:assert/strict';import {privateKeyToAccount} from 'viem/accounts';
const origin='https://noticevault.gnanasekaran-sekareee.workers.dev',headers={Origin:origin,'X-Requested-With':'XMLHttpRequest','Content-Type':'application/json'};
const account=privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const call=(path:string,body:unknown,cookie='')=>fetch(origin+'/api'+path,{method:'POST',headers:{...headers,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
const c=await(await call('/auth/challenge',{address:account.address,chainId:5042002})).json();assert.ok(c.message.includes(origin+'/auth/verify'));
const v=await call('/auth/verify',{address:account.address,chainId:5042002,nonce:c.nonce,signature:await account.signMessage({message:c.message})});assert.equal(v.status,200);const cookie=v.headers.get('set-cookie')||'';await v.text();
const flags={secure:/;\s*Secure/i.test(cookie),httpOnly:/;\s*HttpOnly/i.test(cookie),sameSite:/;\s*SameSite=(Strict|Lax)/i.test(cookie)};assert.equal((await call('/auth/logout',{},cookie.split(';')[0])).status,200);assert.ok(Object.values(flags).every(Boolean));console.log('HOSTED_COOKIE_FLAGS_PASS',JSON.stringify(flags));
