// Probe-only static equivalents for find-my-way 9.9.0 compiler optimizations.
// No eval/Function constructor, no new routes, no security flags, no Node-path import.
import pkg from 'find-my-way/package.json' with {type:'json'};
const {version}=pkg;
if(version!=='9.9.0')throw Error('STATIC_ROUTER_VERSION_MISMATCH');
import nodes from 'find-my-way/lib/node.js';
const {StaticNode}=nodes;
import HandlerStorage from 'find-my-way/lib/handler-storage.js';
import Constrainer from 'find-my-way/lib/constrainer.js';
import nullObjectModule from 'find-my-way/lib/null-object.js';
const {NullObject}=nullObjectModule;
StaticNode.prototype._compilePrefixMatch=function(){
 const codes=[];for(let i=1;i<this.prefix.length;i++)codes.push(this.prefix.charCodeAt(i));
 this.matchPrefix=(path,i)=>{for(let j=0;j<codes.length;j++)if(path.charCodeAt(i+j+1)!==codes[j])return false;return true;};
};
HandlerStorage.prototype._compileCreateParamsObject=function(params){
 const names=params.slice();return values=>{const result=new NullObject();for(let i=0;i<names.length;i++)result[names[i]]=values[i];return result;};
};
HandlerStorage.prototype._compileGetHandlerMatchingConstraints=function(constrainer){
 this.constrainedHandlerStores={};
 const checks=this.constraints.map(key=>{const store=constrainer.newStoreForConstraint(key);this.constrainedHandlerStores[key]=store;this._buildConstraintStore(store,key);return {key,mask:this._constrainedIndexBitmask(key),must:constrainer.strategies[key].mustMatchWhenDerived};});
 const absent=Object.keys(constrainer.strategies).filter(key=>constrainer.strategies[key].mustMatchWhenDerived&&!this.constraints.includes(key));
 const initial=(1<<this.handlers.length)-1;
 this._getHandlerMatchingConstraints=function(derived){
  let candidates=initial;
  for(const {key,mask,must} of checks){const value=derived[key];if(value===undefined)candidates&=mask;else{const matches=this.constrainedHandlerStores[key].get(value)||0;candidates&=must?matches:(matches|mask);}if(candidates===0)return null;}
  for(const key of absent)if(derived[key]!==undefined)return null;
  return this.handlers[31-Math.clz32(candidates)];
 };
};
Constrainer.prototype._buildDeriveConstraints=function(){
 if(this.strategiesInUse.size===0)return;
 const keys=[...this.strategiesInUse];
 this.deriveSyncConstraints=function(req,ctx){const out={};for(const key of keys){const strategy=this.strategies[key];out[key]=strategy.isCustom?strategy.deriveConstraint(req,ctx):key==='version'?req.headers['accept-version']:(req.headers.host||req.headers[':authority']);}return out;};
};
