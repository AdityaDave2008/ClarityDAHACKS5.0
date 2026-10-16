import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Structural regression guards for the floating-window controls. The actual window, background
// camera access, and Apple's own eligibility checks require a physical iPhone.
const model = readFileSync(new URL('../StepSense/ScanModel.swift', import.meta.url), 'utf8');
const view = readFileSync(new URL('../StepSense/ScannerView.swift', import.meta.url), 'utf8');
const pip = readFileSync(new URL('../StepSense/PictureInPicture.swift', import.meta.url), 'utf8');
const plist = readFileSync(new URL('../StepSense/Info.plist', import.meta.url), 'utf8');

test('the floating window is offered whenever the camera runs, not only once detection connects', () => {
  // A preview-only session still has camera frames to show, so gating on `.scanning` disabled
  // the control for everyone whose backend was unreachable.
  assert.match(model, /pip\.setEnabled\(cameraRunning\)/);
  assert.doesNotMatch(model, /pip\.setEnabled\(phase == \.scanning\)/);
  assert.match(view, /\.disabled\(!model\.pip\.isSupported \|\| !model\.cameraRunning/);
  assert.doesNotMatch(view, /\.disabled\([^)]*model\.phase != \.scanning/);
});

test('the toggle honors both the saved preference and a running camera', () => {
  assert.match(model, /pip\.setEnabled\(pictureInPictureRequested && cameraRunning\)/);
});

test('backgrounding keeps a preview-only session alive in the window', () => {
  const pause = model.slice(model.indexOf('func pauseForBackground()'), model.indexOf('func returnedToForeground()'));
  assert.match(pause, /if cameraRunning, pip\.isActive, multitaskingEnabled == true/);
});

test('starting waits for readiness instead of silently doing nothing', () => {
  const start = pip.slice(pip.indexOf('    func start()'), pip.indexOf('    func stop()'));
  assert.match(start, /isPictureInPicturePossible/);
  assert.match(start, /failureMessage =/, 'An unavailable window must explain itself');
});

test('an interrupted start attempt cannot open the window later', () => {
  const begin = pip.indexOf('    func stop()');
  const end = pip.indexOf('func update(', begin);
  assert.ok(begin >= 0 && end > begin, 'stop() must exist ahead of update()');
  assert.match(pip.slice(begin, end), /startAttempt\?\.cancel\(\)/);
});

test('video-call Picture in Picture requirements stay declared', () => {
  assert.match(plist, /<string>voip<\/string>/);
  assert.match(pip, /activeVideoCallSourceView/);
  assert.match(pip, /AVPictureInPictureVideoCallViewController/);
  assert.match(pip, /canStartPictureInPictureAutomaticallyFromInline = true/);
});
