import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Source-wiring guards supplement executable startup and real WebKit tests.
// They do not substitute for Apple's physical permission dialog.
const model = readFileSync(new URL('../MyEyes/ScanModel.swift', import.meta.url), 'utf8');
const camera = readFileSync(new URL('../MyEyes/CameraCapture.swift', import.meta.url), 'utf8');
const start = model.slice(model.indexOf('    func start()'), model.indexOf('    func stop()'));

test('model readiness gates authorization and capture through the production startup coordinator', () => {
  assert.match(start, /try await ModelFirstStartup\.run/);
  assert.ok(start.indexOf('let loadedZone = try await detector.start()') < start.indexOf('try await camera.requestAuthorization()'));
  assert.ok(start.indexOf('try await camera.requestAuthorization()') < start.indexOf('try await camera.start('));
  assert.match(start, /isCurrent: \{ self\.generation == current && self\.appInForeground \}/);
});
test('camera session and preview are not initialized while the model is loading', () => {
  assert.match(model, /lazy var camera = CameraCapture\(\)/);
  const view = readFileSync(new URL('../MyEyes/ScannerView.swift', import.meta.url), 'utf8');
  assert.match(view, /if model\.cameraRunning \{\s*CameraPreview\(session: model\.camera\.session\)/);
  const stop = model.slice(model.indexOf('private func stop(nextPhase:'));
  assert.match(stop, /if cameraInitialized \{/);
});
test('capture retains permission and cancellation guard independently of the startup caller', () => {
  assert.match(camera, /func requestAuthorization\(\) async throws/);
  const captureStart = camera.slice(camera.indexOf('    func start(lidarEnabled:'), camera.indexOf('    func requestFrame()'));
  assert.match(captureStart, /try await requestAuthorization\(\)/);
});
test('startup model failure keeps camera off rather than entering preview-only', () => {
  assert.doesNotMatch(start, /phase = \.previewing/);
  assert.match(start, /stop\(nextPhase: \.failed/);
});
test('loading screen exposes honest status and cancellation, failed startup exposes retry', () => {
  const view = readFileSync(new URL('../MyEyes/ScannerView.swift', import.meta.url), 'utf8');
  assert.match(view, /private var modelLoadingScreen: some View/);
  assert.match(view, /Camera stays off until the model is ready/);
  assert.match(view, /Button\("Cancel"\)/);
  assert.match(view, /"Retry"/);
  assert.match(view, /Text\(model.detail\)/);
});
