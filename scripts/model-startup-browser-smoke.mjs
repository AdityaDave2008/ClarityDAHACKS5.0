// Production startup acceptance with real bundled WASM/COCO weights and an
// isolated synthetic camera. Never uses a personal browser profile or camera.
// PLAYWRIGHT_MODULE=/path/playwright/index.mjs MODEL_CHROME_PATH=/path/chrome \
//   node scripts/model-startup-browser-smoke.mjs
// Optional: SMOKE_BASE_URL=https://preview.example/ and SMOKE_SCREENSHOT_DIR=/path.
// Service workers are blocked so held/failed network requests are deterministic.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createPreviewServer } from '../frontend/server.js';

const timeout = 45000;
const target = process.env.SMOKE_BASE_URL ? new URL(process.env.SMOKE_BASE_URL) : null;
if (target) assert.ok(['http:', 'https:'].includes(target.protocol) && !target.username && !target.password,
  'SMOKE_BASE_URL must be an HTTP(S) URL without embedded credentials');
const screenshotDirectory = process.env.SMOKE_SCREENSHOT_DIR;
if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = target ? null : createPreviewServer({ apiOrigin: new URL('http://127.0.0.1:3001') });
let browser;
let releaseHeldRequest = () => {};

async function setup() {
  const context = await browser.newContext({ permissions: ['camera'], serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);
  page.setDefaultNavigationTimeout(timeout);
  await page.addInitScript(() => {
    localStorage.setItem('clarity-initial-setup-complete', 'true');
    window.cameraRequests = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (...args) => {
      window.cameraRequests.push({ at: performance.now(), status: document.querySelector('#camera-status').textContent });
      return original(...args);
    };
  });
  return { context, page };
}

async function screenshot(page, name) {
  if (screenshotDirectory) await page.screenshot({ path: resolve(screenshotDirectory, name), fullPage: true });
}

async function openScanner(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.myEyesCamera), null, { timeout });
  await page.locator('[data-screen="camera"]').click();
  assert.equal(await page.locator('#camera-start').isVisible(), true);
}

try {
  if (server) await new Promise((yes, no) => {
    server.once('error', no);
    server.listen(0, '127.0.0.1', yes);
  });
  const url = target?.href || `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ headless: true,
    ...(process.env.MODEL_CHROME_PATH ? { executablePath: process.env.MODEL_CHROME_PATH } : {}),
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  console.log(JSON.stringify({ target: url, browser: browser.version(), camera: 'isolated synthetic input', model: 'real bundled WASM/COCO' }));
  const { context, page } = await setup();
  let requested = false;
  const held = new Promise(yes => { releaseHeldRequest = yes; });
  await page.route('**/vendor/model/model.json', async route => {
    requested = true;
    await held;
    await route.continue();
  });
  await openScanner(page, url);
  await page.locator('#camera-start').click();
  await page.waitForFunction(() => document.querySelector('#camera-status').getAttribute('aria-busy') === 'true', null, { timeout });
  const deadline = Date.now() + timeout;
  while (!requested) {
    assert.ok(Date.now() < deadline, 'Production startup did not request the real model before the deadline');
    await delay(20);
  }
  assert.equal(await page.evaluate(() => cameraRequests.length), 0);
  assert.equal(await page.locator('#camera-stop').textContent(), 'Cancel');
  await screenshot(page, 'web-loading.png');
  await page.locator('#camera-stop').click();
  releaseHeldRequest();
  // Observe actual production readiness, never substitute a fake model or marker.
  await page.evaluate(() => {
    window.startupSmokeModelState = 'loading';
    void import('/local-detector.js').then(({ loadModel }) => loadModel()).then(model => {
      window.startupSmokeModelState = typeof model.detect === 'function' ? 'ready' : 'invalid';
    }).catch(error => { window.startupSmokeModelState = `error: ${error.message}`; });
  });
  await page.waitForFunction(() => window.startupSmokeModelState !== 'loading', null, { timeout });
  assert.equal(await page.evaluate(() => window.startupSmokeModelState), 'ready');
  assert.equal(await page.evaluate(() => cameraRequests.length), 0);
  assert.equal(await page.evaluate(() => document.querySelector('#camera-video').srcObject), null);
  console.log('PASS: real model request shows visible accessible loading before camera; Cancel blocks late activation');
  await page.locator('#camera-start').click();
  await page.waitForFunction(() => document.querySelector('#camera-status').textContent === 'Camera active.', null, { timeout });
  await page.waitForFunction(() => !/^Start scanning|^No fresh/.test(document.querySelector('#camera-objects').textContent), null, { timeout });
  assert.equal(await page.evaluate(() => cameraRequests.length), 1);
  console.log('PASS: restart reuses actual loaded model and produces fresh inference results');
  await page.locator('#camera-stop').click();
  await context.close();

  const failed = await setup();
  await failed.page.route('**/vendor/model/model.json', route => route.abort('failed'));
  await openScanner(failed.page, url);
  await failed.page.locator('#camera-start').click();
  await failed.page.waitForFunction(() => document.querySelector('#camera-start').textContent === 'Retry', null, { timeout });
  assert.equal(await failed.page.evaluate(() => cameraRequests.length), 0);
  assert.equal(await failed.page.locator('#camera-stop').textContent(), 'Cancel');
  assert.equal(await failed.page.locator('#camera-stop').isEnabled(), true);
  await screenshot(failed.page, 'web-error.png');
  await failed.page.unroute('**/vendor/model/model.json');
  await failed.page.locator('#camera-start').click();
  await failed.page.waitForFunction(() => document.querySelector('#camera-status').textContent === 'Camera active.', null, { timeout });
  assert.equal(await failed.page.evaluate(() => cameraRequests.length), 1);
  console.log('PASS: real model network failure keeps camera off with Retry/Cancel; explicit Retry loads actual model before camera');
  await failed.page.locator('#camera-stop').click();
  await failed.context.close();
} finally {
  releaseHeldRequest();
  try { await browser?.close(); }
  finally { if (server?.listening) await new Promise(yes => server.close(yes)); }
}
