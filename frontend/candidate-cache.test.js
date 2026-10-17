import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
function worker() {
  const handlers={}, stores=new Map();
  const cacheFor=name=>{if(!stores.has(name)) stores.set(name,new Map()); const store=stores.get(name);return {addAll:async paths=>paths.forEach(p=>store.set(p,p)),match:async r=>store.get(typeof r==='string'?r:r.url),put:async(r,v)=>store.set(r.url,v)};};
  const caches={open:async name=>cacheFor(name),keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name),match:async r=>{for(const store of stores.values()) {const v=store.get(r.url);if(v)return v;}}};
  vm.runInNewContext(fs.readFileSync(new URL('./sw.js',import.meta.url),'utf8'), {self:{addEventListener:(k,f)=>handlers[k]=f,skipWaiting:async()=>{},clients:{claim:async()=>{}},location:{origin:'https://example.test'}},caches,URL,Response,fetch:async()=>new Response('network')});
  async function dispatch(name,extra={}) {const waits=[];let response; handlers[name]({...extra,waitUntil:p=>waits.push(p),respondWith:p=>{response=p;}}); if(response)response=await response;await Promise.all(waits);return response;}
  return {stores,cacheFor,dispatch};
}
test('installation precaches candidate module and versioned detector assets',async()=>{
 const w=worker();await w.dispatch('install');const [name,assets]=[...w.stores][0];
 assert.match(name,/yolox-51661711/);assert.ok(assets.has('/candidate-model.js'));assert.ok(assets.has('/yolox.js'));
 assert.ok(assets.has('/vendor/yolox-51661711/candidate.onnx'));
 for(const file of ['ort.wasm.min.js','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm'])assert.ok(assets.has('/vendor/yolox-51661711/'+file));
});
test('activation removes old app caches but leaves unrelated caches alone',async()=>{
 const w=worker();w.cacheFor('myeyes-pwa-v7-depth');w.cacheFor('unrelated-app');await w.dispatch('install');await w.dispatch('activate');
 assert.ok(!w.stores.has('myeyes-pwa-v7-depth'));assert.ok(w.stores.has('unrelated-app'));
});
test('PiP module is available offline and superseded v8 caches are removed', async () => {
 const w = worker();
 w.cacheFor('myeyes-pwa-v8-yolox-51661711');
 w.cacheFor('myeyes-pwa-v8-depth-assets');
 await w.dispatch('install');
 await w.dispatch('activate');
 assert.ok(!w.stores.has('myeyes-pwa-v8-yolox-51661711'));
 assert.ok(!w.stores.has('myeyes-pwa-v8-depth-assets'));
 const assets = [...w.stores.values()][0];
 assert.ok(assets.has('/picture-in-picture.js'));
});
test('runtime requests use current cache only, not stale entries in other caches',async()=>{
 const w=worker();const url='https://example.test/vendor/yolox-51661711/candidate.onnx';
 await w.cacheFor('unrelated-app').put({url},new Response('stale'));await w.dispatch('install');
 const response=await w.dispatch('fetch',{request:{url,method:'GET'}});assert.equal(await response.text(),'network');
});
