import test from 'node:test';
import assert from 'node:assert/strict';
import { createDepthController } from './depth-controller.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(overrides = {}) {
  let time = 1000; let loads = 0; let estimates = 0;
  const updates = []; const timers = new Map();
  const model = { load: async () => { loads++; }, estimate: async () => { estimates++; return { data: new Float32Array([1,2]), width:2, height:1 }; }, dispose() {} };
  const controller = createDepthController({
    now: () => time, sensors: { snapshot: () => ({ pitchRad: 0, rollRad: 0, timestamp: time }), stop() {} },
    modelFactory: async () => model, copyCanvas: canvas => ({ ...canvas, copied: true }),
    groundEstimator: () => ({ kind: 'estimated', source: 'ground', meters: 2, lowerMeters: 1.8, upperMeters: 2.2 }),
    onUpdate: state => updates.push(state),
    schedule: (fn, ms) => { const id = Symbol(); timers.set(id, {fn, at:time+ms}); return id; }, unschedule: id => timers.delete(id),
    ...overrides,
  });
  return { controller, updates, model, loads: () => loads, estimates: () => estimates,
    advance(ms) { time += ms; for (const [id,timer] of timers) if (timer.at <= time) {timers.delete(id);timer.fn();} },
    frame(sequence=1) { controller.onFrame({canvas:{width:320,height:480}, sequence, capturedAt:time, sourceWidth:640,sourceHeight:960, deviceId:'rear', orientation:'portrait', facingMode:'environment'}); },
    start() { controller.setEnabled(true); controller.start(); },
  };
}
test('disabled and geometry-only depth do not load optional model', async () => {
  const h = harness(); h.controller.start(); h.frame(); await flush(); assert.equal(h.loads(),0);
  h.start(); h.frame(); await flush(); assert.equal(h.loads(),0);
});
test('model inference uses synchronous copy, never overlaps, and stays relative', async () => {
  let resolve; let calls = 0; let input;
  const h = harness({modelFactory: async () => ({load:async()=>{}, estimate:canvas=>{input=canvas;calls++;return new Promise(r=>{resolve=r;});},dispose(){}})});
  h.start(); await h.controller.setModelEnabled(true); h.controller.analyzeSnapshot(); h.frame(); h.frame(2);
  assert.equal(input.copied,true); assert.equal(calls,1);
  resolve({data:[1,2],width:2,height:1}); await flush();
  const output = h.updates.at(-1).model;
  assert.equal(output.kind,'relative'); assert.equal('meters' in output,false); assert.equal(output.frameSequence,1);
});
test('in-flight output cannot return after stop, hide or calibration changes', async () => {
  for (const invalidate of [c=>c.stop(),c=>c.setHidden(true),c=>c.setCalibration({revision:2})]) {
    let resolve;
    const h = harness({modelFactory:async()=>({load:async()=>{},estimate:()=>new Promise(r=>{resolve=r;}),dispose(){}})});
    h.start(); await h.controller.setModelEnabled(true); h.controller.analyzeSnapshot(); h.frame(); invalidate(h.controller);
    resolve({data:[1],width:1,height:1}); await flush();
    assert.notEqual(h.updates.at(-1).model.kind,'relative');
  }
});
test('expired output is actively cleared without a subsequent camera frame', async () => {
  const h = harness(); h.start(); h.controller.setCalibration({revision:1,width:640,height:960,deviceId:'rear',orientation:'portrait'}); h.controller.setGroundContact(true); h.frame();
  assert.equal(h.updates.at(-1).ground.kind,'estimated');
  h.advance(501); assert.equal(h.updates.at(-1).ground.kind,'unavailable');
});
test('ground contact is explicit and configuration change invalidates calibration', () => {
  let calls=0;
  const h=harness({groundEstimator:()=>{calls++;return {kind:'estimated'};}});
  h.start(); h.controller.setCalibration({revision:1,width:640,height:960,deviceId:'rear',orientation:'portrait'}); h.frame(); assert.equal(calls,0);
  h.controller.setGroundContact(true); h.frame(); assert.equal(calls,1);
  h.controller.onFrame({canvas:{width:320,height:480}, sequence:2,capturedAt:1000,sourceWidth:640,sourceHeight:960,deviceId:'other',orientation:'portrait',facingMode:'environment'});
  assert.equal(calls,1); assert.equal(h.updates.at(-1).ground.kind,'unavailable');
});
test('depth load and malformed inference failures stay depth-only', async () => {
  const h=harness({modelFactory:async()=>({load:async()=>{throw Error('download failed');},dispose(){}})});
  h.start(); await h.controller.setModelEnabled(true); h.controller.analyzeSnapshot(); h.frame();
  assert.equal(h.updates.at(-1).model.kind,'unavailable');
});
test('snapshot inference cannot return across stop/restart and cannot overlap', async () => {
  let resolve; let calls=0;
  const h=harness({modelFactory:async()=>({load:async()=>{},estimate:()=>{calls++;return new Promise(r=>{resolve=r;});},dispose(){}})});
  h.start(); await h.controller.setModelEnabled(true); h.controller.analyzeSnapshot();h.frame();h.controller.stop();h.controller.start();h.frame(2);
  assert.equal(calls,1);h.advance(600);resolve({data:[1],width:1,height:1});await flush();
  assert.notEqual(h.updates.at(-1).model.kind,'relative');
});

