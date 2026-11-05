import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.transpileModule(readFileSync(new URL('../app/theme.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function setup(values={},prefersDark=false,blocked=false){
 const entries=new Map(Object.entries(values));
 const document={documentElement:{dataset:{},style:{}}};
 const storage={getItem(k){if(blocked)throw new Error('blocked');return entries.get(k)||null;},setItem(k,v){if(blocked)throw new Error('blocked');entries.set(k,v);}};
 const context={exports:{},localStorage:storage,document,window:{matchMedia(){return{matches:prefersDark};}}};
 vm.runInNewContext(source,context);
 return{api:context.exports,document,entries,bootstrap(){vm.runInNewContext(context.exports.themeBootstrap,context);}};
}
test('Six palette choices are whitelisted; malformed saved data never becomes a CSS selector or executable attribute',()=>{
 const {api}=setup();assert.equal(api.palettes.length,6);
 for(const p of api.palettes)assert.equal(api.normalizeAppearance({palette:p.id,mode:'dark'}).palette,p.id);
 for(const raw of [null,[],42,'blue',{palette:'<script>',mode:'unexpected'},{palette:'constructor',mode:'toString'}]){
  const p=api.normalizeAppearance(raw);assert.equal(p.palette,'violet');assert.equal(p.mode,'system');
 }
});
test('Existing dark preference migrates; new palette and mode persist independently without changing login data',()=>{
 const old=setup({'tony-theme':'dark','tony-journal-session':'keep-this-session'}),p=old.api.readAppearance();
 assert.equal(p.palette,'violet');assert.equal(p.mode,'dark');
 old.api.saveAppearance({palette:'jade',mode:'system'});
 const next=old.api.readAppearance();assert.equal(next.palette,'jade');assert.equal(next.mode,'system');
 assert.equal(old.entries.get('tony-journal-session'),'keep-this-session');
 old.api.applyAppearance(next,true);assert.equal(old.document.documentElement.dataset.theme,'dark');
 old.api.applyAppearance(next,false);assert.equal(old.document.documentElement.dataset.theme,'light');
});
test('Explicit appearance overrides the system; blocked storage and corrupt JSON preserve a usable default',()=>{
 const {api}=setup();assert.equal(api.resolvedTheme('dark',false),'dark');assert.equal(api.resolvedTheme('light',true),'light');
 for(const env of [setup({'heruo-appearance':'invalid json'}),setup({},true,true)]){
  const p=env.api.readAppearance();assert.equal(p.palette,'violet');assert.equal(p.mode,'system');
  assert.doesNotThrow(()=>env.api.saveAppearance(p));assert.doesNotThrow(()=>env.bootstrap());
 }
});
test('Pre-paint script and hydrated controls agree for legacy, stored and system themes',()=>{
 for(const values of [{},{'tony-theme':'dark'},{'heruo-appearance':JSON.stringify({palette:'rose',mode:'light'})},{'heruo-appearance':JSON.stringify({palette:'blue',mode:'system'})},{'heruo-appearance':JSON.stringify({palette:'invalid',mode:'invalid'})}])for(const dark of [false,true]){
  const env=setup(values,dark);env.bootstrap();const initial={...env.document.documentElement.dataset};
  env.api.applyAppearance(env.api.readAppearance(),dark);
  assert.deepEqual(env.document.documentElement.dataset,initial);
  assert.equal(env.document.documentElement.style.colorScheme,initial.theme);
 }
});
