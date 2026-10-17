import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
test('a destroyed model enters bounded recovery instead of permanent preview-only', () => {
  const source = readFileSync(new URL('MyEyes/ScanModel.swift', root), 'utf8');
  assert.match(source, /try await detectorRecovery\.reload/);
  assert.match(source, /detectorRecovery\.recordHealthyFrame\(\)/);
  assert.match(source, /startFrameWatchdog\(generation: current\)/);
});
test('actual Swift recovery controller bounds retries, honors cancellation and resets on healthy inference', () => {
  const scratch = mkdtempSync(join(process.env.JCODE_SCRATCH_DIR || tmpdir(), 'native-recovery-'));
  try {
    const binary = join(scratch, 'recovery');
    execFileSync('swiftc', ['-parse-as-library', fileURLToPath(new URL('MyEyes/DetectorRecovery.swift', root)), fileURLToPath(new URL('tests/DetectorRecoveryTests.swift', root)), '-o', binary], { timeout: 60000 });
    assert.match(execFileSync(binary, { encoding: 'utf8', timeout: 10000 }), /PASS bounded model recovery/);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
test('sensor UI is delivered independently and not cleared by detector-only failures', () => {
  const source = readFileSync(new URL('MyEyes/ScanModel.swift', root), 'utf8');
  assert.match(source, /onDepthSample: \{ \[weak self\] sample in[\s\S]*?await MainActor\.run/);
  const clear = source.slice(source.indexOf('private func clearDisplayedResult()'), source.indexOf('private func stop(nextPhase:'));
  assert.doesNotMatch(clear, /centerSurfaceMeasurement/);
  const analyze = source.slice(source.indexOf('private func analyze('), source.indexOf('private func startFrameWatchdog('));
  assert.doesNotMatch(analyze, /centerSurfaceMeasurement =/);
});
test('suspended WebKit recovery waits for foreground without restarting capture', () => {
  const source = readFileSync(new URL('MyEyes/ScanModel.swift', root), 'utf8');
  assert.match(source, /private var detectorRecoveryDeferred = false/);
  const foreground = source.slice(source.indexOf('func returnedToForeground()'), source.indexOf('func startPictureInPicture()'));
  assert.match(foreground, /detectorRecoveryDeferred/);
  assert.match(foreground, /reloadDetector\(generation: current\)/);
  assert.doesNotMatch(foreground, /camera\.start\(/);
  const reload = source.slice(source.indexOf('private func reloadDetector('), source.indexOf('private func expireDisplayedResult('));
  assert.match(reload, /guard appInForeground else/);
});
