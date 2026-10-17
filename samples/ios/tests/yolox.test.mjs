import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const path = new URL('../MyEyes/OfflineDetector/yolox.js', import.meta.url);
const context = vm.createContext({Float32Array});
if (fs.existsSync(path)) vm.runInContext(fs.readFileSync(path,'utf8'),context);
const output = () => new Float32Array(3549*85);
function row(a,i,cls,score=1) {a.set([208,208,100,80,score],i*85);a[i*85+5+cls]=.9;}
test('contract helper exists',()=>assert.equal(typeof context.preprocessRGBA,'function'));
test('BGR CHW values and top-left pad114 without normalization',()=>{
 const x=context.preprocessRGBA(new Uint8ClampedArray([10,20,30,255,40,50,60,255]),2,1);
 assert.equal(x.data.length,3*416*416); assert.equal(x.data[0],30); assert.equal(x.data[416*416],20); assert.equal(x.data[2*416*416],10);
 assert.equal(x.data[208*416],114); assert.equal(x.ratio,208);
});
test('score product, reverse resize and class-aware NMS',()=>{
 const a=output();row(a,0,0);row(a,1,0,.95);row(a,2,1);row(a,3,2,.8);
 const p=context.decodeYOLOX(a,832,416,.45);
 // Same-class duplicates collapse; distinct classes survive. The car row scores
 // .72, which the old .7875 default discarded and the .45 default now reports.
 assert.equal(p.length,3);assert.equal(p[0].class,'person');assert.ok(Math.abs(p[0].score-.9)<1e-6);
 assert.deepEqual(Array.from(p[0].bbox),[316,336,200,160]);assert.equal(p[1].class,'bicycle');
 assert.equal(p[2].class,'car');assert.ok(Math.abs(p[2].score-.72)<1e-6);
 // A stricter user setting still suppresses the weaker detection.
 assert.equal(context.decodeYOLOX(a,832,416,.7874982953071594).length,2);
});
test('invalid output and dimensions fail closed',()=>{
 assert.throws(()=>context.decodeYOLOX(new Float32Array(2),640,480));
 assert.throws(()=>context.preprocessRGBA(new Uint8ClampedArray(),0,0));
 const a=output();row(a,0,0);a[0]=NaN;assert.equal(context.decodeYOLOX(a,640,480).length,0);
});
test('native candidate defaults and Clarity display name are explicit',()=>{
 const native=fs.readFileSync(new URL('../MyEyes/APIClient.swift',import.meta.url),'utf8');
 assert.match(native,/candidateConfidenceDefault = 0\.45/);
 const info=fs.readFileSync(new URL('../MyEyes/Info.plist',import.meta.url),'utf8');assert.match(info,/<key>CFBundleDisplayName<\/key>\s*<string>Clarity<\/string>/);
});
test('candidate threshold travels through native preferences',()=>{
 const native=fs.readFileSync(new URL('../MyEyes/APIClient.swift',import.meta.url),'utf8');
 assert.match(native,/candidateConfidenceDefault = 0\.45/);
});
