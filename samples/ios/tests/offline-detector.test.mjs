import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { assessDetections, createAlertPolicy, ZONE } from '../../../backend/alerts.js';
const root = new URL('../MyEyes/OfflineDetector/', import.meta.url);
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
test('only ONNX runtime and actual candidate are loaded by the page', () => {
  const html = read('index.html');
  assert.match(html, /ort.wasm.min.js/);
  assert.match(html, /yolox.js/);
  assert.doesNotMatch(html, /tf.min.js|coco-ssd/);
  for (const name of ['candidate.onnx', 'ort.wasm.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) assert.ok(existsSync(new URL(name, root)));
});
test('offline page has a restrictive content policy and no remote script URLs', () => {
  const html = read('index.html');
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /src=["']https?:/);
  assert.match(html, /connect-src 'self' stepsense:/);
});

test('pinned model/runtime byte sizes and SHA-256 hashes match the checked-in artifacts', async () => {
  const { createHash } = await import('node:crypto');
  const manifest = JSON.parse(read('ASSETS.json'));
  assert.equal(manifest.model, 'YOLOX-Nano fine-tuned candidate');
  assert.equal(manifest.onnxRuntimeVersion, '1.20.1');
  assert.equal(manifest.files['candidate.onnx'].sha256, '516617114420ce3c2bac545869ee91bac8ff7a63e148a73afdb12f126433fab4');
  for (const [name, expected] of Object.entries(manifest.files)) {
    const data = readFileSync(new URL(name, root));
    assert.equal(data.length, expected.bytes, name);
    assert.equal(createHash('sha256').update(data).digest('hex'), expected.sha256, name);
  }
});

test('camera orchestration never constructs or calls the legacy network client', () => {
  const source = readFileSync(new URL('../MyEyes/ScanModel.swift', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /BackendClient\(|URLSession|\.createSession\(|\.metadata\(|\.checkReady\(/);
  assert.match(source, /try await detector\.analyze/);
  assert.match(source, /detector\.stop\(keepingReadyModel: nextPhase != \.failed\)/);
});

test('analysis failure immediately clears the floating-window overlay too', () => {
  const source = readFileSync(new URL('../MyEyes/ScanModel.swift', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('                clearDisplayedResult()\n                alertReason = "unavailable"'), source.indexOf('                retryDelay = 1'));
  assert.match(handler, /detail = "Analysis unavailable[^\n]*\n                refreshPiPOverlay\(\)/);
});

test('scanner privacy and latency text describe on-device inference', () => {
  const source = readFileSync(new URL('../MyEyes/ScannerView.swift', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /ms server|frames are sent to your configured backend/);
  assert.match(source, /processed on this iPhone and are not uploaded/);
});