test('selected ground point requires renewed contact declaration and reaches geometry exactly', () => {
  let anchor;
  const h=harness({groundEstimator:input=>{anchor=input.anchor;return {kind:'estimated'};}});
  h.start();h.controller.setCalibration({revision:1,width:640,height:960,deviceId:'rear',orientation:'portrait'});
  h.controller.setGroundContact(true);h.controller.setAnchor({x:.3,y:.9});h.frame();assert.equal(anchor,undefined);
  h.controller.setGroundContact(true);h.frame();assert.deepEqual(anchor,{x:.3,y:.9,groundContact:true});
});
test('relative map visual is delivered only with accepted fresh inference', async () => {
  const maps=[];const h=harness({onModelMap:(map,frame)=>maps.push({map,frame})});
  h.start();await h.controller.setModelEnabled(true); h.controller.analyzeSnapshot();h.frame();await flush();
  assert.equal(maps.length,1);assert.equal(maps[0].frame.sequence,1);
});

test('relative snapshot is explicit, paired with its source, and retained as history not live depth', async () => {
  let resolve;const maps=[];
  const h=harness({onModelMap:(map,frame,canvas)=>maps.push({map,frame,canvas}), modelFactory:async()=>({load:async()=>{},estimate:()=>new Promise(r=>{resolve=r;}),dispose(){}})});
  h.start();await h.controller.setModelEnabled(true);h.frame();assert.equal(resolve,undefined);
  assert.equal(h.controller.analyzeSnapshot(),true);h.frame(2);h.advance(2400);
  resolve({data:[1,2],width:2,height:1});await flush();
  assert.equal(maps[0].canvas.copied,true);assert.equal(maps[0].frame.sequence,2);
  assert.equal(h.updates.at(-1).model.snapshot,true);
  h.advance(10000);assert.equal(h.updates.at(-1).model.kind,'relative');
  h.controller.setCalibration(null);assert.equal(h.updates.at(-1).model.kind,'unavailable');
});

test('camera identity change invalidates historical maps even without ground calibration', async () => {
  const h=harness();h.start();await h.controller.setModelEnabled(true);h.controller.analyzeSnapshot();h.frame();await flush();
  assert.equal(h.updates.at(-1).model.kind,'relative');
  h.controller.onFrame({canvas:{width:320,height:480},sequence:2,capturedAt:1000,sourceWidth:640,sourceHeight:960,deviceId:'different',orientation:'portrait',facingMode:'environment'});
  assert.equal(h.updates.at(-1).model.kind,'unavailable');
});
test('digital zoom changes invalidate measured camera projection', () => {
  let calls=0;const h=harness({groundEstimator:()=>{calls++;return {kind:'estimated'};}});
  h.start();h.controller.setCalibration({revision:1,width:640,height:960,deviceId:'rear',orientation:'portrait',zoom:1});h.controller.setGroundContact(true);
  h.controller.onFrame({canvas:{width:320,height:480},sequence:2,capturedAt:1000,sourceWidth:640,sourceHeight:960,deviceId:'rear',orientation:'portrait',facingMode:'environment',zoom:2});
  assert.equal(calls,0);
});

test('slow accepted v1 frame can become historical snapshot but never live ground estimate', async () => {
  let groundCalls=0;const h=harness({groundEstimator:()=>{groundCalls++;return {kind:'estimated'};}});
  h.start();h.controller.setCalibration({revision:1,width:640,height:960,deviceId:'rear',orientation:'portrait'});h.controller.setGroundContact(true);
  await h.controller.setModelEnabled(true);h.controller.analyzeSnapshot();
  h.controller.onFrame({canvas:{width:320,height:480},sequence:1,capturedAt:0,sourceWidth:640,sourceHeight:960,deviceId:'rear',orientation:'portrait',facingMode:'environment'});
  await flush();assert.equal(groundCalls,0);assert.equal(h.updates.at(-1).ground.kind,'unavailable');
  assert.equal(h.updates.at(-1).model.snapshot,true);assert.equal(h.updates.at(-1).model.capturedAt,0);
});

