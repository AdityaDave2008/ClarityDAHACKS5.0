import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDetections, createAlertPolicy, createLocalDetector, pointInZone } from './local-detector.js';
import { CameraFeature } from './camera.js';

// The detector is exercised through its real start() contract with a stubbed model, so the
// frame loop, staleness rule, and alert behavior are covered. Actual COCO-SSD accuracy and
// WASM load time need a browser.

function prediction({ label = 'backpack', score = 0.9, bbox = [240, 240, 160, 200] } = {}) {
  return { class: label, score, bbox };
}

function harness({ predictions = [prediction()], detectImpl } = {}) {
  const context = { drawImage() {} };
  const canvas = { width: 0, height: 0, getContext: () => context };
  let time = 0;
  const pending = [];
  return {
    canvas,
    advance(ms) { time += ms; },
    runScheduled() { const next = pending.shift(); if (next) next(); },
    scheduled: () => pending.length,
    options: {
      loader: async () => ({
        detect: detectImpl ?? (async () => predictions),
      }),
      createCanvas: () => canvas,
      now: () => time,
      schedule: (callback) => { pending.push(callback); return pending.length; },
      unschedule: () => {},
    },
  };
}

function session(overrides = {}) {
  const controller = new AbortController();
  const events = { results: [], errors: [], statuses: [], obstacles: 0, metrics: [] };
  return {
    controller,
    events,
    context: {
      video: { videoWidth: 640, videoHeight: 480 },
      signal: controller.signal,
      onObstacle: () => { events.obstacles += 1; },
      onError: (message) => events.errors.push(message),
      onStatus: (message) => events.statuses.push(message),
      onResult: (result) => events.results.push(result),
      onMetrics: (metric) => events.metrics.push(metric),
      ...overrides,
    },
  };
}

test('detections carry the bounding boxes the overlay draws', async () => {
  // The deployed Cloudflare API returns no boxes, which is why detection runs here instead.
  const stub = harness();
  const detector = createLocalDetector(stub.options);
  const run = session();
  await detector.start(run.context);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(run.events.results.length, 1);
  const [detection] = run.events.results[0].detections;
  assert.ok(detection, 'A supported object must be reported');
  assert.equal(detection.label, 'backpack');
  for (const value of [detection.bbox.x, detection.bbox.y, detection.bbox.width, detection.bbox.height]) {
    assert.ok(value >= 0 && value <= 1, 'Boxes must be normalized for the overlay');
  }
  assert.ok(detection.anchor, 'The zone test needs a bottom-center anchor');
});

