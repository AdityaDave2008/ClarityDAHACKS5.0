import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Structural regression guards, not a substitute for exercising Apple's permission dialog on a device.
const model = readFileSync(new URL('../StepSense/ScanModel.swift', import.meta.url), 'utf8');
const camera = readFileSync(new URL('../StepSense/CameraCapture.swift', import.meta.url), 'utf8');
const start = model.slice(model.indexOf('    func start()'), model.indexOf('    func stop()'));

test('startup requests camera authorization before constructing a network client', () => {
  const permission = start.indexOf('try await camera.requestAuthorization()');
  const network = start.indexOf('let api = try BackendClient(');
  assert.ok(permission >= 0 && permission < network, 'Camera authorization must precede backend connection');
});

test('cancelled or superseded startup cannot connect after permission dialog returns', () => {
  const permission = start.indexOf('try await camera.requestAuthorization()');
  assert.ok(permission >= 0, 'Startup must explicitly request authorization');
  const between = start.slice(permission, start.indexOf('let api = try BackendClient('));
  assert.match(between, /try Task\.checkCancellation\(\)/);
  assert.match(between, /guard generation == current else \{ return \}/);
});

test('capture retains its permission guard independently of startup caller', () => {
  assert.match(camera, /func requestAuthorization\(\) async throws/);
  const captureStart = camera.slice(camera.indexOf('    func start(onFrame:'), camera.indexOf('    func requestFrame()'));
  assert.match(captureStart, /try await requestAuthorization\(\)/);
});

test('camera capture starts before backend construction', () => {
  assert.ok(start.indexOf('try await camera.start(') < start.indexOf('let api = try BackendClient('));
});

test('network failure retains a clearly labeled preview-only state', () => {
  assert.match(start, /if cameraRunning \{[\s\S]*phase = \.previewing/);
  assert.match(start, /Preview only/);
});

test('view does not cover an active camera while connecting or offline', () => {
  const view = readFileSync(new URL('../StepSense/ScannerView.swift', import.meta.url), 'utf8');
  assert.match(view, /if !model.cameraRunning \{/);
});
