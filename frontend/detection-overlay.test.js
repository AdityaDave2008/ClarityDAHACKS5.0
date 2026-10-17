import test from 'node:test';
import assert from 'node:assert/strict';
import * as logic from './logic.js';
import { readFile } from 'node:fs/promises';

test('overlay maps normalized boxes into centered contained video, not letterbox', () => {
  assert.equal(typeof logic.detectionRect, 'function');
  const fit = logic.containRect(400, 200, 640, 480);
  const rect = logic.detectionRect(fit, { x: .25, y: .2, width: .5, height: .4 });
  assert.ok(Math.abs(rect.x - 133.3333) < .001);
  assert.equal(rect.y, 40);
  assert.ok(Math.abs(rect.width - 133.3333) < .001);
  assert.equal(rect.height, 80);
  const portrait = logic.containRect(200, 400, 640, 480);
  assert.deepEqual(logic.detectionRect(portrait, { x: 0, y: 0, width: 1, height: 1 }), portrait);
});

test('renderer clears old boxes, scales to DPR, and draws readable labels', () => {
  assert.equal(typeof logic.drawDetectionOverlay, 'function');
  const calls = [];
  const context = new Proxy({ measureText: text => ({ width: text.length * 7 }) }, {
    get: (target, name) => target[name] || ((...args) => calls.push([name, ...args])),
  });
  const canvas = { getBoundingClientRect: () => ({ width: 400, height: 200 }), getContext: () => context };
  const video = { videoWidth: 640, videoHeight: 480 };
  const detections = [{ label: 'person', confidence: .91, bbox: { x: .25, y: .2, width: .5, height: .4 } }];
  logic.drawDetectionOverlay(canvas, video, detections, 2);
  assert.equal(canvas.width, 800);
  assert.equal(canvas.height, 400);
  assert.ok(calls.some(call => call[0] === 'fillText' && call[1] === 'person 91%'));
  calls.length = 0;
  logic.drawDetectionOverlay(canvas, video, [], 1);
  assert.ok(calls.some(call => call[0] === 'clearRect'));
  assert.equal(calls.some(call => call[0] === 'strokeRect'), false);
});

test('actual index exposes a decorative overlay and readable results without invented distance', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(html, /<canvas[^>]*id="camera-overlay"[^>]*aria-hidden="true"/);
  assert.match(html, /id="camera-objects"/);
  assert.match(html, /Browser camera does not measure distance/);
  assert.match(html, /src="standalone.js"/);
});

test('source resolution changes clear boxes instead of projecting an old frame onto a new aspect ratio', () => {
  const calls = [];
  const context = new Proxy({}, { get: (_target, name) => (...args) => calls.push([name, ...args]) });
  const canvas = { getBoundingClientRect: () => ({ width: 200, height: 400 }), getContext: () => context };
  logic.drawDetectionOverlay(canvas, { videoWidth: 480, videoHeight: 640 },
    [{ label: 'person', confidence: .9, bbox: { x: .1, y: .1, width: .3, height: .3 } }], 1,
    { sourceWidth: 640, sourceHeight: 480 });
  assert.ok(calls.some(call => call[0] === 'clearRect'));
  assert.equal(calls.some(call => call[0] === 'strokeRect'), false);
});

test('preview contain rule outranks the canonical two-ID legacy cover rule', async () => {
  const css = await readFile(new URL('./homePage.css', import.meta.url), 'utf8');
  // The real Chrome regression was two IDs (cover) beating one ID (contain).
  // Two IDs plus the preview class wins regardless of source order.
  assert.match(css, /#camera\s+\.camera-preview\s+#camera-video\s*\{[^}]*object-fit:\s*contain;[^}]*object-position:\s*center;[^}]*transform:\s*none;/);
});