test('actual measured-reference calibration flows through real ground geometry to a bounded optical estimate', async () => {
  const {calibrationFromReference,formatDepth}=await import('./depth-ui.js');
  const {estimateGroundDepth}=await import('./depth-geometry.js');
  const h=harness({groundEstimator:estimateGroundDepth});h.start();
  const calibration=calibrationFromReference({frame:{width:640,height:960,deviceId:'rear',orientation:'portrait',capturedAt:1000},
    attitude:{pitchRad:0,rollRad:0,timestamp:1000},revision:1,cameraHeightM:1.4,referenceHeightM:1,distanceM:2,
    measurementToleranceM:.02,points:[{x:.5,y:.2},{x:.5,y:.8}],referenceDeclared:true});
  h.controller.setCalibration(calibration);h.controller.setGroundContact(true);h.frame();
  const result=h.updates.at(-1).ground;
  assert.equal(result.kind,'estimated');assert.equal(result.quantity,'optical-axis-depth');
  assert.ok(result.lowerMeters<=result.meters && result.meters<=result.upperMeters);
  assert.match(formatDepth(result),/Camera estimated:.* m optical-axis depth/);
});

test('malformed raw snapshot maps never reach the UI visualization or acquire metric fields', async () => {
  for (const map of [{data:[NaN],width:1,height:1},{data:[1],width:2,height:1},{data:[1],width:0,height:1}]) {
    let visuals=0;const h=harness({onModelMap:()=>visuals++,modelFactory:async()=>({load:async()=>{},estimate:async()=>map,dispose(){}})});
    h.start();await h.controller.setModelEnabled(true);h.controller.analyzeSnapshot();h.frame();await flush();
    assert.equal(visuals,0);assert.equal(h.updates.at(-1).model.kind,'unavailable');
    assert.equal('meters' in h.updates.at(-1).model,false);
  }
});

const deferred = () => { let resolve, reject; const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject}; };
test('disable while factory is pending never starts its late model download', async () => {
  const factory=deferred();let loads=0,disposes=0;
  const h=harness({modelFactory:()=>factory.promise});h.start();
  const pending=h.controller.setModelEnabled(true);await h.controller.setModelEnabled(false);
  factory.resolve({load:async()=>loads++,dispose:()=>disposes++});await pending;
  assert.equal(loads,0);assert.equal(disposes,1);
});
test('disable promptly disposes a model whose load is pending', async () => {
  const load=deferred();let disposes=0;
  const h=harness({modelFactory:async()=>({load:()=>load.promise,dispose:()=>disposes++})});h.start();
  const pending=h.controller.setModelEnabled(true);await flush();
  await h.controller.setModelEnabled(false);assert.equal(disposes,1);
  load.resolve();await pending;assert.equal(disposes,1);
  assert.match(h.updates.at(-1).model.reason,/off/i);
});
test('rapid reenable isolates stale load callbacks and cleanup from the newer model', async () => {
  const first=deferred(),second=deferred();let calls=0;const statuses=[];const disposed=[];
  const h=harness({modelFactory:async()=>{
    const id=++calls;return {load:({onStatus})=>{statuses[id]=onStatus;return id===1?first.promise:second.promise;},
      estimate:async()=>({data:[1],width:1,height:1}),dispose:()=>disposed.push(id)};
  }});h.start();const old=h.controller.setModelEnabled(true);await flush();
  await h.controller.setModelEnabled(false);const current=h.controller.setModelEnabled(true);await flush();
  first.reject(Error('cancelled'));await old;
  const before=h.updates.length;statuses[1]({status:'ready'});assert.equal(h.updates.length,before);
  assert.equal(h.controller.analyzeSnapshot(),false,'Old finally must not clear the new loading flag');
  second.resolve();await current;assert.equal(h.controller.analyzeSnapshot(),true);h.frame();await flush();
  assert.equal(h.updates.at(-1).model.kind,'relative');assert.deepEqual(disposed,[1]);
});

test('turning off all experimental depth cancels pending optional load immediately', async () => {
  const load=deferred();let disposes=0;
  const h=harness({modelFactory:async()=>({load:()=>load.promise,dispose:()=>disposes++})});h.start();
  const pending=h.controller.setModelEnabled(true);await flush();h.controller.setEnabled(false);
  assert.equal(disposes,1);load.reject(Error('cancelled'));await pending;
  assert.match(h.updates.at(-1).ground.reason,/off/i);
});
test('late first factory cannot replace a rapidly reenabled ready model', async () => {
  const factory=deferred();let calls=0,oldLoads=0,oldDisposals=0;
  const h=harness({modelFactory:()=>++calls===1?factory.promise:Promise.resolve({load:async()=>{},estimate:async()=>({data:[1],width:1,height:1}),dispose(){}})});
  h.start();const old=h.controller.setModelEnabled(true);await h.controller.setModelEnabled(false);
  await h.controller.setModelEnabled(true);
  factory.resolve({load:async()=>oldLoads++,dispose:()=>oldDisposals++});await old;
  assert.equal(oldLoads,0);assert.equal(oldDisposals,1);
  assert.equal(h.controller.analyzeSnapshot(),true);h.frame();await flush();
  assert.equal(h.updates.at(-1).model.kind,'relative');
});
