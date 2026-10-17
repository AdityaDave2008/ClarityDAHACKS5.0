import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraFeature, mountCamera } from './camera.js';
import { createPreviewServer } from './server.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(options = {}) {
  let time = 0;
  let timerId = 0;
  const timers = new Map();
  const calls = [], events = [], spoken = [], renders = [], listeners = {};
  const tracks = [0, 1].map(() => ({ stopped: false, stop() { this.stopped = true; }, addEventListener(name, fn) { this[name] = fn; } }));
  const stream = { getTracks: () => tracks };
  const speech = { cancels: 0, cancel() { this.cancels++; }, speak(value) { spoken.push(value); },
    getVoices: () => [], addEventListener(name, fn) { listeners[name] = fn; }, removeEventListener() {} };
  const video = { srcObject: null, muted: false, play: async () => {}, pause() {} };
  const feature = new CameraFeature({ video, mediaDevices: { async getUserMedia(constraints) { calls.push(constraints); return stream; } },
    speech, Utterance: class { constructor(text) { this.text = text; } },
    emit: (name, detail) => events.push({ name, detail }), render: (state, message) => renders.push({ state, message }),
    now: () => time, schedule: (fn, ms) => { timers.set(++timerId, { fn, at: time + ms }); return timerId; },
    unschedule: id => timers.delete(id), ...options });
  const advance = ms => {
    time += ms;
    for (const [id, item] of [...timers]) if (item.at <= time) { timers.delete(id); item.fn(); }
  };
  return { feature, tracks, stream, speech, video, calls, events, spoken, renders, advance, listeners };
}

test('requests nothing before Start; prefers rear camera, video only; stops every track', async () => {
  const f = fixture();
  assert.equal(f.calls.length, 0);
  await f.feature.start();
  assert.deepEqual(f.calls, [{ audio: false, video: { facingMode: { ideal: 'environment' } } }]);
  assert.equal(f.feature.state.phase, 'active');
  assert.equal(f.feature.state.detection, 'Detection not connected.');
  const started = f.events.find(event => event.name === 'camera:started');
  assert.equal(started.detail.video, f.video);
  assert.ok(f.events.some(event => event.name === 'myeyes:permissionchange' && event.detail.state === 'granted'));
  f.feature.stop();
  assert.ok(f.tracks.every(track => track.stopped));
  assert.equal(f.video.srcObject, null);
  assert.equal(f.events.at(-1).name, 'camera:stopped');
});

test('Cancel blocks duplicate requests and disposes late permission results', async () => {
  const permission = deferred();
  let count = 0;
  const f = fixture({ mediaDevices: { getUserMedia() { count++; return permission.promise; } } });
  const starting = f.feature.start();
  await f.feature.start();
  f.feature.stop();
  await f.feature.start();
  assert.equal(count, 1);
  assert.equal(f.feature.state.phase, 'off');
  permission.resolve(f.stream);
  await starting;
  assert.ok(f.tracks.every(track => track.stopped));
  assert.equal(f.feature.pending, null);
  assert.ok(!f.events.some(event => event.name === 'camera:started'));
});

test('Cancel before permission rejection never starts fallback', async () => {
  const permission = deferred();
  let count = 0;
  const f = fixture({ mediaDevices: { getUserMedia() { count++; return permission.promise; } } });
  const starting = f.feature.start();
  f.feature.stop();
  permission.reject({ name: 'NotFoundError' });
  await starting;
  assert.equal(count, 1);
});

test('falls back to any camera when facing preference cannot be satisfied', async () => {
  const calls = [];
  const f = fixture({ mediaDevices: { async getUserMedia(value) {
    calls.push(value);
    if (calls.length === 1) throw { name: 'OverconstrainedError' };
    return f.stream;
  } } });
  await f.feature.start();
  assert.deepEqual(calls[1], { audio: false, video: true });
  assert.equal(f.feature.state.phase, 'active');
  f.feature.stop();
});

