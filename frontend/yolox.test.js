import test from 'node:test';
import assert from 'node:assert/strict';
import { preprocessRGBA, decodeYOLOX, CANDIDATE_THRESHOLD } from './yolox.js';
import { assessDetections } from './local-detector.js';
const output = () => new Float32Array(3549*85);
function row(a,i,cls,score=1) {a.set([208,208,100,80,score],i*85);a[i*85+5+cls]=.9;}
test('BGR CHW values and top-left pad114 without normalization',()=>{
 const x=preprocessRGBA(new Uint8ClampedArray([10,20,30,255,40,50,60,255]),2,1);
 assert.equal(x.data.length,3*416*416); assert.equal(x.data[0],30); assert.equal(x.data[416*416],20); assert.equal(x.data[2*416*416],10);
 assert.equal(x.data[208*416],114); assert.equal(x.ratio,208);
});
test('score product, inverse resize and class-aware NMS preserve geometry',()=>{
 const a=output();row(a,0,0);row(a,1,0,.95);row(a,2,1);row(a,3,2,.8);
 const p=decodeYOLOX(a,832,416,CANDIDATE_THRESHOLD);
 assert.equal(p.length,2);assert.equal(p[0].class,'person');assert.ok(Math.abs(p[0].score-.9)<1e-6);
 assert.deepEqual(p[0].bbox,[316,336,200,160]);assert.equal(p[1].class,'bicycle');
});
test('portrait and landscape output normalization round trips',()=>{
 for(const [w,h] of [[832,416],[416,832],[640,480],[480,640]]) {
  const a=output();row(a,0,0);const [d]=assessDetections(decodeYOLOX(a,w,h),w,h);const r=Math.min(416/w,416/h);
  assert.equal(d.bbox.x,158/r/w);assert.equal(d.bbox.y,168/r/h);
 }
});
test('invalid outputs and nonfinite boxes fail closed',()=>{
 assert.throws(()=>decodeYOLOX(new Float32Array(2),640,480));assert.throws(()=>preprocessRGBA(new Uint8ClampedArray(),0,0));
 const a=output();row(a,0,0);a[0]=NaN;assert.equal(decodeYOLOX(a,640,480).length,0);
});
test('all 16 policy categories survive and other COCO categories remain excluded',()=>{
 const labels=['person','bicycle','car','motorcycle','bus','truck','bench','cat','dog','backpack','handbag','suitcase','bottle','cup','chair','potted plant'];
 const predictions=[...labels,'toothbrush','airplane','stairs'].map(label=>({class:label,score:.99,bbox:[10,10,50,50]}));
 assert.deepEqual(assessDetections(predictions,100,100).map(d=>d.label),labels);
});
