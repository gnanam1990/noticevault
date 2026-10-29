import {parseAttempt,parseAttemptText,parseAttemptEntries} from './attempt-values';
import type {Attempt,AttemptStore} from './transaction-review.js';
export type CreationAction='approve-creation'|'create-agreement';
type StoragePort=Pick<Storage,'getItem'|'setItem'|'key'|'length'>;
/** Account-independent scope; read-only legacy lookup prevents escaping an old uncertain attempt. */
export function creationAttemptStore(storage:StoragePort,chain:string,workspace:string,draft:string,action:CreationAction):AttemptStore{
 const suffix=':'+chain+':'+workspace+':'+draft,key='noticevault:synthetic-creation:v1'+suffix;
 type Entry={action:CreationAction;attempt:Attempt};
 function entries():Entry[]{const raw=storage.getItem(key);return raw===null?[]:parseAttemptEntries(raw,['approve-creation','create-agreement'] as const);}
 function legacy(){const found:Attempt[]=[];for(let i=0;i<storage.length;i++){const k=storage.key(i);if(k?.startsWith('noticevault:synthetic-attempt:v1:')&&k.endsWith(suffix)){const raw=storage.getItem(k);if(raw!==null)found.push(parseAttemptText(raw));}}return found;}
 return {read(){const old=legacy();const all=entries(),latest=new Map<string,Entry>();for(const e of all)latest.set(e.attempt.key,e);const unresolved=[...old,...[...latest.values()].map(e=>e.attempt)].find(a=>['unknown','submitted'].includes(a.status));if(unresolved)return unresolved;const current=[...all].reverse().find(e=>e.action===action)?.attempt;if(current)return current;return action==='create-agreement'?old.find(a=>a.status!=='rejected')??null:null;},write(attempt){const all=entries();all.push({action,attempt:parseAttempt({...attempt})});storage.setItem(key,JSON.stringify(all));}};
}
export const browserCreationStorage:StoragePort={getItem:k=>localStorage.getItem(k),setItem:(k,v)=>localStorage.setItem(k,v),key:i=>localStorage.key(i),get length(){return localStorage.length;}};
