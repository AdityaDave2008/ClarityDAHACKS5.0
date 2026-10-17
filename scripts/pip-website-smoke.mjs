// Integrated website check. Camera input and hidden state are synthetic; this
// exercises application logic, not iPhone background scheduling or audible speech.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPreviewServer } from '../frontend/server.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = createPreviewServer({ apiOrigin: new URL('http://127.0.0.1:3001') });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const evidence = { physicalIPhone: 'Not tested by this runner', hiddenState: 'Synthetic visibility fixture', observations: [] };
const folder = new URL('../.cache/pip-experiment/', import.meta.url);
await mkdir(folder, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PIP_BROWSER_PATH || undefined,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    ignoreDefaultArgs: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] });
  evidence.browser = browser.version();
  const context = await browser.newContext({ permissions: ['camera'], viewport: { width: 1100, height: 850 } });
  const page = await context.newPage();
  const errors = [], uploads = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST') uploads.push(request.url()); });
  await page.addInitScript(() => localStorage.setItem('clarity-initial-setup-complete', 'true'));
  await page.goto(origin);
  await page.waitForFunction(() => !!window.myEyesCamera);
  await page.locator('#camera-start').click();
  const freshMainResult = () => page.waitForFunction(() => {
    const value = document.querySelector('#camera-objects').textContent;
    return !/Start scanning|No fresh/.test(value);
  }, null, { timeout: 45000 });
  await freshMainResult();
  assert.equal(await page.locator('#camera-pip').isEnabled(), true);
  await page.screenshot({ path: fileURLToPath(new URL('website-camera.png', folder)), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: fileURLToPath(new URL('website-mobile.png', folder)), fullPage: true });
  assert.equal(await page.locator('#camera-pip').isVisible(), true);
  await page.locator('#camera-pip').click();
  await page.waitForFunction(() => document.pictureInPictureElement === document.querySelector('#camera-video'));
  await page.locator('#camera-video').evaluate(video => video.pause());
  await page.waitForFunction(() => document.querySelector('#camera-pip-status').textContent.includes('playback is paused'));
  assert.equal(await page.locator('#camera-pip-resume').isVisible(), true);
  await page.locator('#camera-pip-resume').click();
  await page.waitForFunction(() => !document.querySelector('#camera-video').paused);
  await page.locator('#camera-pip-resume').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#camera-pip-resume').isVisible(), false);
  evidence.observations.push({ requirement: 'paused floating camera reports playback state and resumes on an explicit tap', result: 'pass' });
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  // Longer than result expiry: the app must keep accepting actual model outputs.
  await page.waitForTimeout(3100);
  assert.equal(await page.locator('#camera-video').evaluate(video => !!video.srcObject), true);
  await freshMainResult();
  evidence.observations.push({ requirement: 'main local model, real browser PiP, results retained during synthetic hidden state', result: 'pass' });
  await page.evaluate(() => document.exitPictureInPicture());
  await page.waitForFunction(() => document.querySelector('#camera-video').srcObject === null);
  evidence.observations.push({ requirement: 'closing PiP while hidden releases camera', result: 'pass' });
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.locator('#camera-video').evaluate(video => video.srcObject), null);
  await page.locator('#camera-start').click(); await freshMainResult();
  await page.evaluate(() => {
    document.querySelector('#camera-video').requestPictureInPicture = () => Promise.resolve();
  });
  await page.locator('#camera-pip').click();
  await page.waitForFunction(() => document.querySelector('#camera-pip-status').textContent.includes('did not open'));
  assert.equal(await page.locator('#camera-video').evaluate(video => !!video.srcObject), true);
  evidence.observations.push({ requirement: 'silent unsupported PiP reports failure and preserves foreground scan', result: 'pass' });
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => document.querySelector('#camera-video').srcObject === null);
  assert.deepEqual(uploads, [], 'Main local detector never uploads camera frames');
  evidence.observations.push({ requirement: 'without PiP hidden scanning stops; foreground return never auto-restarts; no image uploads', result: 'pass' });

  const retained = await context.newPage();
  retained.on('pageerror', error => errors.push(error.message));
  let frames = 0;
  await retained.route('**/ready', route => route.fulfill({ json: { ready: true } }));
  await retained.route('**/api/v1/model', route => route.fulfill({ json: { zone: [{x:.38,y:.42},{x:.62,y:.42},{x:.95,y:1},{x:.05,y:1}] } }));
  await retained.route('**/api/v1/sessions', route => route.fulfill({ json: { sessionId: 'browser-fixture' } }));
  await retained.route('**/api/v1/sessions/browser-fixture/frames', route => {
    frames++;
    return route.fulfill({ json: { frame: { sequence: Number(route.request().headers()['x-frame-sequence']), width:640, height:480 },
      detections: [{ label:'chair', confidence:.9, inZone:true, bbox:{x:.3,y:.3,width:.4,height:.5} }],
      alert: { triggered: false, reason:'no_candidate', modalities:[], message:null }, processingMs:10 } });
  });
  await retained.route('**/api/v1/sessions/browser-fixture', route => route.fulfill({ status:204 }));
  await retained.goto(`${origin}/camera.html`);
  assert.equal(await retained.locator('#pip-button').isEnabled(), false);
  await retained.locator('#live-tab').click(); await retained.locator('#start-button').click();
  await retained.waitForFunction(() => !document.querySelector('#pip-button').disabled);
  await retained.locator('#pip-button').click();
  await retained.waitForFunction(() => !!document.pictureInPictureElement);
  const before = frames;
  await retained.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  for (let i=0; i<30 && frames < before+3; i++) await retained.waitForTimeout(100);
  assert.ok(frames >= before+3, 'Retained backend loop must continue only with active PiP');
  await retained.evaluate(() => document.exitPictureInPicture());
  await retained.waitForFunction(() => document.querySelector('#camera').srcObject === null);
  evidence.observations.push({ requirement: 'retained camera page PiP lifecycle with synthetic backend responses', result:'pass' });
  assert.deepEqual(errors, []);

  // Exercise the shipped main-page wiring with controlled detector callbacks.
  // OS notifications/vibration are recorded fixtures, never real hardware output.
  const alertsPage = await context.newPage();
  alertsPage.on('pageerror', error => errors.push(error.message));
  await alertsPage.addInitScript(() => {
    window.alertEvidence = { notices: [], vibrations: [], permissions: 0 };
    class NotificationFixture {
      static permission = 'default';
      static async requestPermission() { window.alertEvidence.permissions++; this.permission = 'granted'; return 'granted'; }
    }
    Object.defineProperty(window, 'Notification', { configurable: true, value: NotificationFixture });
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: pattern => { window.alertEvidence.vibrations.push(pattern); return true; } });
    const registration = { async showNotification(title, options) { window.alertEvidence.notices.push({ title, options }); } };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
      register: async () => registration, getRegistration: async () => registration,
    } });
  });
  await alertsPage.goto(origin);
  await alertsPage.waitForFunction(() => !!window.myEyesCamera);
  await alertsPage.evaluate(() => {
    window.myEyesCamera.registerDetector({ async start(context) { window.alertDetector = context; } });
    document.querySelector('#alert').value = 'both';
    document.querySelector('#vibrate').checked = true;
  });
  await alertsPage.locator('#camera-notifications').click();
  await alertsPage.locator('#camera-start').click();
  await alertsPage.waitForFunction(() => !!window.alertDetector);
  await alertsPage.evaluate(() => window.alertDetector.onObstacle());
  await alertsPage.waitForFunction(() => window.alertEvidence.notices.length === 1);
  let alertEvidence = await alertsPage.evaluate(() => window.alertEvidence);
  assert.equal(alertEvidence.permissions, 1);
  assert.deepEqual(alertEvidence.notices[0].options.vibrate, [167, 98, 167]);
  assert.deepEqual(alertEvidence.vibrations.filter(value => value !== 0), []);
  await alertsPage.evaluate(() => {
    const input = document.querySelector('#vibrate'); input.checked = false; input.dispatchEvent(new Event('change'));
  });
  await alertsPage.waitForTimeout(3050);
  await alertsPage.evaluate(() => window.alertDetector.onObstacle());
  await alertsPage.waitForFunction(() => window.alertEvidence.notices.length === 2);
  alertEvidence = await alertsPage.evaluate(() => window.alertEvidence);
  assert.equal(alertEvidence.notices[1].options.silent, true);
  assert.equal('vibrate' in alertEvidence.notices[1].options, false);
  await alertsPage.evaluate(() => {
    const input = document.querySelector('#notifications'); input.checked = false; input.dispatchEvent(new Event('change'));
  });
  await alertsPage.waitForTimeout(3050);
  await alertsPage.evaluate(() => window.alertDetector.onObstacle());
  await alertsPage.waitForTimeout(100);
  assert.equal(await alertsPage.evaluate(() => window.alertEvidence.notices.length), 2);
  await alertsPage.locator('#camera-stop').click();
  evidence.observations.push({ requirement: 'main confirmed alert, one explicit permission prompt, notification/vibration preferences and Stop cancellation with recorded OS APIs', result: 'pass' });

  const unsupported = await context.newPage();
  unsupported.on('pageerror', error => errors.push(error.message));
  await unsupported.addInitScript(() => {
    Object.defineProperty(window, 'Notification', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: undefined });
  });
  await unsupported.goto(origin);
  await unsupported.waitForFunction(() => !!window.myEyesCamera);
  assert.equal(await unsupported.locator('#camera-notifications').isDisabled(), true);
  assert.equal(await unsupported.locator('#vibrate').isDisabled(), true);
  assert.match(await unsupported.locator('#camera-alert-output-status').textContent(), /unavailable/);
  await unsupported.evaluate(() => window.myEyesCamera.registerDetector({ async start(context) { window.alertDetector = context; } }));
  await unsupported.locator('#camera-start').click();
  await unsupported.waitForFunction(() => !!window.alertDetector);
  await unsupported.evaluate(() => window.alertDetector.onObstacle());
  assert.equal(await unsupported.locator('#camera-alert-banner').isVisible(), true);
  await unsupported.locator('#camera-stop').click();
  assert.equal(await unsupported.locator('#camera-alert-banner').isVisible(), false);
  evidence.observations.push({ requirement: 'unsupported notification/vibration APIs disable unavailable actions and preserve visible confirmed object alerts', result: 'pass' });
  assert.deepEqual(errors, []);
} catch (error) { evidence.error = error.stack; process.exitCode = 1; }
finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await writeFile(new URL('website-report.json', folder), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
