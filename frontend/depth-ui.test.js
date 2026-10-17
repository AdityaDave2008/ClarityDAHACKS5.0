import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formatDepth, calibrationFromReference, mountDepthUI } from './depth-ui.js';
const reference = () => ({ frame: {width:640,height:960,deviceId:'rear',orientation:'portrait',sequence:1,capturedAt:1000},
  attitude:{pitchRad:0,rollRad:0,timestamp:1000}, revision:1, cameraHeightM:1.4,
  referenceHeightM:1, distanceM:2, measurementToleranceM:.02,
  points:[{x:.5,y:.2},{x:.5,y:.8}], referenceDeclared:true });

test('relative or malformed depth can never render meters', () => {
  assert.equal(formatDepth({kind:'relative',meters:2}).includes(' m'),false);
  for (const result of [{kind:'estimated',lowerMeters:NaN,upperMeters:2},{kind:'estimated',lowerMeters:4,upperMeters:2},
    {kind:'estimated',lowerMeters:0,upperMeters:200}]) assert.match(formatDepth(result),/unavailable/i);
  assert.match(formatDepth({kind:'estimated',source:'camera-geometry',quantity:'optical-axis-depth',meters:2,lowerMeters:1.91,upperMeters:2.13}),/1.9–2.2 m/);
});
test('calibration derives projection only from actual centered measured reference and identity', () => {
  const result=calibrationFromReference(reference());
  assert.equal(result.projectionMeasured,true);
  assert.equal(result.cameraHeightM,1.4);
  assert.ok(Math.abs(result.verticalFovRad - 2*Math.atan(1/(2*2*.6)))<1e-12);
  assert.equal(result.deviceId,'rear');
  assert.ok(result.fovUncertaintyRad>0);
});
test('calibration rejects missing measurements, stale attitude, tilted or uncentered references', () => {
  for (const patch of [{cameraHeightM:0},{distanceM:0},{referenceDeclared:false},{points:[]},
    {points:[{x:.2,y:.2},{x:.2,y:.8}]},{attitude:{pitchRad:.3,rollRad:0,timestamp:1000}},
    {attitude:{pitchRad:0,rollRad:0,timestamp:600}},{measurementToleranceM:0},
    {frame:{...reference().frame,deviceId:''}}]) assert.throws(()=>calibrationFromReference({...reference(),...patch}));
});
test('actual Clarity HTML has opt-in depth, measured reference workflow and honest source labels', async () => {
  const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
  for (const id of ['depth-enable','depth-motion','depth-model','depth-height','depth-reference-height','depth-reference-distance',
    'depth-tolerance','depth-freeze','depth-preview','depth-reference-declared','depth-calibrate','depth-ground-contact','depth-reset','depth-status','depth-model-status']) assert.match(html,new RegExp(`id="${id}"`));
  assert.doesNotMatch(html,/<input[^>]*id="depth-(?:enable|model|ground-contact)"[^>]*checked/);
  assert.match(html,/No LiDAR in this browser/i);
  assert.match(html,/optical.axis/i);
  assert.match(html,/50 MB/);
  assert.match(html,/perpendicular/i);
  assert.match(html,/Experimental depth/);
  assert.equal(typeof mountDepthUI,'function');
});

test('depth modules are served as JavaScript and registered offline without optional runtime precache', async () => {
  const {createPreviewServer}=await import('./server.js');
  const server=createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    for (const name of ['depth-controller','depth-ui','depth-sensors','depth-geometry','depth-model']) {
      const response=await fetch(`http://127.0.0.1:${server.address().port}/${name}.js`);
      assert.equal(response.status,200,name);assert.match(response.headers.get('content-type'),/javascript/);
    }
  } finally { await new Promise(resolve=>server.close(resolve)); }
  const sw=await readFile(new URL('./sw.js',import.meta.url),'utf8');
  for (const name of ['depth-controller','depth-ui','depth-sensors','depth-geometry','depth-model']) assert.ok(sw.includes(`'/${name}.js'`));
  const precache=sw.slice(sw.indexOf('const ASSETS'),sw.indexOf('self.addEventListener'));
  assert.equal(precache.includes('/vendor-depth/'),false);
});

async function uiHarness() {
  const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
  const elements=new Map([...html.matchAll(/id="(depth-[^"]+)"/g)].map(([,id])=>[id,{value:'',checked:false,hidden:false,textContent:'',listeners:{},
    addEventListener(name,fn){this.listeners[name]=fn;},
    getContext:()=>new Proxy({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)})},{get:(obj,k)=>obj[k]||(()=>{})}),
    fire(name,event={}){this.listeners[name]?.(event);}}]));
  const calls=[];let callbacks;
  const controller=new Proxy({}, {get:(_,name)=>(...args)=>calls.push([name,...args])});
  const root={querySelector:selector=>elements.get(selector.slice(1)),ownerDocument:{hidden:false,addEventListener(){}}};
  const ui=mountDepthUI(root,{platform:{addEventListener(){}},sensors:{request:async()=>({reason:'Waiting for sample'})},
    controllerFactory:options=>{callbacks=options;return controller;}});
  return {ui,calls,callbacks,elements,get:name=>elements.get(`depth-${name}`)};
}
test('editing measured calibration invalidates prior estimates without discarding endpoint inputs', async () => {
  const h=await uiHarness();h.get('ground-contact').checked=true;
  h.get('height').value='1.7';h.get('height').fire('input');
  assert.equal(h.get('ground-contact').checked,false);
  assert.ok(h.calls.some(call=>call[0]==='setCalibration'&&call[1]===null));
});
test('actual mounted UI hides historical source and map on invalidation and binds explicit analyze action', async () => {
  const h=await uiHarness();
  h.get('analyze').fire('click');assert.ok(h.calls.some(call=>call[0]==='analyzeSnapshot'));
  h.callbacks.onUpdate({ground:{kind:'unavailable'},model:{kind:'relative',snapshot:true}});
  assert.equal(h.get('map').hidden,false);assert.equal(h.get('snapshot').hidden,false);
  assert.match(h.get('model-status').textContent,/Snapshot, not live/);
  h.callbacks.onUpdate({ground:{kind:'unavailable'},model:{kind:'unavailable'}});
  assert.equal(h.get('map').hidden,true);assert.equal(h.get('snapshot').hidden,true);
  assert.match(h.get('download-notice').textContent,/49.8 MB/);
});

test('measured reference UI reports fresh tilt guidance rather than implying permission is attitude', async () => {
  const h=await uiHarness();
  h.callbacks.onPreview({width:256,height:384},{...reference().frame},{pitchRad:0,rollRad:0,timestamp:1000});
  assert.match(h.get('motion-status').textContent,/Tilt.*0.*roll.*0/i);
  h.callbacks.onPreview({width:256,height:384},{...reference().frame},{kind:'unavailable',reason:'Waiting for fresh orientation'});
  assert.match(h.get('motion-status').textContent,/Waiting for fresh orientation/);
});
