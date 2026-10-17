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
  const start = camera.slice(camera.indexOf('func start(lidarEnabled:'), camera.indexOf('func requestFrame()'));
  assert.match(start, /interrupted = false/);
  const clear = camera.slice(camera.indexOf('private func clearHandlers('));
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

test('recovery does not depend on an interruptionEnded notification arriving', () => {
  // A long stay off screen can leave the session stopped with no end notification, which froze
  // the feed until the user stopped and started again.
  const interruption = camera.slice(camera.indexOf('private func handleInterruption(_ note: Notification)'), camera.indexOf('private func scheduleRecoveryCheck('));
  assert.match(interruption, /scheduleRecoveryCheck\(\)/);
});

test('recovery keeps retrying for as long as the scan is active', () => {
  const recovery = camera.slice(camera.indexOf('private func scheduleRecoveryCheck('), camera.indexOf('private func startLivenessTimer()'));
  assert.match(recovery, /scheduleRecoveryCheck\(attempt: attempt \+ 1\)/, 'Retries must not be capped');
  assert.match(recovery, /guard stillActive else \{ return \}/, 'Retries must stop when the scan ends');
  assert.match(recovery, /session\.startRunning\(\)/);
});

test('a silently stalled feed is detected without any notification', () => {
  const liveness = camera.slice(camera.indexOf('private func startLivenessTimer()'), camera.indexOf('private func handleInterruptionEnded()'));
  assert.match(liveness, /repeating:/, 'Liveness must be polled, not one-shot');
  assert.match(liveness, /session\.startRunning\(\)/);
  assert.match(liveness, /lastFrameAt/, 'Staleness must be measured from real delivered frames');
});

test('the liveness timer runs only while capture is active', () => {
  const clear = camera.slice(camera.indexOf('private func clearHandlers('));
  assert.match(clear, /livenessTimer\?\.cancel\(\)/);
  const start = camera.slice(camera.indexOf('func start(lidarEnabled:'), camera.indexOf('func requestFrame()'));
  assert.match(start, /startLivenessTimer\(\)/);
});

test('a wedged display layer is flushed instead of freezing forever', () => {
  const pip = readFileSync(new URL('../StepSense/PictureInPicture.swift', import.meta.url), 'utf8');
  const enqueue = pip.slice(pip.indexOf('func enqueue(_ sampleBuffer:'), pip.indexOf('func markNeedsFlush()'));
  assert.match(enqueue, /notReady/, 'A persistently unready layer must be recovered');
  assert.match(enqueue, /displayLayer\.flush\(\)[\s\S]{0,80}notReady = 0/);
});

test('becoming visible again rebuilds the decoder', () => {
  const pip = readFileSync(new URL('../StepSense/PictureInPicture.swift', import.meta.url), 'utf8');
  assert.match(pip, /override func didMoveToWindow\(\)/);
  const moved = pip.slice(pip.indexOf('override func didMoveToWindow()'), pip.indexOf('override func layoutSubviews()'));
  assert.match(moved, /needsFlush = true/);
});
