// Sustained real-model camera lifecycle check using an isolated synthetic camera.
// No physical camera, personal profile, deployment, or paid inference is used.
// PLAYWRIGHT_MODULE=/absolute/path/playwright/index.mjs node scripts/camera-soak.mjs
// SOAK_SECONDS defaults to 900. SOAK_MANIFEST optionally stops on overnight cancellation.
// SOAK_FAULT_AFTER=N is a harness-only negative probe: deliberately fail call N.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { createPreviewServer } from '../frontend/server.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const seconds = Number(process.env.SOAK_SECONDS || 900);
const faultAfter = Number(process.env.SOAK_FAULT_AFTER || 0);
assert.ok(Number.isInteger(faultAfter) && (faultAfter === 0 || faultAfter >= 2), 'SOAK_FAULT_AFTER is 0 or an inference call >=2');
assert.ok(Number.isFinite(seconds) && seconds >= 30 && seconds <= 1800, 'SOAK_SECONDS must be 30–1800');
function checkCancellation() {
  if (!process.env.SOAK_MANIFEST) return;
  const manifest = JSON.parse(readFileSync(process.env.SOAK_MANIFEST, 'utf8'));
  assert.ok(!manifest.cancel_requested && !manifest.cancellation_requested && manifest.status === 'running', 'Overnight run cancelled or no longer active');
  assert.ok(Date.now() < Date.parse(manifest.post_wake_grace_until), 'Overnight grace window ended');
}
checkCancellation();
const server = createPreviewServer({ apiOrigin: new URL('http://127.0.0.1:3001') });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const observations = [];
try {
  browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const context = await browser.newContext({ permissions: ['camera'], serviceWorkers: 'block', reducedMotion: 'reduce' });
  const uploads = [], external = [], errors = [];
  await context.route('**/*', route => {
    const request = route.request();
    if (request.method() !== 'GET' && request.method() !== 'HEAD') { uploads.push(request.url()); return route.abort(); }
    if (new URL(request.url()).origin !== origin) { external.push(request.url()); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.myEyesCamera));
  if (await page.locator('#firstRunDialog').evaluate(el => el.open)) {
    await page.locator('#setupNext').click();
    await page.locator('#setupNext').click();
    await page.locator('#setupFinish').click();
  }
  // Observe the actual cached model and camera APIs without replacing inference/media.
  await page.evaluate(async faultAfter => {
    const { loadModel } = await import('/local-detector.js');
    const model = await loadModel();
    const original = model.detect.bind(model);
    const evidence = window.soakEvidence = { calls: 0, completed: 0, failed: 0, active: 0, maxActive: 0, cameraRequests: 0, tracks: [] };
    model.detect = async (...args) => {
      evidence.calls++; evidence.active++; evidence.maxActive = Math.max(evidence.maxActive, evidence.active);
      try {
        if (faultAfter && evidence.calls === faultAfter) throw new Error('Injected soak verification failure');
        const result = await original(...args); evidence.completed++; return result;
      } catch (error) { evidence.failed++; throw error; }
      finally { evidence.active--; }
    };
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await capture(...args); evidence.cameraRequests++; evidence.tracks.push(...stream.getTracks()); return stream;
    };
  }, faultAfter);
  const started = Date.now();
  const until = started + seconds * 1000;
  let cycle = 0;
  while (Date.now() < until) {
    checkCancellation(); cycle++;
    await page.locator('[data-screen="camera"]').click();
    await page.locator('#camera-start').click();
    await page.waitForFunction(() => /Detection running|Object confirmed|Object seen|Object remains/.test(document.querySelector('#detection-status').textContent), null, { timeout: 30000 });
    const before = await page.evaluate(() => ({ completed: window.soakEvidence.completed, time: document.querySelector('#camera-video').currentTime }));
    const dwellUntil = Math.max(Date.now() + 1000, Math.min(until, Date.now() + 25000));
    while (Date.now() < dwellUntil) { checkCancellation(); await delay(Math.min(1000, dwellUntil - Date.now())); }
    const active = await page.evaluate(() => ({ completed: window.soakEvidence.completed, failed: window.soakEvidence.failed,
      time: document.querySelector('#camera-video').currentTime, status: document.querySelector('#detection-status').textContent,
      heapBytes: performance.memory?.usedJSHeapSize ?? null }));
    assert.equal(active.failed, 0, 'Model inference must not reject during the soak');
    assert.ok(active.completed > before.completed, 'Real inference must keep completing successfully');
    assert.match(active.status, /Detection running|Object confirmed|Object seen|Object remains/, 'Fresh detection must remain healthy');
    assert.ok(active.time > before.time, 'Synthetic preview frames must keep advancing');
    if (cycle % 2) await page.locator('[data-screen="home"]').click();
    else await page.locator('#camera-stop').click();
    await page.waitForFunction(() => !document.querySelector('#camera-video').srcObject && window.soakEvidence.active === 0);
    const stoppedCalls = await page.evaluate(() => window.soakEvidence.calls);
    await delay(Math.min(1000, Math.max(100, until - Date.now())));
    const stopped = await page.evaluate(() => ({ calls: window.soakEvidence.calls, failed: window.soakEvidence.failed,
      maxActive: window.soakEvidence.maxActive, liveTracks: window.soakEvidence.tracks.filter(track => track.readyState === 'live').length,
      status: document.querySelector('#detection-status').textContent, objects: document.querySelector('#camera-objects').textContent }));
    assert.equal(stopped.calls, stoppedCalls, 'Stopped scan must not schedule further inference');
    assert.equal(stopped.failed, 0, 'Inference rejected before the stopped scan drained');
    assert.equal(stopped.maxActive, 1, 'Only one model inference may run at once');
    assert.equal(stopped.liveTracks, 0, 'Stop/navigation must release every captured track');
    assert.match(stopped.status, /Detection stopped/);
    assert.deepEqual(errors, []); assert.deepEqual(uploads, []);
    observations.push({ cycle, elapsedSeconds: Math.round((Date.now() - started) / 1000), ...active, stopped });
    console.log('JCODE_PROGRESS ' + JSON.stringify({ message: 'Synthetic real-model camera soak', current: Math.min(seconds, (Date.now() - started) / 1000), total: seconds, unit: 'seconds', cycle, inferences: active.completed }));
  }
  console.log(JSON.stringify({ browser: await browser.version(), requestedSeconds: seconds, faultAfter, elapsedSeconds: (Date.now() - started) / 1000,
    limitations: 'Synthetic headless camera, not physical phone, PiP, thermal, battery, field accuracy, or proof of no memory leak. Heap is an observational proxy only.',
    errors, uploads, blockedExternalRequests: external, observations }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
