import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDetections, createAlertPolicy } from '../alerts.js';

function observed(label = 'backpack', bbox = [140, 120, 100, 150], score = 0.9) {
  return assessDetections([{ class: label, score, bbox }], 400, 300, 0.6);
}

test('assesses supported detections using normalized geometry and a bottom-center anchor', () => {
  const detections = assessDetections([
    { class: 'backpack', score: 0.9, bbox: [140, 120, 100, 150] },
    { class: 'chair', score: 0.8, bbox: [0, 0, 40, 60] },
    { class: 'backpack', score: 0.3, bbox: [140, 120, 100, 150] },
    { class: 'toothbrush', score: 0.99, bbox: [140, 120, 100, 150] },
  ], 400, 300, 0.6);

  assert.equal(detections.length, 2);
  const backpack = detections.find(({ label }) => label === 'backpack');
  assert.deepEqual(backpack.bbox, { x: 0.35, y: 0.4, width: 0.25, height: 0.5 });
  assert.ok(Math.abs(backpack.anchor.x - 0.475) < 1e-10);
  assert.ok(Math.abs(backpack.anchor.y - 0.9) < 1e-10);
  assert.equal(backpack.inZone, true);
  assert.equal(detections.find(({ label }) => label === 'chair').inZone, false);
});

test('an object touching the bottom image edge can still be in the alert zone', () => {
  assert.equal(observed('backpack', [160, 240, 80, 60])[0].inZone, true);
  assert.equal(observed('backpack', [340, 240, 80, 60])[0].inZone, true);
});

test('requires two nearby observations before triggering and enforces cooldown', () => {
  const policy = createAlertPolicy({ cooldownMs: 3000, maxGapMs: 2500, confirmations: 2 });
  assert.equal(policy.update(observed(), 1000).reason, 'confirming');
  const triggered = policy.update(observed('backpack', [144, 122, 100, 150]), 1100);
  assert.equal(triggered.triggered, true);
  assert.equal(triggered.reason, 'triggered');

  const suppressed = policy.update(observed(), 1200);
  assert.equal(suppressed.triggered, false);
  assert.equal(suppressed.reason, 'cooldown');
  assert.equal(suppressed.cooldownRemainingMs, 2900);
  policy.update(observed(), 2500);
  assert.equal(policy.update(observed(), 4100).triggered, true);
});

test('a clear frame or an excessive time gap breaks confirmation', () => {
  const policy = createAlertPolicy({ cooldownMs: 3000, maxGapMs: 2500, confirmations: 2 });
  policy.update(observed(), 1000);
  assert.equal(policy.update([], 1100).reason, 'no_candidate');
  assert.equal(policy.update(observed(), 1200).reason, 'confirming');
  assert.equal(policy.update(observed(), 4000).reason, 'confirming');
  assert.equal(policy.update(observed(), 4100).triggered, true);
});

test('different labels and distant objects do not confirm one another', () => {
  const policy = createAlertPolicy({ cooldownMs: 3000, maxGapMs: 2500, confirmations: 2 });
  policy.update(observed(), 1000);
  assert.equal(policy.update(observed('chair'), 1100).reason, 'confirming');
  assert.equal(policy.update(observed('chair', [280, 180, 60, 90]), 1200).reason, 'confirming');
  assert.equal(policy.update(observed('chair', [282, 180, 60, 90]), 1300).triggered, true);
});

test('outside-zone detections do not build a confirmation streak', () => {
  const policy = createAlertPolicy({ cooldownMs: 3000, maxGapMs: 2500, confirmations: 2 });
  assert.equal(policy.update(observed('chair', [0, 0, 40, 60]), 1000).reason, 'no_candidate');
  assert.equal(policy.update(observed('chair', [0, 0, 40, 60]), 1100).triggered, false);
  assert.equal(policy.update(observed(), 1200).reason, 'confirming');
});

test('breaking a streak retains cooldown; a complete reset clears alert history', () => {
  const policy = createAlertPolicy({ cooldownMs: 3000, maxGapMs: 2500, confirmations: 2 });
  policy.update(observed(), 1000);
  assert.equal(policy.update(observed(), 1100).triggered, true);
  policy.breakStreak();
  assert.equal(policy.update(observed(), 1200).reason, 'confirming');
  assert.equal(policy.update(observed(), 1300).reason, 'cooldown');
  policy.reset();
  assert.equal(policy.update(observed(), 1400).reason, 'confirming');
  assert.equal(policy.update(observed(), 1500).triggered, true);
});

test('separate policies do not share confirmation or cooldown state', () => {
  const first = createAlertPolicy({ cooldownMs: 3000, maxGapMs: 2500, confirmations: 2 });
  const second = createAlertPolicy({ cooldownMs: 3000, maxGapMs: 2500, confirmations: 2 });
  first.update(observed(), 1000);
  assert.equal(first.update(observed(), 1100).triggered, true);
  assert.equal(second.update(observed(), 1200).reason, 'confirming');
  assert.equal(second.update(observed(), 1300).triggered, true);
});
