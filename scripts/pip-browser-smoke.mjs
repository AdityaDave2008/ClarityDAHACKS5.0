// Isolated browser test with synthetic camera input, not an iPhone acceptance test.
// PLAYWRIGHT_MODULE points to playwright or playwright-core/index.mjs.
// PIP_BROWSER_PATH can select an installed Chrome/Chromium executable.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPreviewServer } from '../frontend/server.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = createPreviewServer({ apiOrigin: new URL('http://127.0.0.1:3001') });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const evidence = { input: process.env.PIP_CAMERA_FIXTURE ? 'synthetic video fixture' : 'synthetic Chromium camera',
  physicalIPhone: 'Not tested', audibleSpeech: 'Not tested', observations: [] };
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PIP_BROWSER_PATH || undefined,
    // Do not use browser flags that exempt hidden pages from background policies.
    ignoreDefaultArgs: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      ...(process.env.PIP_CAMERA_FIXTURE ? [`--use-file-for-fake-video-capture=${process.env.PIP_CAMERA_FIXTURE}`] : [])] });
  evidence.browser = browser.version();
  const context = await browser.newContext({ permissions: ['camera'] });
  const page = await context.newPage();
  const errors = [], uploads = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST') uploads.push(request.url()); });
  // Disable DevTools focus emulation, so actual tab visibility can be observed.
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await page.goto(`${origin}/pip-test.html`);
  const readReport = () => page.locator('#report').evaluate(node => JSON.parse(node.textContent));
  await page.locator('#start').click();
  await page.waitForFunction(() => {
    try { return JSON.parse(document.querySelector('#report').textContent).counts.results >= 3; } catch { return false; }
  }, null, { timeout: 60000 });
  evidence.observations.push({ requirement: 'real bundled detector on synthetic camera', report: await readReport() });

  const other = await context.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  const hidden = await page.evaluate(() => document.hidden);
  evidence.observations.push({ requirement: 'background without PiP', documentHidden: hidden,
    outcome: hidden ? 'Hidden state observed' : 'Unverified: headless tabs remained visible',
    cameraReleased: await page.locator('#video').evaluate(video => video.srcObject === null), report: await readReport() });
  if (hidden) assert.equal(await page.locator('#video').evaluate(video => video.srcObject), null);
  await page.bringToFront();
  if (hidden) {
    await page.locator('#start').click();
    await page.waitForFunction(() => {
      try { return JSON.parse(document.querySelector('#report').textContent).counts.results >= 3; } catch { return false; }
    });
  }
  await page.locator('#pip').click();
  await page.waitForFunction(() => {
    try { return JSON.parse(document.querySelector('#report').textContent).events.some(event => ['pip-request', 'pip-error'].includes(event.type)); }
    catch { return false; }
  });
  const active = await page.evaluate(() => document.pictureInPictureElement === document.querySelector('#video'));
  if (active) {
    await other.bringToFront();
    const hiddenWithPiP = await page.evaluate(() => document.hidden);
    if (hiddenWithPiP) {
      await page.waitForFunction(() => {
        try { return JSON.parse(document.querySelector('#report').textContent).counts.hiddenResults >= 5; } catch { return false; }
      }, null, { timeout: 20000 }).catch(() => {});
    }
    evidence.observations.push({ requirement: 'PiP and background inference', pipActive: active,
      outcome: hiddenWithPiP ? 'Inspect hidden result counters' : 'Unverified: headless tabs remained visible',
      documentHidden: hiddenWithPiP, report: await readReport() });
    await page.bringToFront();
  } else {
    evidence.observations.push({ requirement: 'PiP request', pipActive: false,
      outcome: 'PiP did not open in this browser run; no background PiP conclusion.', report: await readReport() });
  }
  await page.locator('#stop').click();
  assert.equal(await page.locator('#video').evaluate(video => video.srcObject), null);
  assert.deepEqual(uploads, [], 'No camera images should be uploaded');
  assert.deepEqual(errors, [], 'No unhandled page errors');
  evidence.observations.push({ requirement: 'Stop releases camera; no uploads or page errors', result: 'pass' });
  await mkdir(new URL('../.cache/pip-experiment/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('../.cache/pip-experiment/page.png', import.meta.url)), fullPage: true });
  // Regression fixture only: reproduce a resolved PiP call with no mode change.
  // This checks the diagnostic; it is not an emulation of iPhone capabilities.
  await page.waitForFunction(() => document.pictureInPictureElement === null);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    document.querySelector('#video').requestPictureInPicture = () => Promise.resolve();
  });
  await page.locator('#start').click();
  await page.waitForFunction(() => !document.querySelector('#pip').disabled);
  await page.locator('#pip').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('PiP did not open in this Home Screen app'),
    null, { timeout: 7000 });
  const blocked = await readReport();
  assert.equal(blocked.launchMode, 'home-screen');
  assert.ok(blocked.events.some(event => event.type === 'pip-not-open'));
  evidence.observations.push({ requirement: 'resolved API without PiP does not claim success (simulated standalone fixture)', result: 'pass' });
  await page.locator('#stop').click();
  assert.deepEqual(errors, []);
} catch (error) {
  evidence.error = error.message;
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await mkdir(new URL('../.cache/pip-experiment/', import.meta.url), { recursive: true });
  await writeFile(new URL('../.cache/pip-experiment/browser-report.json', import.meta.url), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ browser: evidence.browser, input: evidence.input,
    observations: evidence.observations.map(({ requirement, result, outcome, documentHidden, pipActive, cameraReleased, report }) => ({
      requirement, result, outcome, documentHidden, pipActive, cameraReleased, counts: report?.counts,
      lastEvents: report?.events.slice(-3),
    })), error: evidence.error, physicalIPhone: evidence.physicalIPhone, audibleSpeech: evidence.audibleSpeech }, null, 2));
}
