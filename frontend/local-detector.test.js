import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDetections, createAlertPolicy, createLocalDetector, pointInZone } from './local-detector.js';

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
    prediction({ label: 'chair', score: 0.2 }),
  ], 640, 480, 0.6);
  assert.deepEqual(detections.map((item) => item.label), ['backpack'], 'Unsupported and low-confidence results must be dropped');
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

test('candidate uses tuned threshold rather than baseline and no intermediate resize', async () => {
  const stub = harness({ predictions: [prediction({ score: .78 })] });
  const run = session({video: {videoWidth: 1280, videoHeight: 720}});
  const stop = await createLocalDetector(stub.options).start(run.context);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(run.events.results[0].detections, []);
  assert.equal(stub.canvas.width, 1280);
  assert.equal(stub.canvas.height, 720);
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