test('frames are never uploaded', async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (...args) => { requests.push(args[0]); return originalFetch?.(...args); };
  try {
    const stub = harness();
    await createLocalDetector(stub.options).start(session().context);
    assert.deepEqual(requests, [], 'On-device detection must not send the camera frame anywhere');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an object must be confirmed across frames before alerting', async () => {
  const stub = harness();
  const detector = createLocalDetector(stub.options);
  const run = session();
  await detector.start(run.context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(run.events.results[0].alert.reason, 'confirming');
  assert.equal(run.events.obstacles, 0, 'One sighting must not alert');

  stub.runScheduled();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(run.events.obstacles, 1, 'A confirmed object must alert');
});

test('a frozen camera cannot confirm an object, and muted camera input never reaches inference', async () => {
  const stub = harness();
  const run = session();
  const video = run.context.video;
  const track = { readyState: 'live', muted: false };
  video.currentTime = 1; video.readyState = 4; video.srcObject = { getVideoTracks: () => [track] };
  await createLocalDetector(stub.options).start(run.context);
  await new Promise(resolve => setImmediate(resolve));
  stub.runScheduled(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(run.events.results.length, 1, 'Repeated media time must not produce another result');
  assert.equal(run.events.obstacles, 0);
  video.currentTime = 2; track.muted = true;
  stub.runScheduled(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(run.events.results.length, 1);
  track.muted = false;
  stub.runScheduled(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(run.events.results.at(-1).alert.reason, 'confirming', 'Frozen/muted inputs must break the old streak');
  video.currentTime = 3;
  stub.runScheduled(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(run.events.obstacles, 1);
  run.controller.abort();
});

test('a result older than the freshness limit is discarded', async () => {
  const stub = harness();
  // Simulate inference slower than the 2500 ms staleness window.
  const detector = createLocalDetector({
    ...stub.options,
    loader: async () => ({ detect: async () => { stub.advance(3000); return [prediction()]; } }),
  });
  const run = session();
  await detector.start(run.context);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(run.events.results.length, 0, 'A stale result must not reach the overlay');
  assert.equal(run.events.obstacles, 0);
  assert.ok(run.events.statuses.some((message) => /freshness limit/i.test(message)));
});

test('a model that fails to load reports the reason instead of silently doing nothing', async () => {
  const stub = harness();
  const detector = createLocalDetector({
    ...stub.options,
    loader: async () => { throw new Error('This browser cannot run WebAssembly inference.'); },
  });
  const run = session();
  await detector.start(run.context);
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(run.events.errors[0], /WebAssembly/);
  assert.equal(stub.scheduled(), 0, 'A failed load must not keep polling');
});

test('an inference failure breaks the streak rather than ending detection', async () => {
  const stub = harness();
  let calls = 0;
  const detector = createLocalDetector({
    ...stub.options,
    loader: async () => ({
      detect: async () => {
        calls += 1;
        if (calls === 2) throw new Error('inference failed');
        return [prediction()];
      },
    }),
  });
  const run = session();
  await detector.start(run.context);
  await new Promise((resolve) => setImmediate(resolve));

  stub.runScheduled();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(run.events.errors.length, 1);
  assert.equal(run.events.obstacles, 0, 'A failed frame must not complete a confirmation');
  assert.ok(stub.scheduled() > 0, 'Detection must continue after a recoverable failure');
});

test('stopping ends the loop', async () => {
  const stub = harness();
  const detector = createLocalDetector(stub.options);
  const run = session();
  await detector.start(run.context);
  await new Promise((resolve) => setImmediate(resolve));
  run.controller.abort();
  stub.runScheduled();
  await new Promise((resolve) => setImmediate(resolve));
  const after = run.events.results.length;
  stub.runScheduled();
  assert.equal(run.events.results.length, after, 'No results may arrive after stopping');
});

test('only supported categories reach the overlay', () => {
  const detections = assessDetections([
    prediction({ label: 'backpack', score: 0.9 }),
    prediction({ label: 'toothbrush', score: 0.99 }),
    prediction({ label: 'unknown-object', score: 0.99 }),
    prediction({ label: 'chair', score: 0.2 }),
  ], 640, 480, 0.6);
  assert.deepEqual(detections.map((item) => item.label), ['backpack', 'toothbrush'], 'Valid COCO categories pass; unknown and low-confidence results are dropped');
});

test('boxes are clamped to the frame', () => {
  const [detection] = assessDetections([prediction({ bbox: [-20, -20, 900, 900] })], 640, 480, 0.6);
  assert.equal(detection.bbox.x, 0);
  assert.equal(detection.bbox.y, 0);
  assert.ok(detection.bbox.x + detection.bbox.width <= 1);
  assert.ok(detection.bbox.y + detection.bbox.height <= 1);
});

test('the zone matches the shape the overlay draws', () => {
  assert.equal(pointInZone({ x: 0.5, y: 0.9 }), true);
  assert.equal(pointInZone({ x: 0.5, y: 0.1 }), false);
});

test('a cooldown prevents repeated alerts for the same object', () => {
  const policy = createAlertPolicy({ cooldownMs: 3000 });
  const item = { label: 'chair', confidence: 0.8, bbox: { x: 0.4, y: 0.6, width: 0.2, height: 0.3 }, inZone: true };
  assert.equal(policy.update([item], 1000).reason, 'confirming');
  assert.equal(policy.update([item], 1200).triggered, true);
  assert.equal(policy.update([item], 1400).reason, 'cooldown');
});

test('optional synchronous frame hook receives exact canvas and sequence without affecting v1 on failure', async () => {
  const stub = harness();
  const frames = [];
  const run = session({ onFrame: frame => { frames.push(frame); throw Error('optional depth failed'); } });
  await createLocalDetector(stub.options).start(run.context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].canvas, stub.canvas);
  assert.equal(frames[0].sequence, run.events.results[0].sequence);
  assert.equal(frames[0].capturedAt, 0);
  assert.equal(frames[0].sourceWidth, 640);
  assert.deepEqual(frames[0].detections, run.events.results[0].detections);
  assert.equal(run.events.errors.length, 0);
  assert.equal(run.events.results.length, 1);
});

test('COCO uses the team-selected 0.45 threshold and a 640px capture cap', async () => {
  const stub = harness({ predictions: [prediction({ score: .44 }), prediction({ score: .45 })] });
  const run = session({video: {videoWidth: 1280, videoHeight: 720}});
  const stop = await createLocalDetector(stub.options).start(run.context);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(run.events.results[0].detections.map(item => item.confidence), [.45]);
  assert.equal(stub.canvas.width, 640);
  assert.equal(stub.canvas.height, 360);
  stop();
});

test('returned stop suppresses in-flight results without requiring abort', async () => {
  let resolve;
  const stub = harness({detectImpl: () => new Promise(r => {resolve = r;})});
  const run = session();
  const stop = await createLocalDetector(stub.options).start(run.context);
  stop(); resolve([prediction()]);
  await new Promise(r => setImmediate(r));
  assert.equal(run.events.results.length, 0);
  assert.equal(stub.scheduled(), 0);
});

test('abort during load suppresses late load errors', async () => {
  let reject;
  const stub = harness();
  const run = session();
  const pending = createLocalDetector({...stub.options, loader: () => new Promise((_, r) => {reject=r;})}).start(run.context);
  run.controller.abort(); reject(Error('late network failure'));
  await pending;
  assert.deepEqual(run.events.errors, []);
});

test('aborted loading cannot overwrite the next camera session status', async () => {
  let resume;
  const stub = harness(); const run = session();
  const pending = createLocalDetector({...stub.options,loader: ({onStatus}) => new Promise(resolve => {
    resume=()=>{onStatus('late ready');resolve({detect:async()=>[]});};
  })}).start(run.context);
  run.controller.abort(); resume(); await pending;
  assert.deepEqual(run.events.statuses, []);
});

// These exercise the real loop. A fixed post-inference sleep unnecessarily adds
// model latency to the target interval. Timers and inference are controlled here
// to make cadence and backpressure assertions independent of machine speed.
for (const [inferenceMs, expectedDelay] of [[20, 70], [80, 16], [150, 16]]) {
  test(`successful ${inferenceMs}ms inference targets start-to-start cadence with a UI yield`, async () => {
    const stub = harness();
    const delays = [];
    const stop = await createLocalDetector({
      ...stub.options,
      loader: async () => ({ detect: async () => { stub.advance(inferenceMs); return [prediction()]; } }),
      schedule: (_callback, delay) => { delays.push(delay); },
    }).start(session().context);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(delays, [expectedDelay]);
    stop();
  });
}

test('slow failed and stale frames retain full retry delay instead of spinning', async () => {
  for (const failure of [true, false]) {
    const stub = harness();
    const delays = [];
    const run = session();
    const stop = await createLocalDetector({
      ...stub.options,
      loader: async () => ({ detect: async () => {
        stub.advance(3000);
        if (failure) throw Error('inference failed');
        return [prediction()];
      } }),
      schedule: (_callback, delay) => { delays.push(delay); },
    }).start(run.context);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(delays, [90]);
    assert.equal(run.events.results.length, 0);
    stop();
  }
});

test('in-flight inference never queues captures and the next tick captures the latest video', async () => {
  let finish;
  const stub = harness({ detectImpl: () => new Promise(resolve => { finish = resolve; }) });
  const captured = [];
  const video = { videoWidth: 640, videoHeight: 480, frameId: 1 };
  stub.canvas.getContext = () => ({ drawImage: source => captured.push(source.frameId) });
  const run = session({ video });
  const stop = await createLocalDetector(stub.options).start(run.context);
  assert.deepEqual(captured, [1]);
  assert.equal(stub.scheduled(), 0);
  video.frameId = 2;
  stub.advance(150);
  stub.runScheduled();
  assert.deepEqual(captured, [1], 'No capture while inference is pending');
  finish([prediction()]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stub.scheduled(), 1);
  video.frameId = 3;
  stub.runScheduled();
  assert.deepEqual(captured, [1, 3], 'Intermediate video frames must not be queued');
  assert.equal(stub.scheduled(), 0);
  stop();
  finish([prediction()]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(run.events.results.length, 1, 'Stopping discards the last in-flight result');
  assert.equal(stub.scheduled(), 0);
});

for (const rejectOld of [false, true]) {
  test(`restart waits before fresh capture and releases the gate on ${rejectOld ? 'rejection' : 'success'}`, async () => {
    const pending = [], captured = [];
    let active = 0, maximum = 0;
    const stub = harness({ detectImpl: () => {
      active++;
      maximum = Math.max(maximum, active);
      return new Promise((resolve, reject) => pending.push({
        finish() { active--; resolve([prediction()]); },
        fail() { active--; reject(Error('old inference failed')); },
      }));
    } });
    stub.canvas.getContext = () => ({ drawImage: video => captured.push(video.frameId) });
    const detector = createLocalDetector(stub.options);
    const old = session({ video: { videoWidth: 640, videoHeight: 480, frameId: 'old' } });
    const cancelled = session({ video: { videoWidth: 640, videoHeight: 480, frameId: 'cancelled' } });
    const video = { videoWidth: 640, videoHeight: 480, frameId: 'before-wait' };
    const latest = session({ video });
    const frames = [];
    latest.context.onFrame = frame => frames.push(frame);
    await detector.start(old.context);
    old.controller.abort();
    const stopCancelled = await detector.start(cancelled.context);
    stopCancelled(); // Returned stop must fence waiting work even without abort.
    await detector.start(latest.context);
    assert.deepEqual(captured, ['old'], 'Waiting starts must not capture stale frames');
    assert.equal(maximum, 1, 'All starts share a single inference slot');
    video.frameId = 'latest-after-wait';
    stub.advance(3000);
    if (rejectOld) pending[0].fail(); else pending[0].finish();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(captured, ['old', 'latest-after-wait']);
    assert.equal(maximum, 1);
    assert.equal(pending.length, 2, 'Cancelled waiting start must never invoke the model');
    pending[1].finish();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(latest.events.results.length, 1, 'Waiting time must not age a newly captured result');
    assert.equal(latest.events.results[0].ageMs, 0);
    assert.equal(frames[0].capturedAt, 3000);
    assert.equal(old.events.results.length, 0);
    assert.equal(old.events.errors.length, 0, 'Aborted old rejection must not affect the new session');
    assert.equal(cancelled.events.results.length, 0);
    latest.controller.abort();
  });
}

for (const lifecycle of ['PiP hide/show', 'Stop/Start']) {
  test(`rapid ${lifecycle} never overlaps inference or captures aborted waiting runs`, async () => {
    let active = 0, maximum = 0, captures = 0, visible = true;
    const pending = [];
    const feature = new CameraFeature({
      video: { videoWidth: 640, videoHeight: 480, async play() {}, pause() {} },
      mediaDevices: { async getUserMedia() { return { getTracks: () => [{ stop() {}, addEventListener() {} }] }; } },
      schedule: () => 0, unschedule() {}, isVisible: () => visible,
    });
    feature.registerDetector(createLocalDetector({
      loader: async () => ({ detect: () => {
        active++; maximum = Math.max(maximum, active);
        return new Promise(resolve => pending.push(() => { active--; resolve([prediction()]); }));
      } }),
      createCanvas: () => ({ getContext: () => ({ drawImage() { captures++; } }) }),
      schedule: () => 0, unschedule() {},
    }));
    try {
      await feature.start();
      await new Promise(resolve => setImmediate(resolve));
      for (let i = 0; i < 5; i++) {
        if (lifecycle === 'PiP hide/show') {
          visible = false; feature.pauseForPictureInPicture();
          visible = true; feature.resumeFromPictureInPicture();
        } else { feature.stop(); await feature.start(); }
        await new Promise(resolve => setImmediate(resolve));
      }
      assert.equal(maximum, 1, 'Restart must wait for the old inference without blocking Stop');
      assert.equal(captures, 1, 'No capture queue for hidden/stopped sessions');
      pending[0]();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(pending.length, 2, 'Only the latest non-aborted run invokes the model');
      assert.equal(captures, 2);
      assert.equal(feature.state.result, null, 'Old model result remains fenced after resume');
      pending[1]();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(feature.state.result.sequence, 1);
      assert.equal(maximum, 1);
    } finally { feature.destroy(); }
  });
}

test('prepare shares actual loading, reuses ready model and canceled caller cannot poison reuse', async () => {
  let resolve; let loads = 0;
  const model = { detect: async () => [] };
  const detector = createLocalDetector({ loader: () => { loads++; return new Promise(yes => { resolve = yes; }); } });
  assert.equal(typeof detector.prepare, 'function');
  const canceled = new AbortController(), active = new AbortController();
  const first = detector.prepare({ signal: canceled.signal });
  const firstOutcome = assert.rejects(first, { name: 'AbortError' });
  const second = detector.prepare({ signal: active.signal });
  let finished = false; second.then(() => { finished = true; });
  await Promise.resolve(); assert.equal(finished, false); assert.equal(loads, 1);
  canceled.abort(); resolve(model); await firstOutcome; await second;
  await detector.prepare({ signal: active.signal }); assert.equal(loads, 1);
});

test('failed preparation clears singleflight so Retry really reloads', async () => {
  let loads = 0;
  const detector = createLocalDetector({ loader: async () => { if (++loads === 1) throw new Error('offline'); return { detect() {} }; } });
  assert.equal(typeof detector.prepare, 'function');
  await assert.rejects(detector.prepare(), /offline/);
  await detector.prepare(); assert.equal(loads, 2);
});

test('real loadModel contract waits for WASM runtime and complete weights before reporting ready', async () => {
  const originalDocument = globalThis.document, originalWindow = globalThis.window;
  let runtimeReady, weightsReady, loads = 0;
  const runtime = new Promise(resolve => { runtimeReady = resolve; });
  const weights = new Promise(resolve => { weightsReady = resolve; });
  const statuses = [];
  globalThis.document = {
    baseURI: 'https://example.test/', querySelector: () => null,
    createElement: () => ({ dataset: {}, remove() {} }),
    head: { append(script) { queueMicrotask(() => script.onload()); } },
  };
  globalThis.window = {
    tf: { wasm: { setThreadsCount() {}, setWasmPaths() {} }, async setBackend() { return true; }, ready: () => runtime },
    cocoSsd: { load() { loads++; return weights; } },
  };
  try {
    const { loadModel } = await import(`./local-detector.js?readiness-test`);
    const first = loadModel({ onStatus: value => statuses.push(value) });
    assert.equal(first, loadModel());
    let ready = false; first.then(() => { ready = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ready, false); assert.equal(loads, 0);
    runtimeReady(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(loads, 1); assert.equal(ready, false);
    assert.ok(!statuses.includes('Detection model ready.'));
    const model = { detect() {} }; weightsReady(model);
    assert.equal(await first, model); assert.equal(await loadModel(), model);
    assert.equal(statuses.at(-1), 'Detection model ready.'); assert.equal(loads, 1);
  } finally { globalThis.document = originalDocument; globalThis.window = originalWindow; }
});
