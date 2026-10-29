import test from 'node:test';
import assert from 'node:assert/strict';
import {fixturePromise} from './test-promise.mjs';
await test('fixture side effects remain synchronous and values resolve',()=>{let observed=false;const result=fixturePromise(()=>{observed=true;return 7;});assert.equal(observed,true);return result.then(value=>assert.equal(value,7));});
await test('synchronous fixture exceptions remain promise rejections',()=>{const error=new Error('synthetic failure');let result;assert.doesNotThrow(()=>{result=fixturePromise(()=>{throw error;});});return assert.rejects(result,error);});
await test('fixture promise results are adopted',()=>fixturePromise(()=>Promise.resolve(9)).then(value=>assert.equal(value,9)));