for (const [name, expected] of [['NotAllowedError', /permission denied/], ['NotFoundError', /No camera/],
  ['NotReadableError', /busy/], ['SecurityError', /blocked/], ['AbortError', /could not start/]]) {
  test(`helpful recovery for ${name}`, async () => {
    const f = fixture({ mediaDevices: { async getUserMedia() { throw { name }; } } });
    await f.feature.start();
    assert.equal(f.feature.state.phase, 'off');
    assert.match(f.feature.state.camera, expected);
    assert.equal(f.feature.pending, null);
  });
}

test('insecure and unsupported contexts never request permission', async () => {
  for (const options of [{ secure: false }, { mediaDevices: null }]) {
    const f = fixture(options);
    await f.feature.start();
    assert.equal(f.calls.length, 0);
    assert.equal(f.feature.state.phase, 'off');
    assert.match(f.feature.state.camera, /HTTPS/);
  }
});

test('playback failure releases all tracks', async () => {
  const f = fixture();
  f.video.play = async () => { throw new Error('play failed'); };
  await f.feature.start();
  assert.ok(f.tracks.every(track => track.stopped));
  assert.match(f.feature.state.camera, /could not play/);
});

test('Stop during playback prevents late activation; track loss stops camera', async () => {
  const playback = deferred();
  const f = fixture();
  f.video.play = () => playback.promise;
  const starting = f.feature.start();
  await Promise.resolve();
  f.feature.stop();
  playback.resolve();
  await starting;
  assert.equal(f.feature.state.phase, 'off');
  assert.ok(!f.events.some(event => event.name === 'camera:started'));
  const g = fixture();
  await g.feature.start();
  g.tracks[0].ended();
  assert.ok(g.tracks.every(track => track.stopped));
  assert.match(g.feature.state.camera, /interrupted/);
});

test('Test and Repeat work without camera; latest speech replaces queues; Off cancels', () => {
  const f = fixture({ development: true });
  f.feature.speak('Speech test. Object ahead.');
  assert.equal(f.calls.length, 0);
  assert.equal(f.spoken.at(-1).text, 'Speech test. Object ahead.');
  f.feature.speak(f.feature.meaningfulStatus());
  assert.match(f.spoken.at(-1).text, /Camera off.*Detection not connected.*Not available/);
  f.feature.enableSpeech(true);
  const before = f.speech.cancels;
  f.feature.obstacle(true);
  assert.ok(f.speech.cancels > before);
  f.feature.enableSpeech(false);
  assert.equal(f.feature.utterance, null);
  assert.equal(f.feature.state.speechEnabled, false);
});

test('same handler enforces cooldown for real and simulated obstacles; clears stale alerts', async () => {
  let source;
  const f = fixture({ development: true });
  f.feature.registerDetector({ async start(context) { source = context; } });
  f.feature.enableSpeech(true);
  await f.feature.start();
  await Promise.resolve();
  source.onObstacle();
  assert.equal(f.feature.state.obstacle, 'Object ahead.');
  assert.equal(f.spoken.at(-1).text, 'Object ahead.');
  assert.equal(f.feature.obstacle(true), false);
  f.advance(3000);
  assert.equal(f.feature.obstacle(true), true);
  assert.match(f.feature.state.obstacle, /Simulation/);
  f.advance(5000);
  assert.equal(f.feature.state.obstacle, '');
  f.feature.stop();
  source.onObstacle();
  assert.equal(f.feature.state.obstacle, '');
});

test('simulation is disabled outside explicit development mode', () => {
  const f = fixture();
  assert.equal(f.feature.obstacle(true), false);
  assert.equal(f.feature.state.obstacle, '');
});

