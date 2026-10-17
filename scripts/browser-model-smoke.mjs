// Baseline COCO-SSD acceptance using the app's exported loader and real bundled weights.
// Uses an isolated browser and synthetic camera, never a personal profile or camera.
// PLAYWRIGHT_MODULE=/absolute/path/playwright/index.mjs MODEL_FIXTURE=/path/cat.png node scripts/browser-model-smoke.mjs
// MODEL_APP_URL=https://preview.example/ optionally tests a hosted app without starting a local server.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createPreviewServer } from '../frontend/server.js';

// Some Playwright versions treat an async waitForFunction predicate's Promise as
// truthy before its false result settles. Explicitly await every browser check.
async function waitForBrowserCondition(page, predicate, argument, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate, argument)) return;
    await delay(100);
  }
  throw new Error(`Browser condition did not become true within ${timeoutMs}ms`);
}

assert.ok(process.env.MODEL_FIXTURE, 'MODEL_FIXTURE must name a known positive COCO fixture, not a private camera image');
const bytes = readFileSync(process.env.MODEL_FIXTURE);
const mime = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : 'image/jpeg';
const fixture = `data:${mime};base64,${bytes.toString('base64')}`;
const expectedLabel = process.env.MODEL_EXPECTED_LABEL || 'cat';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const cacheName = 'myeyes-pwa-v10-pip-depth-assets';
const oldCaches = ['myeyes-pwa-v9-depth-assets', 'myeyes-pwa-v9-pip-yolox-51661711'];
const target = process.env.MODEL_APP_URL ? new URL(process.env.MODEL_APP_URL) : null;
if (target) assert.ok(['http:', 'https:'].includes(target.protocol) && !target.username && !target.password,
  'MODEL_APP_URL must be an HTTP(S) app URL without embedded credentials');
