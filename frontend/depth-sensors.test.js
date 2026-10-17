import test from 'node:test';
import assert from 'node:assert/strict';
import { createDepthSensors, portraitRearAttitude } from './depth-sensors.js';

function platform(permission) {
  const listeners = new Map();
  let time = 1000;
  return { DeviceOrientationEvent: permission === undefined ? undefined : { requestPermission: permission },
    screen: { orientation: { angle: 0 } }, now: () => time,
    advance: ms => { time += ms; },
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
    emit: event => listeners.get('deviceorientation')?.(event), listeners };
}

test('unavailable and denied motion never fabricate attitude', async () => {
  for (const p of [platform(), platform(async () => 'denied'), platform(async () => { throw Error('no'); })]) {
    const sensors = createDepthSensors(p);
    assert.equal((await sensors.request()).kind, 'unavailable');
    assert.equal(sensors.snapshot().kind, 'unavailable');
    assert.equal(p.listeners.size, 0);
  }
});
test('permission is requested synchronously within original gesture and only fresh samples work', async () => {
  let called = false;
  const p = platform(() => { called = true; return Promise.resolve('granted'); });
  const sensors = createDepthSensors(p);
  const request = sensors.request();
  assert.equal(called, true);
  await request;
  assert.equal(sensors.snapshot().kind, 'unavailable');
  p.emit({ beta: 90, gamma: 0 });
  assert.ok(Math.abs(sensors.snapshot().pitchRad) < 1e-12);
  assert.equal(sensors.snapshot().timestamp, 1000);
  p.advance(251);
  assert.equal(sensors.snapshot().kind, 'unavailable');
  sensors.stop();
  assert.equal(p.listeners.size, 0);
});
test('rear portrait orientation conventions reject unsupported rotation and malformed data', () => {
  assert.ok(Math.abs(portraitRearAttitude({ beta: 60, gamma: 0 }, 0).pitchRad - Math.PI / 6) < 1e-12);
  assert.equal(portraitRearAttitude({ beta: 90, gamma: 0 }, 90), null);
  assert.equal(portraitRearAttitude({ beta: null, gamma: 0 }, 0), null);
  assert.equal(portraitRearAttitude({ beta: 0, gamma: 0 }, 0), null);
});
test('stop during permission prompt prevents late listener installation', async () => {
  let grant;
  const p = platform(() => new Promise(resolve => { grant = resolve; }));
  const sensors = createDepthSensors(p);
  const request = sensors.request();
  sensors.stop(); grant('granted'); await request;
  assert.equal(p.listeners.size, 0);
});
test('rotation clears samples immediately', async () => {
  const p = platform(async () => 'granted');
  const sensors = createDepthSensors(p); await sensors.request(); p.emit({ beta: 70, gamma: 0 });
  p.screen.orientation.angle = 90;
  assert.equal(sensors.snapshot().kind, 'unavailable');
});

test('screen-up rear optical axis points downward mathematically but unsupported flat pose is rejected', async () => {
  const { rearCameraAttitude } = await import('./depth-sensors.js');
  assert.equal(typeof rearCameraAttitude,'function');
  assert.ok(Math.abs(rearCameraAttitude({beta:0,gamma:0}).pitchRad-Math.PI/2)<1e-12);
  assert.equal(portraitRearAttitude({beta:0,gamma:0},0),null);
});

test('natural-landscape devices are not misclassified as supported portrait at angle zero', async () => {
  const p=platform(async()=> 'granted');p.screen.orientation.type='landscape-primary';
  const sensors=createDepthSensors(p);await sensors.request();p.emit({beta:90,gamma:0});
  assert.equal(sensors.snapshot().kind,'unavailable');
});

test('frame lookup uses attitude at capture rather than orientation after detector latency', async () => {
  const p=platform(async()=> 'granted');const sensors=createDepthSensors(p);await sensors.request();
  p.emit({beta:90,gamma:0});p.advance(100);p.emit({beta:60,gamma:0});
  assert.ok(Math.abs(sensors.snapshot(1000).pitchRad)<1e-12);
  assert.ok(sensors.snapshot().pitchRad>.5);
  p.advance(151);assert.equal(sensors.snapshot(1000).kind,'unavailable');
});