test('running is confirmed only after detector starts; stale callbacks and distance expire', async () => {
  const ready = deferred();
  let source;
  const f = fixture();
  f.feature.registerDetector({ start(context) { source = context; return ready.promise; } });
  await f.feature.start();
  assert.equal(f.feature.state.detection, 'Detection starting.');
  source.onObstacle();
  assert.equal(f.feature.state.obstacle, '');
  ready.resolve();
  await Promise.resolve();
  assert.equal(f.feature.state.detection, 'Detection running.');
  source.onDistance(2.4);
  assert.equal(f.feature.state.distance, 'Approximately 2.4 metres');
  f.advance(3000);
  assert.equal(f.feature.state.distance, 'Not available');
  source.onDistance(NaN);
  assert.equal(f.feature.state.distance, 'Not available');
  source.onDistance(1.2);
  f.feature.stop();
  assert.ok(source.signal.aborted);
  source.onDistance(7);
  assert.equal(f.feature.state.distance, 'Not available');
});

test('detector errors stop detection, clear alerts and distance, preserve camera', async () => {
  let source;
  const f = fixture();
  f.feature.registerDetector({ async start(context) { source = context; } });
  await f.feature.start();
  await Promise.resolve();
  source.onDistance(1);
  source.onObstacle();
  source.onError();
  assert.equal(f.feature.state.phase, 'active');
  assert.match(f.feature.state.detection, /unavailable/);
  assert.equal(f.feature.state.obstacle, '');
  assert.equal(f.feature.state.distance, 'Not available');
  assert.equal(f.feature.utterance, null);
  f.feature.stop();
});

test('a detector resolving after Stop cannot announce running', async () => {
  const ready = deferred();
  const f = fixture();
  f.feature.registerDetector({ start() { return ready.promise; } });
  await f.feature.start();
  f.feature.stop();
  ready.resolve();
  await Promise.resolve();
  assert.equal(f.feature.state.detection, 'Detection stopped.');
});

test('unsupported speech and delayed voices do not break camera', async () => {
  const f = fixture({ speech: null, Utterance: null });
  f.feature.speak('Test');
  await f.feature.start();
  assert.equal(f.feature.state.phase, 'active');
  assert.equal(f.feature.state.speechEnabled, false);
  f.feature.stop();
  const g = fixture();
  const voice = { lang: 'en-US', localService: true };
  g.speech.getVoices = () => [voice];
  g.listeners.voiceschanged();
  g.feature.speak('Test');
  assert.equal(g.spoken.at(-1).voice, voice);
});

test('speech errors restore screen-reader announcements; cancelled errors are ignored', () => {
  const f = fixture();
  f.feature.enableSpeech(true);
  const stale = f.spoken.at(-1);
  f.feature.speak('New speech');
  stale.onerror({ error: 'audio-busy' });
  assert.equal(f.feature.state.speechEnabled, true);
  f.spoken.at(-1).onerror({ error: 'audio-busy' });
  assert.equal(f.feature.state.speechEnabled, false);
  assert.equal(f.feature.state.announcements, 'screen-reader');
  assert.match(f.feature.state.speechStatus, /could not play/);
});

test('explicit announcement choice prevents duplicate automatic speech and live regions', () => {
  const f = fixture();
  f.feature.enableSpeech(true);
  assert.equal(f.feature.state.announcements, 'app-voice');
  f.feature.setAnnouncements('screen-reader');
  assert.equal(f.feature.state.speechEnabled, false);
  assert.equal(f.feature.utterance, null);
});

function fakeDOM() {
  const nodes = new Map();
  const documentListeners = {}, windowListeners = {};
  const querySelector = selector => {
    if (!nodes.has(selector)) {
      const classes = new Set();
      nodes.set(selector, { textContent: '', value: '', attrs: {}, listeners: {},
        classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
          contains(name) { return classes.has(name); } },
        setAttribute(key, value) { this.attrs[key] = value; }, addEventListener(name, fn) { this.listeners[name] = fn; },
        async play() {}, pause() {} });
    }
    return nodes.get(selector);
  };
  const root = { querySelector, ownerDocument: { hidden: false, getElementById(id) { return querySelector(`#${id}`); },
    addEventListener(name, fn) { documentListeners[name] = fn; } } };
  const platform = { navigator: {}, isSecureContext: true, location: { search: '' },
    addEventListener(name, fn) { windowListeners[name] = fn; }, dispatchEvent() {} };
  return { root, platform, nodes, documentListeners, windowListeners };
}

