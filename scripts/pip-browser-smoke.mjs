// Native PiP acceptance in isolated Chromium, with a synthetic camera (no device access).
// PLAYWRIGHT_MODULE=/absolute/path/playwright/index.mjs node scripts/pip-browser-smoke.mjs
// Set PIP_HEADLESS=1 for headless diagnostics, not visible native-window acceptance.
import assert from 'node:assert/strict';
import { createPreviewServer } from '../frontend/server.js';
const playwrightModule = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = playwrightModule;
async function realVisibility(page) {
  // Focus emulation belongs to the CDP session that enabled it. A separate
  // newCDPSession cannot clear Playwright's own setting. This test-only hook
  // fails loudly if Playwright internals change rather than faking visibility.
  const owner = playwrightModule.default?._toImpl?.(page)?._delegate?._mainFrameSession?._client;
  assert.ok(owner, 'This Playwright build must expose its owning CDP session for real visibility checks');
  await owner.send('Emulation.setFocusEmulationEnabled', { enabled: false });
}
const server = createPreviewServer({ apiOrigin: new URL('http://127.0.0.1:3001') });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
let browser;
const observations = [];
try {
  browser = await chromium.launch({ headless: process.env.PIP_HEADLESS === '1',
    ...(process.env.PIP_CHROME_PATH ? { executablePath: process.env.PIP_CHROME_PATH } : {}),
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const context = await browser.newContext({ permissions: ['camera'] });
  const page = await context.newPage();
  // Playwright forces every page to appear focused. Remove that emulation so
  // tab changes produce real visibilitychange events, not synthetic dispatches.
  await realVisibility(page);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.myEyesCamera));
  if (await page.locator('#firstRunDialog').evaluate(el => el.open)) {
    await page.locator('#setupNext').click();
    await page.locator('#setupNext').click();
    await page.locator('#setupFinish').click();
  }
  // Replace only inference with a deterministic adapter. Native media and PiP APIs are real.
  await page.evaluate(() => {
    window.pipEvidence = { starts: 0, aborts: 0, cameraRequests: 0 };
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (...args) => {
      window.pipEvidence.cameraRequests++;
      return getUserMedia(...args);
    };
    window.myEyesCamera.registerDetector({ async start({ signal }) {
      window.pipEvidence.starts++;
      signal.addEventListener('abort', () => window.pipEvidence.aborts++, { once: true });
    } });
  });
  await page.locator('#camera-start').click();
  await page.waitForFunction(() => !document.querySelector('#camera-pip').disabled);
  await page.locator('#camera-pip').click();
  await page.waitForFunction(() => document.pictureInPictureElement === document.querySelector('#camera-video'));
  assert.equal(await page.locator('#camera-pip').getAttribute('aria-pressed'), 'true');
  observations.push({ check: 'real native PiP entered from actual Camera UI and synthetic MediaStream', pass: true });
  console.log('JCODE_PROGRESS ' + JSON.stringify(observations.at(-1)));

  const other = await context.newPage();
  await realVisibility(other);
  await other.goto('about:blank');
  await other.bringToFront();
  try {
    await page.waitForFunction(() => document.hidden && /Detection paused/.test(document.querySelector('#detection-status').textContent), null, { polling: 100, timeout: 10000 });
  } catch (error) {
    console.error('PiP visibility diagnostic', await page.evaluate(() => ({ hidden: document.hidden,
      visibility: document.visibilityState, focused: document.hasFocus(), pip: Boolean(document.pictureInPictureElement),
      detection: document.querySelector('#detection-status').textContent, camera: document.querySelector('#camera-status').textContent,
      evidence: window.pipEvidence })));
    throw error;
  }
  const hidden = await page.evaluate(() => ({ ...window.pipEvidence,
    pip: document.pictureInPictureElement === document.querySelector('#camera-video'),
    track: document.querySelector('#camera-video').srcObject?.getVideoTracks()[0].readyState,
    overlay: document.querySelector('#camera-objects').textContent,
  }));
  assert.equal(hidden.pip, true);
  assert.equal(hidden.track, 'live');
  assert.deepEqual([hidden.starts, hidden.aborts, hidden.cameraRequests], [1, 1, 1]);
  const frameTime = await page.locator('#camera-video').evaluate(video => video.currentTime);
  await page.waitForFunction(previous => document.querySelector('#camera-video').currentTime > previous + 0.1,
    frameTime, { polling: 100, timeout: 5000 });
  hidden.framesAdvancedWhileHidden = true;
  observations.push({ check: 'tab switch retains native live preview while aborting inference', pass: true, ...hidden });
  await page.bringToFront();
  await page.waitForFunction(() => window.pipEvidence.starts === 2 && !document.hidden);
  assert.equal(await page.evaluate(() => window.pipEvidence.cameraRequests), 1);
  observations.push({ check: 'foreground resumes a fresh detector without a second camera request', pass: true });

  await other.bringToFront();
  await page.waitForFunction(() => window.pipEvidence.aborts === 2, null, { polling: 100 });
  await page.evaluate(() => document.exitPictureInPicture());
  await page.waitForFunction(() => document.querySelector('#camera-video').srcObject === null, null, { polling: 100 });
  observations.push({ check: 'closing native PiP while hidden releases camera', pass: true });
  await page.bringToFront();
  assert.equal(await page.locator('#camera-stop').isDisabled(), true);
  await page.locator('#camera-start').click();
  await page.waitForFunction(() => !document.querySelector('#camera-pip').disabled);
  await page.locator('#camera-pip').click();
  await page.waitForFunction(() => Boolean(document.pictureInPictureElement));
  await page.locator('#camera-stop').click();
  await page.waitForFunction(() => !document.pictureInPictureElement && !document.querySelector('#camera-video').srcObject);
  observations.push({ check: 'explicit Stop releases camera and owned PiP', pass: true });
  assert.deepEqual(errors, []);
  await context.close();

  const unsupported = await browser.newContext();
  await unsupported.addInitScript(() => {
    Object.defineProperty(HTMLVideoElement.prototype, 'requestPictureInPicture', { value: undefined });
    Object.defineProperty(HTMLVideoElement.prototype, 'webkitSupportsPresentationMode', { value: undefined });
  });
  const fallback = await unsupported.newPage();
  await fallback.goto(url, { waitUntil: 'domcontentloaded' });
  await fallback.waitForFunction(() => Boolean(window.myEyesCamera));
  assert.equal(await fallback.locator('#camera-pip').isDisabled(), true);
  assert.match(await fallback.locator('#camera-pip-status').textContent(), /not supported.*Keep this page open/i);
  observations.push({ check: 'unsupported API has disabled PiP and truthful inline fallback', pass: true });
  await unsupported.close();
  console.log(JSON.stringify({ browser: await browser.version(), headless: process.env.PIP_HEADLESS === '1', observations }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
