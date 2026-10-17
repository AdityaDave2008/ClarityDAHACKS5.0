import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const path = new URL('./candidate-model.js', import.meta.url);
test('candidate adapter exists and uses pinned actual model', async () => {
  assert.ok(existsSync(path), 'Missing candidate adapter');
  const {MODEL_SHA256,CANDIDATE_THRESHOLD} = await import(path);
  assert.equal(MODEL_SHA256, '516617114420ce3c2bac545869ee91bac8ff7a63e148a73afdb12f126433fab4');
  assert.equal(CANDIDATE_THRESHOLD, .7874982953071594);
});
test('adapter reads direct RGBA, sends BGR CHW float32 and disposes input/output', async () => {
  assert.ok(existsSync(path), 'Missing candidate adapter');
  const {createCandidateModel} = await import(path);
  let disposed=0;
  class Tensor { constructor(type,data,dims) {Object.assign(this,{type,data,dims});} dispose(){disposed++;} }
  const session={async run({images}) {
    assert.equal(images.type,'float32'); assert.deepEqual(images.dims,[1,3,416,416]);
    assert.equal(images.data[0],30); assert.equal(images.data[416*416],20); assert.equal(images.data[2*416*416],10);
    return {predictions:{data:new Float32Array(3549*85),dims:[1,3549,85],dispose(){disposed++;}}};
  }};
  const canvas={width:1,height:1,getContext:()=>({getImageData:()=>({data:new Uint8ClampedArray([10,20,30,255])})})};
  assert.deepEqual(await createCandidateModel(session,{Tensor}).detect(canvas),[]);
  assert.equal(disposed,2);
});
test('adapter disposes input on run failure and rejects malformed output', async () => {
  assert.ok(existsSync(path), 'Missing candidate adapter');
  const {createCandidateModel}=await import(path);
  let disposed=0;
  class Tensor {dispose(){disposed++;}}
  const canvas={width:1,height:1,getContext:()=>({getImageData:()=>({data:new Uint8ClampedArray(4)})})};
  await assert.rejects(createCandidateModel({run:async()=>{throw Error('run failed');}},{Tensor}).detect(canvas),/run failed/);
  assert.equal(disposed,1);
  await assert.rejects(createCandidateModel({run:async()=>({predictions:{dims:[1,1,85],dispose(){disposed++;}}})},{Tensor}).detect(canvas),/output shape/);
  assert.equal(disposed,3);
});