test('UI wiring stops on hide without PiP and on pagehide; never auto resumes', async () => {
  const dom = fakeDOM();
  const track = { stopCount: 0, stop() { this.stopCount++; }, addEventListener() {} };
  dom.platform.navigator.mediaDevices = { async getUserMedia() { return { getTracks: () => [track] }; } };
  const original = globalThis.CustomEvent;
  globalThis.CustomEvent ??= class { constructor(name, detail) { Object.assign(this, detail); } };
  try {
    const feature = mountCamera(dom.root, dom.platform);
    assert.equal(dom.nodes.get('#camera-simulate').hidden, true);
    await feature.start();
    assert.equal(dom.nodes.get('#ready-permission-light').classList.contains('permission-granted'), true);
    dom.root.ownerDocument.hidden = true;
    dom.documentListeners.visibilitychange();
    assert.equal(feature.state.phase, 'off');
    assert.ok(track.stopCount > 0);
    dom.root.ownerDocument.hidden = false;
    dom.documentListeners.visibilitychange();
    assert.equal(feature.state.phase, 'off');
    await feature.start();
    dom.windowListeners.pagehide();
    assert.equal(feature.state.phase, 'off');
    feature.destroy();
  } finally { globalThis.CustomEvent = original; }
});

test('the mounted website keeps confirmed speech alerts in hidden PiP and stops when its window closes', async () => {
  const dom = fakeDOM();
  const doc = dom.root.ownerDocument;
  const video = dom.root.querySelector('#camera-video');
  const spoken = [];
  const track = { readyState: 'live', muted: false, stopped: false, stop() { this.stopped = true; }, addEventListener() {} };
  dom.platform.navigator.mediaDevices = { async getUserMedia() { return { getTracks: () => [track], getVideoTracks: () => [track] }; } };
  dom.platform.speechSynthesis = { cancel() {}, getVoices: () => [], speak: utterance => spoken.push(utterance.text) };
  dom.platform.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  video.requestPictureInPicture = () => { doc.pictureInPictureElement = video; video.listeners.enterpictureinpicture(); return Promise.resolve(); };
  doc.exitPictureInPicture = async () => { doc.pictureInPictureElement = null; video.listeners.leavepictureinpicture(); };
  let detection;
  const feature = mountCamera(dom.root, dom.platform);
  try {
    feature.registerDetector({ async start(context) { detection = context; } });
    feature.enableSpeech(true);
    await feature.start(); await Promise.resolve();
    dom.nodes.get('#camera-pip').listeners.click(); await Promise.resolve();
    assert.equal(doc.pictureInPictureElement, video);
    doc.hidden = true; dom.documentListeners.visibilitychange();
    assert.equal(feature.state.phase, 'active');
    assert.equal(detection.signal.aborted, false);
    detection.onObstacle();
    assert.ok(spoken.includes('Object ahead.'));
    doc.pictureInPictureElement = null; video.listeners.leavepictureinpicture();
    assert.equal(feature.state.phase, 'off');
    assert.equal(track.stopped, true);
    assert.equal(detection.signal.aborted, true);
  } finally { feature.destroy(); }
});

