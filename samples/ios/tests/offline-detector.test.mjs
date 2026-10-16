import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { assessDetections, createAlertPolicy, ZONE } from '../../../backend/alerts.js';
const root = new URL('../StepSense/OfflineDetector/', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');

test('offline policy is generated verbatim from the existing server policy', () => {
  assert.ok(existsSync(new URL('policy.js', root)), 'Bundled policy is missing');
  assert.equal(read('policy.js'), readFileSync(new URL('../../../backend/alerts.js', import.meta.url), 'utf8').replace(/^export /gm, ''));
});
test('bundled policy preserves boxes, supported labels, confirmation, cooldown and reset', () => {
  const context = vm.createContext({});
  vm.runInContext(read('policy.js'), context);
  const predictions = [
    { class: 'backpack', score: .9, bbox: [140, 120, 100, 150] },
    { class: 'toothbrush', score: .99, bbox: [140, 120, 100, 150] },
    { class: 'chair', score: .3, bbox: [140, 120, 100, 150] },
    { class: 'person', score: .8, bbox: [-10, 10, 40, 90] },
  ];
  const local = context.assessDetections(predictions, 400, 300, .6);
  assert.deepEqual(JSON.parse(JSON.stringify(local)), assessDetections(predictions, 400, 300, .6));
  const localPolicy = context.createAlertPolicy();
  const serverPolicy = createAlertPolicy();
  for (const now of [1000, 1100, 1200, 4300, 4400]) {
    assert.deepEqual(JSON.parse(JSON.stringify(localPolicy.update(local, now))), serverPolicy.update(local, now));
  }
  localPolicy.breakStreak();
  assert.equal(localPolicy.update(local, 4500).reason, 'confirming');
  assert.equal(localPolicy.update(local, 4600).reason, 'cooldown');
  localPolicy.reset();
  assert.equal(localPolicy.update(local, 4700).reason, 'confirming');
  assert.equal(localPolicy.update(local, 4800).reason, 'triggered');
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(ZONE)', context)), ZONE);
});
test('all exact pretrained graph shards and runtime assets are bundled', () => {
  const manifest = JSON.parse(read('model/model.json'));
  assert.ok(manifest.modelTopology.node.length > 0);
  for (const group of manifest.weightsManifest) for (const path of group.paths) {
    assert.ok(readFileSync(new URL('model/' + path, root)).length > 0);
  }
  for (const name of ['tf.min.js', 'coco-ssd.min.js', 'tf-backend-wasm.min.js', 'tfjs-backend-wasm.wasm', 'tfjs-backend-wasm-simd.wasm']) assert.ok(existsSync(new URL(name, root)));
});
test('offline page has a restrictive content policy and no remote script URLs', () => {
  const html = read('index.html');
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /src=["']https?:/);
  assert.match(html, /connect-src 'self' stepsense:/);
});
