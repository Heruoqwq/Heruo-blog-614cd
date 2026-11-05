import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.transpileModule(readFileSync(new URL('../app/session.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function memory(values={}){const map=new Map(Object.entries(values));return{getItem(k){return map.get(k)||null;},setItem(k,v){map.set(k,v);},removeItem(k){map.delete(k);}};}
function load(localStorage,sessionStorage){const context={exports:{},localStorage,sessionStorage};vm.runInNewContext(source,context);return context.exports;}
const key='tony-journal-session',token='a'.repeat(64);
test('An existing tab session migrates to persistent storage and explicit logout clears both stores',()=>{
 const local=memory(),tab=memory({[key]:token}),api=load(local,tab);
 assert.equal(api.readSession(),token);assert.equal(local.getItem(key),token);assert.equal(tab.getItem(key),null);
 assert.equal(load(local,memory()).readSession(),token);
 api.clearSession();assert.equal(local.getItem(key),null);assert.equal(tab.getItem(key),null);
});
test('Blocked storage does not crash login and falls back to tab storage when available',()=>{
 const blocked={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');},removeItem(){throw new Error('blocked');}},tab=memory(),api=load(blocked,tab);
 api.saveSession(token);assert.equal(api.readSession(),token);api.clearSession();assert.equal(api.readSession(),'');
 const unavailable=load(blocked,blocked);assert.doesNotThrow(()=>unavailable.saveSession(token));assert.equal(unavailable.readSession(),'');assert.doesNotThrow(()=>unavailable.clearSession());
});
