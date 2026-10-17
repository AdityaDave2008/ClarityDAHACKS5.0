// Run with PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs.
// Synthetic camera input exercises the real browser UI and inference runtime,
// not physical-camera accuracy. This never uses the user's browser profile.
import assert from 'node:assert/strict';

const modulePath = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(modulePath);
const url = process.env.DEPTH_APP_URL || 'http://127.0.0.1:8788/?detector=local';
const browser = await chromium.launch({ headless: true, args: [
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
] });
const observations = [];
try {
  const context = await browser.newContext({ permissions: ['camera'] });
  if (process.env.DEPTH_TEST_GEOMETRY === '1') {
    await context.addInitScript(() => {
      // Deterministic sensor fixture, not evidence of real-device pose accuracy.
      window.__depthFixtureBeta = 90;
      DeviceOrientationEvent.requestPermission = async () => 'granted';
      Object.defineProperty(screen.orientation, 'angle', { get: () => 0 });
      Object.defineProperty(screen.orientation, 'type', { get: () => 'portrait-primary' });
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        const stream = await original(constraints);
        for (const track of stream.getVideoTracks()) {
          const settings = track.getSettings.bind(track);
          track.getSettings = () => ({ ...settings(), facingMode: 'environment', zoom: 1 });
        }
        return stream;
      };
      setInterval(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', {
        alpha: 0, beta: window.__depthFixtureBeta, gamma: 0,
      })), 25);
    });
  }
  const page = await context.newPage();
  const errors = [];
  const modelRequests = [];
  const frameUploads = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/vendor-depth|depth-assets|huggingface\.co|depth-model-worker/.test(request.url())) modelRequests.push(request.url());
    if (request.method() === 'POST' && /\/frames(?:\?|$)|\/api\/v1\/sessions/.test(request.url())) frameUploads.push(request.url());
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.myEyesCamera));
  assert.match(await page.title(), /Clarity/);
  if (await page.locator('#firstRunDialog').evaluate(element => element.open)) {
    await page.locator('#setupNext').click();
    await page.locator('#setupNext').click();
    await page.locator('#setupFinish').click();
  }
  await page.locator('.depth-panel > summary').click();
  await page.locator('#depth-enable').waitFor();
  assert.equal(await page.locator('#depth-enable').isChecked(), false);
  assert.equal(await page.locator('#depth-model').isChecked(), false);
  assert.equal(modelRequests.length, 0, 'Depth runtime/model must not download without opt-in');
  observations.push({ requirement: 'current Clarity UI and opt-in depth', result: 'pass' });

  await page.locator('#camera-start').click();
  await page.waitForFunction(() => /Detection running|Detecting on this device/.test(document.querySelector('#detection-status').textContent), null, { timeout: 45000 });
  const video = await page.locator('#camera-video').evaluate(element => ({ width: element.videoWidth, height: element.videoHeight, readyState: element.readyState }));
  assert.ok(video.width > 0 && video.height > 0 && video.readyState >= 2);
  assert.equal(modelRequests.length, 0, 'Ordinary v1 scanning must not start depth model');
  observations.push({ requirement: 'real v1 model and synthetic camera startup without depth', result: 'pass', video });

  await page.locator('#depth-enable').check();
  const depthText = await page.locator('#depth-status').textContent();
  assert.ok(!/\d(?:\.\d+)?\s*(?:–|-)\s*\d(?:\.\d+)?\s*m\b/.test(depthText), 'Uncalibrated depth must not show metric range');
  assert.equal(modelRequests.length, 0, 'Enabling geometry must not opt into large model download');
  observations.push({ requirement: 'uncalibrated camera estimates fail closed', result: 'pass', text: depthText });

  if (process.env.DEPTH_TEST_GEOMETRY === '1') {
    await page.locator('#depth-motion').click();
    await page.waitForFunction(() => /Tilt down/.test(document.querySelector('#depth-motion-status').textContent), null, { timeout: 8000 }).catch(async error => {
      console.error(JSON.stringify({ errors, sensor: await page.evaluate(() => ({ beta: window.__depthFixtureBeta, angle: screen.orientation.angle, type: screen.orientation.type, motion: document.querySelector('#depth-motion-status').textContent, depth: document.querySelector('#depth-status').textContent, calibration: document.querySelector('#depth-calibration-status').textContent })) }));
      throw error;
    });
    for (const [id, value] of [['height','1.4'],['reference-height','1'],['reference-distance','2'],['tolerance','2']]) {
      await page.locator(`#depth-${id}`).fill(value);
    }
    await page.locator('#depth-freeze').click();
    await page.locator('#depth-reference-top').fill('20');
    await page.locator('#depth-reference-bottom').fill('80');
    await page.locator('#depth-reference-bottom').press('Tab');
    await page.locator('#depth-reference-declared').check();
    await page.locator('#depth-calibrate').click();
    await page.waitForFunction(() => /Projection calibrated/.test(document.querySelector('#depth-calibration-status').textContent));
    await page.evaluate(() => { window.__depthFixtureBeta = 70; });
    await page.locator('#depth-ground-contact').check();
    await page.waitForFunction(() => /\d.*–.*\d.* m/.test(document.querySelector('#depth-status').textContent));
    const calibratedText = await page.locator('#depth-status').textContent();
    assert.match(calibratedText, /estimated/i);
    observations.push({ requirement: 'measured-reference UI produces metric interval only with synthetic valid pose and declared contact', result: 'pass', fixture: 'synthetic sensor and rear-camera identity', text: calibratedText });
    await page.locator('#depth-height').fill('1.5');
    await page.waitForFunction(() => /unavailable/i.test(document.querySelector('#depth-status').textContent));
    assert.equal(await page.locator('#depth-ground-contact').isChecked(), false);
    observations.push({ requirement: 'measurement changes invalidate prior depth and contact declaration', result: 'pass' });
  }

  if (process.env.DEPTH_TEST_MODEL === '1') {
    await page.locator('#depth-model').check();
    await page.waitForFunction(() => /model ready|Optional model unavailable/i.test(document.querySelector('#depth-model-status').textContent), null, { timeout: 150000 });
    assert.match(await page.locator('#depth-model-status').textContent(), /model ready/i, 'Real model must initialize, not fall back to unavailable');
    await page.locator('#depth-analyze').click();
    await page.locator('#depth-map').waitFor({ state: 'visible', timeout: 25000 });
    const caption = await page.locator('#depth-snapshot-caption').textContent();
    assert.match(caption, /historical snapshot/i);
    assert.match(caption, /not live/i);
    const map = await page.locator('#depth-map').evaluate(canvas => ({ width: canvas.width, height: canvas.height }));
    assert.ok(map.width > 0 && map.height > 0);
    assert.ok(modelRequests.length > 0, 'Explicit model opt-in must load the real runtime');
    assert.match(await page.locator('#detection-status').textContent(), /Detection running|Detecting on this device/);
    observations.push({ requirement: 'real optional model produces labeled paired snapshot without stopping v1', result: 'pass', caption, map });
    await page.locator('#depth-model').uncheck();
    await page.locator('#depth-map').waitFor({ state: 'hidden' });
  }

  await page.locator('#depth-enable').uncheck();
  await page.locator('#camera-stop').click();
  await page.waitForFunction(() => document.querySelector('#camera-video').srcObject === null);
  await page.locator('#camera-start').click();
  await page.waitForFunction(() => /Detection running|Detecting on this device/.test(document.querySelector('#detection-status').textContent), null, { timeout: 15000 });
  await page.locator('#camera-stop').click();
  assert.deepEqual(frameUploads, [], 'Camera frames must not be uploaded');
  assert.deepEqual(errors, [], 'Application must initialize and scan without uncaught page errors');
  observations.push({ requirement: 'stop/restart, no frame uploads and no page errors', result: 'pass' });
  console.log(JSON.stringify({ url, observations, physicalAccuracy: 'not tested; synthetic camera' }, null, 2));
} finally {
  await browser.close();
}
