import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const source = name => fileURLToPath(new URL(`../MyEyes/${name}`, import.meta.url));
const read = name => readFileSync(source(name), 'utf8');

test('production Swift depth estimator rejects invalid, mixed and expired maps; preferences migrate OFF', { skip: process.platform !== 'darwin' }, () => {
  assert.ok(existsSync(source('DepthEstimate.swift')), 'depth estimator must exist');
  const scratch = process.env.JCODE_SCRATCH_DIR || join(homedir(), '.jcode', 'scratch');
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, 'lidar-tests-'));
  const binary = join(dir, 'depth-tests');
  const result = spawnSync('swiftc', ['-parse-as-library', source('APIClient.swift'), source('DepthEstimate.swift'), new URL('./DepthEstimateTests.swift', import.meta.url).pathname, '-o', binary], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const run = spawnSync(binary, [], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /preference migration passed/);
});

test('capture uses synchronized unfiltered calibrated depth without replacing ordinary RGB', () => {
  const camera = read('CameraCapture.swift');
  assert.match(camera, /AVCaptureDataOutputSynchronizer/);
  assert.match(camera, /sampleBufferWasDropped/);
  assert.match(camera, /depthDataWasDropped/);
  assert.match(camera, /CMSyncConvertTime/);
  assert.match(camera, /depth: depth/);
  const depth = read('LiDARCapture.swift');
  for (const contract of [/builtInLiDARDepthCamera/, /isFilteringEnabled = false/, /depthDataAccuracy == \.absolute/, /depthDataQuality == \.high/, /cameraCalibrationData/, /isVideoOrientationSupported/, /preferredVideoStabilizationMode = \.off/]) assert.match(depth, contract);
  assert.doesNotMatch(camera + depth, /ARSession/);
});

test('settings require Stop and estimates expire independently from detector boxes', () => {
  const model = read('ScanModel.swift');
  const ui = read('ScannerView.swift');
  assert.match(model, /lidarEnabled: preferences.isLidarEnabled/);
  assert.match(model, /updated.isLidarEnabled != preferences.isLidarEnabled/);
  assert.match(model, /depthExpirationTask/);
  assert.match(model, /frame.depth/);
  assert.match(ui, /\$preferences.isLidarEnabled/);
  assert.match(ui, /disabled\(model.isBusy/);
  assert.match(ui, /Stop scanning to change/);
  assert.match(read('APIClient.swift'), /depth unavailable/);
});

test('superseded start cannot clear a newer run and format selection searches valid pairs', () => {
  const camera = read('CameraCapture.swift');
  assert.ok(camera.includes('clearHandlers(ifToken: token)'), 'failure cleanup must be conditional on the same capture token');
  assert.ok(camera.includes('if let token, captureToken != token'), 'token comparison and clearing share the lock');
  assert.ok(read('LiDARCapture.swift').includes('candidates.compactMap'), 'search compatible RGB/depth pairs rather than giving up on first RGB format');
});

test('stop transition blocks capture mode edits and restart until camera release completes', () => {
  const model = read('ScanModel.swift');
  assert.ok(model.includes('cameraStopping = true'), 'model must track asynchronous camera release');
  assert.ok(model.includes('isBusy || cameraRunning || cameraStopping'), 'model mode-change guard includes stopping');
  assert.ok(read('ScannerView.swift').includes('model.cameraStopping'), 'UI disables capture controls during stop');
  assert.ok(read('CameraCapture.swift').includes('onStopped()'), 'stop completion follows stopRunning on session queue');
});

test('LiDAR failure stages are visible and metadata telemetry is rate limited', () => {
  const camera = read('CameraCapture.swift');
  const lidar = read('LiDARCapture.swift');
  assert.match(lidar, /lidar\.formats/);
  assert.match(lidar, /onRejection/);
  assert.match(camera, /lidar\.fallback/);
  assert.match(camera, /lidar\.counters/);
  assert.match(camera, /depthDiagnostic/);
  assert.match(read('ScanModel.swift'), /depthStatus = frame\.depthDiagnostic/);
});


test('retained RGB pairing is cleared on runtime errors and dropped video', () => {
  const camera = read('CameraCapture.swift');
  const restart = camera.slice(camera.indexOf('private func restartAfterRuntimeError()'), camera.indexOf('/// May be requested'));
  assert.match(restart, /clearDepthPairing/);
  assert.match(camera, /!rgb.sampleBufferWasDropped else \{ clearDepthPairing\(\)/);
});
