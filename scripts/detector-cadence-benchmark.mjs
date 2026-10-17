// Real packaged WASM inference through the production detector loop, no camera/upload.
// Start frontend/server.js, then set PLAYWRIGHT_MODULE, DETECTOR_FIXTURE and
// BASELINE_DETECTOR (a saved pre-change local-detector.js). Prints raw timings as JSON.
// Static licensed fixture + rAF heartbeat is a scheduling proxy, not device/PiP acceptance.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.DETECTOR_APP_URL || process.env.CANDIDATE_APP_URL || 'http://127.0.0.1:5191/';
const fixturePath = process.env.DETECTOR_FIXTURE || process.env.CANDIDATE_FIXTURE;
const frames = Number(process.env.CADENCE_FRAMES || 40);
assert.ok(Number.isInteger(frames) && frames >= 10 && frames <= 500);
assert.ok(fixturePath && process.env.BASELINE_DETECTOR,
  'Provide a licensed DETECTOR_FIXTURE PNG and pre-change BASELINE_DETECTOR source');
const bytes = readFileSync(fixturePath);
const baseline = readFileSync(process.env.BASELINE_DETECTOR, 'utf8');
const sha = value => createHash('sha256').update(value).digest('hex');
const fixture = `data:image/png;base64,${bytes.toString('base64')}`;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [], forbiddenRequests = [];
  await context.route('**/*', route => {
    const request = route.request();
    if (request.method() !== 'GET' || new URL(request.url()).origin !== new URL(url).origin) {
      forbiddenRequests.push(request.url());
      return route.abort();
    }
    if (new URL(request.url()).pathname === '/local-detector-before.js') {
      return route.fulfill({ body: baseline, contentType: 'text/javascript' });
    }
    if (new URL(request.url()).pathname === '/detector-benchmark.html') {
      return route.fulfill({ body: '<!doctype html><title>Detector cadence measurement</title><body>Local fixture benchmark</body>', contentType: 'text/html' });
    }
    return route.continue();
  });
  page.on('pageerror', error => errors.push(error.message));
  // Avoid unrelated app activity and service workers while retaining same-origin assets.
  await page.goto(new URL('/detector-benchmark.html', url).href);
  const result = await page.evaluate(async ({ fixture, frames }) => {
    const current = await import('/local-detector.js');
    const before = await import('/local-detector-before.js');
    // Both variants must use the same warmed model. Importing each historical
    // module's default loader could create two TFJS graphs and bias the timings.
    const model = await current.loadModel();
    const image = new Image(); image.src = fixture; await image.decode();
    // drawImage supports this exact pixel source. Only dimensions emulate a video.
    image.videoWidth = image.naturalWidth; image.videoHeight = image.naturalHeight;
    const warmCanvas = document.createElement('canvas');
    warmCanvas.width = image.naturalWidth; warmCanvas.height = image.naturalHeight;
    warmCanvas.getContext('2d').drawImage(image, 0, 0);
    const warmups = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now(); await model.detect(warmCanvas);
      warmups.push(performance.now() - start);
    }
    const quantiles = values => {
      const sorted = [...values].sort((a, b) => a - b);
      return { count: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length,
        p50: sorted[Math.floor((sorted.length - 1) * .5)],
        p95: sorted[Math.floor((sorted.length - 1) * .95)], max: sorted.at(-1) };
    };
    async function measure(module, variant) {
      const controller = new AbortController();
      const starts = [], latencies = [], delays = [], rafGaps = [], outputs = [];
      const thresholds = new Set();
      let raf, lastRaf, pendingTimers = 0, maxPendingTimers = 0;
      const heartbeat = at => {
        if (lastRaf !== undefined) rafGaps.push(at - lastRaf);
        lastRaf = at;
        raf = requestAnimationFrame(heartbeat);
      };
      raf = requestAnimationFrame(heartbeat);
      try {
        await new Promise((resolve, reject) => {
          const watchdog = setTimeout(() => { controller.abort(); reject(Error('Detector benchmark timed out')); }, 120000);
          const detector = module.createLocalDetector({
            loader: async () => ({ detect: (...args) => {
              thresholds.add(args[2]);
              return model.detect(...args);
            } }),
            schedule: (callback, delay) => {
              delays.push(delay); pendingTimers++;
              maxPendingTimers = Math.max(maxPendingTimers, pendingTimers);
              return setTimeout(() => { pendingTimers--; callback(); }, delay);
            },
          });
          detector.start({ video: image, signal: controller.signal,
            onObstacle() {},
            onError(message) { clearTimeout(watchdog); controller.abort(); reject(Error(message)); },
            onFrame(frame) { starts.push(frame.capturedAt); },
            onResult(result) {
              latencies.push(result.ageMs); outputs.push(result.detections);
              if (outputs.length === frames) {
                clearTimeout(watchdog); controller.abort(); resolve();
              }
            },
          }).catch(error => { clearTimeout(watchdog); controller.abort(); reject(error); });
        });
      } finally { cancelAnimationFrame(raf); controller.abort(); }
      const intervals = starts.slice(1).map((at, i) => at - starts[i]);
      return { variant, frames, captureIntervalMs: quantiles(intervals), inferenceMs: quantiles(latencies),
        scheduledDelayMs: quantiles(delays), rafGapMs: quantiles(rafGaps),
        rafGapsOver50Ms: rafGaps.filter(ms => ms > 50).length, maxPendingTimers,
        firstTwoResultsMs: starts[1] - starts[0] + latencies[1],
        thresholds: [...thresholds], outputs, raw: { starts, latencies, delays, rafGaps } };
    }
    const runs = [];
    // ABBA balances model warmup/order, but is not a thermal endurance test.
    for (const [variant, module] of [['before', before], ['after', current], ['after', current], ['before', before]]) {
      runs.push(await measure(module, variant));
    }
    const assetURLs = [...new Set(performance.getEntriesByType('resource').map(entry => entry.name))]
      .filter(value => new URL(value).origin === location.origin && new URL(value).pathname.startsWith('/vendor/'));
    const assets = [];
    for (const value of assetURLs) {
      const response = await fetch(value);
      if (!response.ok) throw Error(`Could not fingerprint loaded asset: ${new URL(value).pathname}`);
      const bytes = await response.arrayBuffer();
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      assets.push({ path: new URL(value).pathname, bytes: bytes.byteLength,
        sha256: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('') });
    }
    return { loader: 'local-detector.js#loadModel', runtimeVersion: window.tf?.version?.tfjs ?? null,
      backend: window.tf?.getBackend?.() ?? null, assets,
      sourceSize: [image.naturalWidth, image.naturalHeight], warmups, runs };
  }, { fixture, frames });
  assert.deepEqual(errors, []);
  assert.deepEqual(forbiddenRequests, []);
  const expected = result.runs[0].outputs[0];
  assert.ok(result.assets.length > 0, 'Fingerprint actual packaged runtime/model assets');
  assert.equal(result.runs[0].thresholds.length, 1, 'Record the actual detector confidence threshold');
  assert.ok(expected.some(item => item.label === 'cat'), 'Known positive must survive unchanged detector threshold');
  for (const run of result.runs) {
    assert.equal(run.maxPendingTimers, 1, 'At most one next-frame timer');
    assert.equal(run.outputs.length, frames);
    assert.deepEqual(run.thresholds, result.runs[0].thresholds, 'Do not compare different confidence thresholds');
    for (const output of run.outputs) assert.deepEqual(output, expected, 'Cadence must not change model outputs');
    run.detections = expected;
    delete run.outputs;
  }
  const currentSource = await page.evaluate(() => fetch('/local-detector.js').then(response => response.text()));
  console.log(JSON.stringify({ date: new Date().toISOString(), browser: browser.version(),
    node: process.version,
    host: { platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0].model },
    fixtureSha256: sha(bytes), baselineSourceSha256: sha(baseline), currentSourceSha256: sha(currentSource),
    limitations: ['Static fixture at sourceSize resolution, not live physical camera or PiP',
      'Headless Chromium rAF gaps proxy main-thread responsiveness, not displayed frames',
      'Short warm-run ABBA sample, not phone thermal/battery or accuracy validation'],
    ...result }, null, 2));
} finally { await browser.close(); }