const server = target ? null : createPreviewServer({ apiOrigin: new URL('http://127.0.0.1:3001') });
if (server) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = target?.href || `http://127.0.0.1:${server.address().port}/`;
let browser;
const observations = [];
const record = item => { observations.push(item); console.log('JCODE_PROGRESS ' + JSON.stringify(item)); };
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.MODEL_CHROME_PATH ? { executablePath: process.env.MODEL_CHROME_PATH } : {}),
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const context = await browser.newContext({ permissions: ['camera'] });
  const page = await context.newPage();
  const errors = [], uploads = [], depthRequests = [], runtimeResponses = [];
  page.on('response', response => {
    if (response.url().includes('/vendor/')) runtimeResponses.push({ path: new URL(response.url()).pathname, fromServiceWorker: response.fromServiceWorker() });
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST') uploads.push(request.url());
    if (/vendor-depth|huggingface/.test(request.url())) depthRequests.push(request.url());
  });
  await page.goto(new URL('/demo-scene.svg', url).href);
  assert.equal(new URL(page.url()).origin, new URL(process.env.MODEL_APP_URL || url).origin,
    'Browser acceptance must run against the requested app origin');
  await page.evaluate(async names => {
    for (const name of names) await (await caches.open(name)).put('/local-detector.js', new Response('old detector'));
    // This unrelated cache must be preserved but must not supply stale runtime assets.
    await (await caches.open('unrelated-app')).put('/vendor/model/model.json', new Response('stale unrelated model'));
    await (await caches.open('unrelated-app')).put('/picture-in-picture.js', new Response('stale unrelated PiP'));
  }, oldCaches);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => navigator.serviceWorker.register('/sw.js'));
  await waitForBrowserCondition(page, async ({ cacheName, oldCaches }) => {
    const keys = await caches.keys();
    return navigator.serviceWorker.controller?.state === 'activated' && keys.includes(cacheName) && keys.includes('unrelated-app')
      && oldCaches.every(name => !keys.includes(name));
  }, { cacheName, oldCaches }, 90000);
  record({ check: 'real baseline service-worker activation removes both previous app caches and preserves unrelated cache', pass: true,
    controlledState: await page.evaluate(async () => ({ state: navigator.serviceWorker.controller.state,
      script: new URL(navigator.serviceWorker.controller.scriptURL).pathname, caches: await caches.keys() })) });

  async function infer() {
    return page.evaluate(async ({ fixture, expectedLabel }) => {
      const { loadModel, assessDetections, createAlertPolicy } = await import('/local-detector.js');
      const { captureSize } = await import('/logic.js');
      const model = await loadModel();
      const image = new Image(); image.src = fixture; await image.decode();
      const size = captureSize(image.naturalWidth, image.naturalHeight);
      const canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
      canvas.getContext('2d').drawImage(image, 0, 0, size.width, size.height);
      const started = performance.now();
      const predictions = await model.detect(canvas, 20, .6);
      const detections = assessDetections(predictions, size.width, size.height);
      const policy = createAlertPolicy();
      const zoneCandidate = detections.find(item => item.label === expectedLabel && item.inZone);
      return { backend: window.tf.getBackend(), detections, ms: performance.now() - started,
        source: size, zoneCandidate: Boolean(zoneCandidate),
        reasons: zoneCandidate ? [policy.update([zoneCandidate], 1000).reason, policy.update([zoneCandidate], 1100).reason,
          policy.update([zoneCandidate], 1200).reason] : null };
    }, { fixture, expectedLabel });
  }
  const first = await infer();
  assert.equal(first.backend, 'wasm');
  assert.ok(first.detections.some(item => item.label === expectedLabel), `Known positive fixture must detect ${expectedLabel} at baseline threshold`);
  for (const item of first.detections) {
    assert.ok(item.confidence >= .6 && item.confidence <= 1);
    for (const value of Object.values(item.bbox)) assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
  }
  if (first.zoneCandidate) assert.deepEqual(first.reasons, ['confirming', 'triggered', 'cooldown']);
  record({ check: 'real bundled COCO-SSD WASM inference through exported loadModel and baseline capture preprocessing', pass: true, ...first });
  const requiredRuntime = ['/picture-in-picture.js', '/vendor/tf.min.js', '/vendor/tf-backend-wasm.min.js', '/vendor/coco-ssd.min.js', '/vendor/model/model.json'];
  // Fetch completion does not imply event.waitUntil(cache.put) has settled.
  // Wait boundedly for required entries, then still verify fresh offline inference.
  try {
    await waitForBrowserCondition(page, async ({ cacheName, requiredRuntime }) => {
      const paths = (await (await caches.open(cacheName)).keys()).map(request => new URL(request.url).pathname);
      return requiredRuntime.every(path => paths.includes(path));
    }, { cacheName, requiredRuntime }, 15000);
  } catch (error) {
    console.error('Runtime cache diagnostic', JSON.stringify({ runtimeResponses,
      cached: await page.evaluate(async name => (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname), cacheName),
      controller: await page.evaluate(() => ({ script: navigator.serviceWorker.controller?.scriptURL, state: navigator.serviceWorker.controller?.state })) }));
    throw error;
  }
  const cached = await page.evaluate(async name => (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname), cacheName);
  for (const path of requiredRuntime) assert.ok(cached.includes(path), path);
  for (let index = 1; index <= 5; index++) assert.ok(cached.includes(`/vendor/model/group1-shard${index}of5`));
  assert.ok(cached.some(path => /^\/vendor\/tfjs-backend-wasm.*\.wasm$/.test(path)));
  assert.ok(!cached.some(path => /candidate|yolox/.test(path)));
  record({ check: 'all required baseline runtime/model shards and PiP are in current cache before offline reload', pass: true,
    cacheName, cachedPaths: cached });

  if (await page.locator('#firstRunDialog').evaluate(element => element.open)) {
    await page.locator('#setupNext').click(); await page.locator('#setupNext').click(); await page.locator('#setupFinish').click();
  }
  // Real adapter + real model, synthetic browser camera. Require a completed frame,
  // not merely the optimistic "Detection running" startup status.
  for (let run = 0; run < 2; run++) {
    await page.locator('#camera-start').click();
    await page.waitForFunction(() => /No supported objects in this frame\.|\d+%/.test(document.querySelector('#camera-objects').textContent), null, { timeout: 60000 });
    await page.locator('#camera-stop').click();
    assert.equal(await page.locator('#camera-video').evaluate(video => video.srcObject), null);
  }
  assert.equal(uploads.length, 0);
  assert.equal(depthRequests.length, 0);
  record({ check: 'real adapter synthetic-camera Start/Stop/restart completes frames without uploads or unsolicited depth', pass: true });

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const offline = await infer();
  assert.deepEqual(offline.detections, first.detections);
  const pip = await page.evaluate(() => import('/picture-in-picture.js').then(module => typeof module.mountPictureInPicture));
  assert.equal(pip, 'function');
  assert.deepEqual(errors, []);
  assert.equal(uploads.length, 0);
  record({ check: 'offline reload runs fresh baseline WASM inference and loads current PiP module, not unrelated stale cache', pass: true, ms: offline.ms });
  console.log(JSON.stringify({ appUrl: url, browser: await browser.version(), model: 'COCO-SSD lite_mobilenet_v2',
    fixtureSha256: createHash('sha256').update(bytes).digest('hex'), expectedLabel, observations }, null, 2));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
