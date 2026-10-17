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

test('UI wiring stops on hide and pagehide, never auto resumes; simulation hidden by default', async () => {
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

test('preview serves integrated camera assets and preserves the file allowlist', async () => {
  const server = createPreviewServer({ apiOrigin: new URL('http://127.0.0.1:3001') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/camera.js', '/backend-detector.js', '/standalone.js', '/', '/app.js',
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
