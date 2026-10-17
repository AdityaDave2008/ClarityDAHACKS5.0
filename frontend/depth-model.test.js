import test from 'node:test';
import assert from 'node:assert/strict';
import { createDepthModel, normalizeDepthMap, MODEL_REVISION } from './depth-model.js';
const tensor = {data:new Float32Array([2,7,11,3]),dims:[1,2,2]};
function fixture(extra={}) {
  let loads=0, disposed=0, options;
  const pipe=async()=>({predicted_depth:tensor,depth:{data:[0,255]}});
  pipe.dispose=async()=>{disposed++};
  const runtime={env:{backends:{onnx:{wasm:{}}}},RawImage:{fromCanvas:x=>x},pipeline:async(t,m,o)=>{loads++;options=o;return pipe}};
  return {model:createDepthModel({importRuntime:async()=>runtime,platform:{},...extra}),runtime,get loads(){return loads},get disposed(){return disposed},get options(){return options}};
}
test('normalization rejects malformed and nonfinite maps without rescaling raw values',()=>{
  assert.equal(normalizeDepthMap({data:[NaN],width:1,height:1}),null);
  assert.equal(normalizeDepthMap({data:[1],width:2,height:1}),null);
  assert.equal(normalizeDepthMap({data:[1],width:-1,height:-1}),null);
  assert.deepEqual([...normalizeDepthMap({data:[2,7],width:2,height:1}).data],[2,7]);
});
test('lazy load pins revision and forces nonisolated single-thread WASM',async()=>{
  const f=fixture(); assert.equal(f.loads,0);
  await f.model.load({}); assert.equal(f.loads,1);
  assert.equal(f.options.revision,MODEL_REVISION);assert.equal(f.options.device,'wasm');
  assert.equal(f.runtime.env.backends.onnx.wasm.numThreads,1);
  const map=await f.model.estimate({});assert.deepEqual([...map.data],[2,7,11,3]);assert.equal(map.width,2);
  await f.model.dispose();assert.equal(f.disposed,1);
  await assert.rejects(f.model.estimate({}),/not loaded/);
});
test('real GPU adapter and device probe precedes WebGPU selection',async()=>{
  let destroyed=false;
  const f=fixture({platform:{gpu:{requestAdapter:async()=>({requestDevice:async()=>({destroy(){destroyed=true}})})}}});
  await f.model.load({});assert.equal(f.options.device,'webgpu');assert.ok(destroyed);
});
test('failed GPU probe safely uses WASM',async()=>{
  const f=fixture({platform:{gpu:{requestAdapter:async()=>{throw Error('denied')}}}});
  await f.model.load({});assert.equal(f.options.device,'wasm');
});
test('bounded load failure reports unavailable',async()=>{
  const statuses=[];const f=fixture({importRuntime:()=>new Promise(()=>{}),loadTimeoutMs:15});
  await assert.rejects(f.model.load({onStatus:x=>statuses.push(x)}),/timed out/);
  assert.equal(statuses.at(-1).status,'unavailable');
});
test('dispose cancels pending load and cleans late pipeline',async()=>{
  let finish;const f=fixture({importRuntime:()=>new Promise(r=>finish=r)});
  const loading=f.model.load({});await f.model.dispose();finish(f.runtime);
  await assert.rejects(loading,/cancelled/);assert.equal(f.loads,0);
});
test('malformed model prediction rejects instead of returning visualization',async()=>{
  const f=fixture();tensor.data[0]=NaN;await f.model.load({});
  await assert.rejects(f.model.estimate({}),/invalid/);tensor.data[0]=2;
});
test('GPU pipeline failure falls back once to WASM',async()=>{
  const f=fixture({platform:{gpu:{requestAdapter:async()=>({requestDevice:async()=>({destroy(){}})})}}});
  const calls=[];const original=f.runtime.pipeline;
  f.runtime.pipeline=async(...args)=>{calls.push(args[2].device);if(args[2].device==='webgpu')throw Error('unsupported op');return original(...args)};
  await f.model.load({});assert.deepEqual(calls,['webgpu','wasm']);
});
test('late pipeline is disposed after bounded load timeout',async()=>{
  let finish;let disposed=0;const f=fixture({loadTimeoutMs:10});
  f.runtime.pipeline=()=>new Promise(r=>finish=r);
  await assert.rejects(f.model.load({}),/timed out/);
  finish({dispose:async()=>disposed++});await new Promise(r=>setTimeout(r,5));
  assert.equal(disposed,1);await assert.rejects(f.model.estimate({}),/not loaded/);
});
test('pending inference prevents overlap and disposal rejects its stale result',async()=>{
  let finish,disposed=0;const f=fixture();
  const pipe=()=>new Promise(r=>finish=r);pipe.dispose=async()=>disposed++;
  f.runtime.pipeline=async()=>pipe;await f.model.load({});
  const running=f.model.estimate({});await assert.rejects(f.model.estimate({}),/already running/);
  await f.model.dispose();finish({predicted_depth:tensor});await assert.rejects(running,/cancelled/);
  await new Promise(r=>setTimeout(r,60));assert.equal(disposed,1);
});
test('dispose promptly cancels unresolved imports without waiting for load timeout',async()=>{
  const f=fixture({importRuntime:()=>new Promise(()=>{}),loadTimeoutMs:500});
  const start=Date.now();const loading=f.model.load({});await f.model.dispose();
  await assert.rejects(loading,/cancelled/);assert.ok(Date.now()-start<100);
});
test('processor budget uses 252 pixels before inference, not canvas-only downsampling',async()=>{
  const f=fixture();const base=f.runtime.pipeline;
  let pipe;f.runtime.pipeline=async(...args)=>{pipe=await base(...args);pipe.processor={image_processor:{size:{width:518,height:518}}};return pipe};
  await f.model.load({});assert.deepEqual(pipe.processor.image_processor.size,{width:252,height:252});
});
function fakeWorker({hang=false}={}) {
  return {terminated:false,messages:[],postMessage(message,transfer){
    this.messages.push({message,transfer});if(hang)return;
    queueMicrotask(()=>this.onmessage({data:{id:message.id,result:message.type==='load'?{device:'wasm'}:{data:new Float32Array([2]),width:1,height:1}}}));
  },terminate(){this.terminated=true}};
}
test('browser facade lazily creates worker and transfers snapshot pixels',async()=>{
  const worker=fakeWorker();let created=0;
  const model=createDepthModel({createWorker:()=>{created++;return worker}});
  assert.equal(created,0);await model.load({});assert.equal(created,1);
  const pixels=new Uint8ClampedArray([1,2,3,255]);
  const map=await model.estimate({width:1,height:1,getContext:()=>({getImageData:()=>({data:pixels})})});
  assert.equal(map.data[0],2);assert.equal(worker.messages[1].transfer[0],pixels.buffer);
  await model.dispose();assert.ok(worker.terminated);
});
test('worker load timeout terminates computation and reports unavailable',async()=>{
  const worker=fakeWorker({hang:true});const statuses=[];
  const model=createDepthModel({createWorker:()=>worker,loadTimeoutMs:10});
  await assert.rejects(model.load({onStatus:s=>statuses.push(s)}),/timed out/);
  assert.ok(worker.terminated);assert.equal(statuses.at(-1).status,'unavailable');
});
test('worker dispose and immediate reload cannot let old rejection terminate new generation',async()=>{
  const old=fakeWorker({hang:true}),next=fakeWorker();let count=0;
  const model=createDepthModel({createWorker:()=>count++?next:old});
  const first=model.load({});const rejected=assert.rejects(first,/cancelled/);
  const disposed=model.dispose();const second=model.load({});await disposed;
  await rejected;assert.deepEqual(await second,{device:'wasm'});assert.equal(next.terminated,false);
  await model.dispose();
});
test('worker output resolved just before dispose is still discarded',async()=>{
  const worker=fakeWorker();const model=createDepthModel({createWorker:()=>worker});await model.load({});
  let id;worker.postMessage=m=>{id=m.id};
  const result=model.estimate({width:1,height:1,getContext:()=>({getImageData:()=>({data:new Uint8ClampedArray(4)})})});
  worker.onmessage({data:{id,result:{data:new Float32Array([2]),width:1,height:1}}});
  await model.dispose();await assert.rejects(result,/cancelled/);
});
test('worker inference timeout terminates busy computation',async()=>{
  const worker=fakeWorker();const model=createDepthModel({createWorker:()=>worker,inferenceTimeoutMs:10});await model.load({});
  worker.postMessage=()=>{};
  await assert.rejects(model.estimate({width:1,height:1,getContext:()=>({getImageData:()=>({data:new Uint8ClampedArray(4)})})}),/timed out/);
  assert.ok(worker.terminated);await assert.rejects(model.estimate({}),/not loaded/);
});
test('unavailable worker platform reports failure rather than running WASM on main thread',async()=>{
  const statuses=[];const model=createDepthModel({createWorker:()=>{throw Error('Worker unavailable')}});
  await assert.rejects(model.load({onStatus:s=>statuses.push(s)}),/Worker unavailable/);
  assert.equal(statuses.at(-1).status,'unavailable');
});
test('pathological aspect ratio is rejected before processor can allocate huge tensors',async()=>{
  const worker=fakeWorker();const model=createDepthModel({createWorker:()=>worker});await model.load({});
  await assert.rejects(model.estimate({width:4096,height:1}),/dimensions invalid/);await model.dispose();
});
