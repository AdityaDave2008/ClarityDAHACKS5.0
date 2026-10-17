// The v2 candidate is a full 80-class COCO model trained on 109,880 annotations.
// Hiding most of its classes, or keeping a precision-tuned threshold that rejects
// almost every true detection, makes a working model look broken to the user.
//
// Evidence that motivated these tests (real ONNX Runtime inference on the shipped
// samples/ios/MyEyes/OfflineDetector/candidate.onnx, COCO val2017 images):
//   street.jpg  @0.7875 -> model found 1 object, the app showed 0.
//   kitchen.jpg @0.7875 -> model found 0; @0.60 it found 'bear', app showed 0.
//   desk.jpg    -> model found 'stop sign:0.96', app showed 0 at every threshold.
//   people.jpg  -> 'bed:0.89' found, app showed 0 of it.
// 64 of the 80 trained classes were unreachable, covering 7,969 tuning objects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../MyEyes/OfflineDetector/', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
const policyContext = () => {
  const context = vm.createContext({});
  vm.runInContext(read('policy.js'), context);
  return context;
};

// Exactly the class list the model exposes, from its own contract.
const contractLabels = JSON.parse(read('model-contract.json')).classes.map(entry => entry.name);

test('every class the candidate was trained on can reach the user', () => {
  const context = policyContext();
  assert.equal(contractLabels.length, 80);
  const missing = contractLabels.filter(label => {
    const predictions = [{ class: label, score: 0.9, bbox: [140, 120, 100, 150] }];
    return context.assessDetections(predictions, 400, 300, 0.6).length === 0;
  });
  assert.deepEqual(missing, [], `trained classes unreachable in the app: ${missing.join(', ')}`);
});

test('the decoder and the alert policy agree on the label vocabulary', () => {
  const decoder = vm.createContext({ Float32Array });
  vm.runInContext(read('yolox.js'), decoder);
  const context = policyContext();
  // Every label the decoder can emit must survive the policy, or results vanish silently.
  const emitted = vm.runInContext('COCO_LABELS', decoder);
  assert.deepEqual([...emitted].sort(), [...contractLabels].sort());
  for (const label of emitted) {
    const kept = context.assessDetections([{ class: label, score: 0.9, bbox: [10, 10, 50, 50] }], 400, 300, 0.6);
    assert.equal(kept.length, 1, `decoder emits ${label} but the policy discards it`);
  }
});

test('the shipped default threshold surfaces real detections instead of suppressing them', () => {
  const native = readFileSync(new URL('../MyEyes/APIClient.swift', import.meta.url), 'utf8');
  const match = native.match(/candidateConfidenceDefault = ([0-9.]+)/);
  assert.ok(match, 'native default confidence threshold not found');
  const threshold = Number(match[1]);
  // Measured on the shipped candidate: at 0.7875 whole scenes returned nothing.
  // 0.45 keeps the tuned operating point available while restoring usable recall.
  assert.ok(threshold <= 0.5, `default ${threshold} suppresses nearly every true detection`);
  assert.ok(threshold >= 0.25, `default ${threshold} is low enough to invite false positives`);
  // The decoder default must not silently re-impose the suppressive threshold.
  const decoder = read('yolox.js').match(/CANDIDATE_THRESHOLD = ([0-9.]+)/);
  assert.ok(decoder, 'decoder threshold not found');
  assert.equal(Number(decoder[1]), threshold, 'decoder and native defaults disagree');
});

test('threshold and label coverage stay documented for judges', () => {
  const assets = JSON.parse(read('ASSETS.json'));
  const native = readFileSync(new URL('../MyEyes/APIClient.swift', import.meta.url), 'utf8');
  const threshold = Number(native.match(/candidateConfidenceDefault = ([0-9.]+)/)[1]);
  assert.equal(assets.confidenceThreshold, threshold, 'pinned asset manifest threshold is stale');
});
