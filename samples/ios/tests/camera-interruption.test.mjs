import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Structural regression guards. Actual interruption behavior, including hiding and moving the
// floating window, must be exercised on a physical iPhone.
const camera = readFileSync(new URL('../StepSense/CameraCapture.swift', import.meta.url), 'utf8');
const model = readFileSync(new URL('../StepSense/ScanModel.swift', import.meta.url), 'utf8');

test('a capture interruption is not treated as a failed scan', () => {
  // Hiding, moving, or resizing the floating window interrupts capture. Reporting those as
  // failures ended the scan and forced a manual restart.
  assert.doesNotMatch(
    camera,
    /wasInterruptedNotification[\s\S]{0,200}?reportFailure/,
    'Interruptions must not route straight to the failure handler'
  );
  assert.match(camera, /func handleInterruption\(_ note: Notification\)/);
});

test('the end of an interruption is observed and capture is confirmed running', () => {
  assert.match(camera, /AVCaptureSession\.interruptionEndedNotification/);
  const ended = camera.slice(camera.indexOf('func handleInterruptionEnded()'), camera.indexOf('private func restartAfterRuntimeError()'));
  assert.match(ended, /session\.startRunning\(\)/);
});

test('a runtime error attempts recovery before surfacing a failure', () => {
  const restart = camera.slice(camera.indexOf('private func restartAfterRuntimeError()'), camera.indexOf('/// May be requested before'));
  assert.match(restart, /session\.startRunning\(\)/);
  assert.match(restart, /reportFailure/, 'An unrecoverable camera must still report');
});

test('interruption state is cleared when capture starts and stops', () => {
  const start = camera.slice(camera.indexOf('func start(onFrame:'), camera.indexOf('func requestFrame()'));
  assert.match(start, /interrupted = false/);
  const clear = camera.slice(camera.indexOf('private func clearHandlers()'));
  assert.match(clear, /interruptionHandler = nil/);
});

test('scanning resumes its frame loop after capture comes back', () => {
  const handler = model.slice(model.indexOf('private func handleCameraInterruption('), model.indexOf('private func refreshPiPOverlay()'));
  assert.match(handler, /camera\.requestFrame\(\)/);
  assert.match(handler, /pip\.update \{ \$0\.live = true \}/);
  assert.doesNotMatch(handler, /stop\(nextPhase:/, 'A recoverable pause must not end the scan');
});

test('a swallowed frame request cannot leave scanning idle forever', () => {
  assert.match(model, /private func startFrameWatchdog\(generation current: UUID\)/);
  const watchdog = model.slice(model.indexOf('private func startFrameWatchdog('));
  assert.match(watchdog, /camera\.requestFrame\(\)/);
  assert.match(watchdog, /sequence == waitingFor/, 'The watchdog must only fire when no frame arrived');
  assert.match(watchdog, /!cameraPaused/, 'The watchdog must not poll while capture is paused');
});

test('stopping cancels the watchdog', () => {
  const stop = model.slice(model.indexOf('private func stop(nextPhase:'));
  assert.match(stop, /watchdogTask\?\.cancel\(\)/);
});