test('PiP is available while the detector loads and its paused feed can be resumed', async () => {
  const dom = fakeDOM(), doc = dom.root.ownerDocument;
  const video = dom.root.querySelector('#camera-video');
  const loading = deferred();
  const track = { stop() {}, addEventListener() {} };
  dom.platform.navigator.mediaDevices = { async getUserMedia() { return { getTracks: () => [track] }; } };
  video.requestPictureInPicture = () => { doc.pictureInPictureElement = video; video.listeners.enterpictureinpicture(); return Promise.resolve(); };
  doc.exitPictureInPicture = async () => { doc.pictureInPictureElement = null; video.listeners.leavepictureinpicture(); };
  const feature = mountCamera(dom.root, dom.platform);
  try {
    feature.registerDetector({ start: () => loading.promise });
    await feature.start();
    assert.equal(feature.detectionRunning, false);
    assert.equal(dom.nodes.get('#camera-pip').disabled, false);
    dom.nodes.get('#camera-pip').listeners.click(); await Promise.resolve();
    video.paused = true; video.listeners.pause();
    assert.equal(dom.nodes.get('#camera-pip-resume').hidden, false);
    assert.match(dom.nodes.get('#camera-pip-status').textContent, /playback is paused/);
    video.play = async () => { video.paused = false; video.listeners.playing(); };
    dom.nodes.get('#camera-pip-resume').listeners.click(); await Promise.resolve();
    assert.equal(dom.nodes.get('#camera-pip-resume').hidden, true);
  } finally { feature.destroy(); loading.resolve(); }
});

