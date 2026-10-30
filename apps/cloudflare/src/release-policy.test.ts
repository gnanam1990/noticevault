import assert from 'node:assert/strict';
import {test} from 'node:test';
import {releaseAssetResponse} from './release-headers';
import {nextIndexerDelay} from './indexer-schedule';
await test('release denies framing while preserving existing policy and response bytes',async()=>{
 const r=releaseAssetResponse(new Response('public app',{status:200,headers:{'Content-Security-Policy':"default-src 'self'",'Cache-Control':'no-store'}}));
 assert.ok(r.headers.get('Content-Security-Policy')?.includes("default-src 'self'"));
 assert.ok(r.headers.get('Content-Security-Policy')?.includes("frame-ancestors 'none'"));
 assert.equal(r.headers.get('X-Frame-Options'),'DENY');assert.equal(await r.text(),'public app');assert.equal(r.headers.get('Cache-Control'),'no-store');
});
await test('unfinished work resumes promptly and idle/error states retain bounded backoff',()=>{
 assert.equal(nextIndexerDelay({state:'limit',steps:250,inserted:250,head:'250'},60000),1000);
 assert.equal(nextIndexerDelay({state:'idle',steps:1,inserted:0,head:'250'},60000),60000);
 assert.equal(nextIndexerDelay(undefined,60000),60000);
 assert.equal(nextIndexerDelay({state:'stopped',steps:0,inserted:0,head:'0'},60000),60000);
 assert.equal(nextIndexerDelay({state:'stopped',steps:3,inserted:1,head:'3'},60000),1000);
});
await test('invalid scheduling intervals are rejected',()=>{for(const interval of [0,NaN,Infinity,59999,3600001])assert.throws(()=>nextIndexerDelay(undefined,interval),/INTERVAL_REQUIRED/);});