test('preview serves integrated camera assets and preserves the file allowlist', async () => {
  const server = createPreviewServer({ apiOrigin: new URL('http://127.0.0.1:3001') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/camera.js', '/picture-in-picture.js', '/backend-detector.js', '/standalone.js', '/', '/app.js',
      '/main.html', '/camera.html', '/homePage.css', '/integration.css', '/site.js']) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 200, path);
      await response.text();
    }
    assert.equal((await fetch(origin + '/camera/')).status, 404);
    assert.equal((await fetch(origin + '/package.json')).status, 404);
    assert.match(await (await fetch(origin + '/')).text(), /id="camera-feature"/);
    assert.match(await (await fetch(origin + '/camera.html')).text(), /id="demo-tab"/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('owned PiP retains hidden preview but aborts inference, clears results, and resumes only on foreground', async () => {
  const dom = fakeDOM();
  dom.platform.location.search = '?pip=preview';
  const doc = dom.root.ownerDocument;
  const video = dom.root.querySelector('#camera-video');
  const track = { stops: 0, stop() { this.stops++; }, addEventListener() {} };
  let requests = 0;
  dom.platform.navigator.mediaDevices = { async getUserMedia() { requests++; return { getTracks: () => [track] }; } };
  Object.assign(video, { readyState: 2, videoWidth: 640 });
  doc.pictureInPictureEnabled = true;
  video.requestPictureInPicture = async () => {
    doc.pictureInPictureElement = video;
    video.listeners.enterpictureinpicture();
  };
  doc.exitPictureInPicture = async () => {
    doc.pictureInPictureElement = null;
    video.listeners.leavepictureinpicture();
  };
  const contexts = [];
  const feature = mountCamera(dom.root, dom.platform);
  feature.registerDetector({ async start(context) { contexts.push(context); } });
  try {
    await feature.start();
    dom.nodes.get('#camera-pip').listeners.click();
    await Promise.resolve();
    doc.hidden = true;
    dom.documentListeners.visibilitychange();
    assert.equal(feature.state.phase, 'active');
    assert.equal(track.stops, 0);
    assert.equal(contexts[0].signal.aborted, true);
    assert.equal(feature.detectionRunning, false);
    assert.equal(feature.state.result, null);
    assert.match(feature.state.detection, /paused/i);
    assert.match(dom.nodes.get('#camera-permission-label').textContent, /paused/i);
    assert.equal(feature.stallTimer, null);
    contexts[0].onObstacle();
    assert.equal(feature.state.obstacle, '');
    contexts[0].onDistance(1.5);
    assert.equal(feature.state.distance, 'Not available');
    doc.hidden = false;
    dom.documentListeners.visibilitychange();
    await Promise.resolve();
    assert.equal(contexts.length, 2);
    assert.equal(contexts[1].signal.aborted, false);
    assert.equal(requests, 1);
    doc.hidden = true;
    dom.documentListeners.visibilitychange();
    await doc.exitPictureInPicture();
    assert.equal(feature.state.phase, 'off');
    assert.equal(track.stops, 1);
    assert.equal(contexts[1].signal.aborted, true);
    doc.hidden = false;
    dom.documentListeners.visibilitychange();
    assert.equal(feature.state.phase, 'off');
    await feature.start();
    dom.nodes.get('#camera-pip').listeners.click();
    await Promise.resolve();
    assert.equal(doc.pictureInPictureElement, video);
    dom.windowListeners.pagehide();
    assert.equal(feature.state.phase, 'off');
    assert.equal(doc.pictureInPictureElement, null);
  } finally { feature.destroy(); }
});

test('fresh detections expire, reject old sequences and clear on error and stop', async () => {
  const f = fixture();
  let context;
  f.feature.registerDetector({ async start(value) { context = value; } });
  await f.feature.start();
  const result = sequence => ({ frame: { sequence }, ageMs: 400, sourceWidth: 640, sourceHeight: 480,
    detections: [{ label: 'person', confidence: .91, inZone: true, bbox: { x: .1, y: .2, width: .3, height: .4 } }],
    alert: { triggered: false, reason: 'confirming' } });
  assert.equal(typeof context.onResult, 'function');
  context.onResult(result(2));
  assert.equal(f.feature.state.detections.length, 1);
  assert.match(f.feature.state.detection, /confirm/i);
  context.onResult({ ...result(1), detections: [] });
  assert.equal(f.feature.state.detections.length, 1);
  f.advance(2100);
  assert.deepEqual(f.feature.state.detections, []);
  assert.match(f.feature.state.detection, /fresh/i);
  context.onResult(result(3));
  context.onError(new Error('Connection lost'));
  assert.deepEqual(f.feature.state.detections, []);
  context.onResult(result(4));
  assert.deepEqual(f.feature.state.detections, []);
  f.feature.stop();
  assert.deepEqual(f.feature.state.detections, []);
});

test('invalid result dimensions, stale frames and previous runs cannot display boxes', async () => {
  const f = fixture();
  const contexts = [];
  f.feature.registerDetector({ async start(context) { contexts.push(context); } });
  await f.feature.start();
  const result = { frame: { sequence: 1 }, ageMs: 0, sourceWidth: 640, sourceHeight: 480,
    detections: [{ label: 'chair', confidence: .8, bbox: { x: .1, y: .1, width: .2, height: .3 } }], alert: {} };
  contexts[0].onResult({ ...result, sourceWidth: 0 });
  assert.equal(f.feature.state.result, null);
  contexts[0].onResult({ ...result, ageMs: 2500 });
  assert.equal(f.feature.state.result, null);
  contexts[0].onResult(result);
  assert.equal(f.feature.state.detections.length, 1);
  f.feature.stop();
  await f.feature.start();
  contexts[0].onResult({ ...result, frame: { sequence: 99 } });
  assert.equal(f.feature.state.result, null);
  contexts[1].onResult({ ...result, detections: [...result.detections,
    { label: '<script>', confidence: NaN, bbox: {} },
    { label: 'bad', confidence: 1, bbox: { x: -1, y: 0, width: 1, height: 1 } }] });
  assert.equal(f.feature.state.detections.length, 1);
  f.feature.stop();
});

test('hidden document suppresses result and obstacle callbacks even before visibility event delivery', async () => {
  let visible = true, context;
  const f = fixture({ isVisible: () => visible });
  f.feature.registerDetector({ async start(value) { context = value; } });
  await f.feature.start();
  visible = false;
  context.onResult({ frame: { sequence: 1 }, ageMs: 0, sourceWidth: 640, sourceHeight: 480,
    detections: [{ label: 'chair', confidence: .8, bbox: { x: 0, y: 0, width: .3, height: .3 } }], alert: {} });
  context.onObstacle();
  assert.equal(f.feature.state.result, null);
  assert.equal(f.feature.state.obstacle, '');
  f.feature.stop();
});

test('mounted camera redraws safely on viewport and intrinsic video resize', () => {
  const dom = fakeDOM();
  const feature = mountCamera(dom.root, dom.platform);
  assert.doesNotThrow(() => dom.windowListeners.resize());
  assert.doesNotThrow(() => feature.video.listeners.resize());
  feature.destroy();
});

test('default timers preserve native browser receiver requirements', () => {
  const originals = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  let feature;
  globalThis.setTimeout = function () { if (this === feature) throw new TypeError('Illegal invocation'); return 1; };
  globalThis.clearTimeout = function () { if (this === feature) throw new TypeError('Illegal invocation'); };
  try {
    ({ feature } = fixture({ schedule: undefined, unschedule: undefined }));
    assert.doesNotThrow(() => feature.acceptResult({ frame: { sequence: 1 }, ageMs: 0,
      sourceWidth: 640, sourceHeight: 480, detections: [], alert: {} }));
    assert.doesNotThrow(() => feature.stopDetection());
  } finally { Object.assign(globalThis, originals); }
});

test('a frozen preview is recovered, then stopped with restart instructions after repeated failures', async () => {
  const f = fixture();
  let plays = 0;
  f.video.currentTime = 0;
  f.video.play = async () => { plays++; };
  await f.feature.start();
  // A preview that keeps advancing is never treated as stalled.
  for (let i = 0; i < 6; i++) { f.video.currentTime += 0.2; f.advance(1000); }
  assert.equal(f.feature.state.phase, 'active');
  assert.equal(plays, 1, 'Only the initial play call happened while frames advanced');
  f.advance(5000);
  assert.match(f.feature.state.camera, /stalled.*attempt 1 of 2/i);
  assert.equal(plays, 2);
  f.advance(5000);
  assert.match(f.feature.state.camera, /attempt 2 of 2/i);
  f.advance(5000);
  assert.equal(f.feature.state.phase, 'off');
  assert.match(f.feature.state.camera, /froze and could not recover/i);
  assert.ok(f.tracks.every(track => track.stopped));
});

test('measured performance is reported from detector metrics and cleared on stop', async () => {
  const f = fixture();
  let context;
  f.feature.registerDetector({ async start(value) { context = value; } });
  await f.feature.start();
  context.onMetrics({ lastMs: 410, averageMs: 380, captureMaxSide: 512 });
  assert.match(f.feature.state.performance, /410 ms.*380 ms.*512 px/);
  context.onMetrics({ lastMs: NaN, averageMs: 1, captureMaxSide: 1 });
  assert.match(f.feature.state.performance, /410 ms/, 'Invalid measurements never overwrite a real one');
  f.feature.stop();
  assert.equal(f.feature.state.performance, 'No measurements yet.');
});

test('model preparation renders loading before permission and cancellation prevents late activation', async () => {
  const ready = deferred(); const f = fixture(); let context;
  f.feature.registerDetector({ prepare(value) { context = value; return ready.promise; }, async start() {} });
  const starting = f.feature.start();
  assert.equal(f.feature.state.phase, 'loading'); assert.equal(f.calls.length, 0);
  assert.match(f.renders.at(-1).message, /loading/i);
  f.feature.stop(); assert.equal(context.signal.aborted, true); assert.equal(f.feature.pending, null);
  ready.resolve(); await starting;
  assert.equal(f.calls.length, 0); assert.equal(f.feature.state.phase, 'off');
});

test('preparation failure keeps camera off and permits an explicit retry', async () => {
  const f = fixture(); let attempts = 0;
  f.feature.registerDetector({ async prepare() { if (++attempts === 1) throw new Error('weights unavailable'); }, async start() {} });
  await f.feature.start();
  assert.equal(f.calls.length, 0); assert.equal(f.feature.state.phase, 'off');
  assert.equal(f.feature.state.startupError, true); assert.match(f.feature.state.camera, /Retry.*Cancel/);
  await f.feature.start(); assert.equal(f.calls.length, 1); f.feature.stop();
});

test('preparation timeout fails closed and ignores a late ready model', async () => {
  const ready = deferred(); const f = fixture();
  f.feature.registerDetector({ prepare: () => ready.promise, async start() {} });
  const starting = f.feature.start(); f.advance(120000); await starting;
  assert.equal(f.feature.state.startupError, true); assert.equal(f.calls.length, 0);
  ready.resolve(); await Promise.resolve(); assert.equal(f.calls.length, 0);
});

test('mounted loading UI is busy with Cancel and failures expose Retry and Cancel', async () => {
  const dom = fakeDOM(); const ready = deferred(); let calls = 0;
  dom.platform.navigator.mediaDevices = { async getUserMedia() { calls++; } };
  const feature = mountCamera(dom.root, dom.platform);
  feature.registerDetector({ prepare: () => ready.promise, async start() {} });
  try {
    const starting = feature.start();
    assert.equal(dom.nodes.get('#camera-status').attrs['aria-busy'], 'true');
    assert.equal(dom.nodes.get('#camera-stop').textContent, 'Cancel');
    ready.reject(new Error('offline')); await starting;
    assert.equal(dom.nodes.get('#camera-start').textContent, 'Retry');
    assert.equal(dom.nodes.get('#camera-stop').disabled, false); assert.equal(calls, 0);
  } finally { feature.destroy(); }
});

for (const reason of ['visibilitychange', 'pagehide']) test(`${reason} during preparation cannot activate camera later`, async () => {
  const dom = fakeDOM(); const ready = deferred(); let calls = 0;
  dom.platform.navigator.mediaDevices = { async getUserMedia() { calls++; } };
  const feature = mountCamera(dom.root, dom.platform);
  feature.registerDetector({ prepare: () => ready.promise, async start() {} });
  const starting = feature.start(); dom.root.ownerDocument.hidden = true;
  (reason === 'pagehide' ? dom.windowListeners : dom.documentListeners)[reason]();
  ready.resolve(); await starting; assert.equal(calls, 0); feature.destroy();
});

test('cancel then restart during shared preparation only allows the newest run to request permission', async () => {
  const { createLocalDetector } = await import('./local-detector.js');
  const ready = deferred(); let loads = 0;
  const f = fixture();
  f.feature.registerDetector(createLocalDetector({ loader: () => { loads++; return ready.promise; },
    createCanvas: () => ({ getContext() {} }), schedule: () => 0, unschedule() {} }));
  const first = f.feature.start();
  f.feature.stop();
  const second = f.feature.start();
  await f.feature.start();
  assert.equal(f.calls.length, 0); assert.equal(loads, 1);
  ready.resolve({ async detect() { return []; } });
  await Promise.all([first, second]);
  assert.equal(f.calls.length, 1); assert.equal(f.feature.state.phase, 'active');
  f.feature.stop();
  await f.feature.start();
  assert.equal(loads, 1); assert.equal(f.calls.length, 2);
  f.feature.stop();
});

test('dedicated startup screen exposes Cancel/Retry and disappears before camera capture', async () => {
  const dom = fakeDOM(); const ready = deferred();
  dom.platform.navigator.mediaDevices = { async getUserMedia() { throw new Error('camera must stay off'); } };
  const feature = mountCamera(dom.root, dom.platform);
  feature.registerDetector({ prepare: () => ready.promise, async start() {} });
  const panel = dom.root.querySelector('#camera-startup');
  try {
    assert.equal(panel.hidden, true);
    const starting = feature.start();
    assert.equal(panel.hidden, false);
    assert.match(dom.nodes.get('#camera-startup-status').textContent, /Loading detection model/);
    assert.equal(dom.nodes.get('#camera-startup-retry').hidden, true);
    ready.reject(new Error('offline')); await starting;
    assert.equal(panel.hidden, false);
    assert.equal(dom.nodes.get('#camera-startup-retry').hidden, false);
    dom.nodes.get('#camera-startup-cancel').listeners.click();
    assert.equal(panel.hidden, true);
    assert.equal(feature.state.phase, 'off');
  } finally { feature.destroy(); }
});
