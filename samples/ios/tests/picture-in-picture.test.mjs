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
  assert.doesNotMatch(view, /\.disabled\([^)]*model\.phase != \.scanning/);
});

test('automatic preparation is not gated by the obsolete saved toggle', () => {
  assert.doesNotMatch(model, /stepsense\.pip|pictureInPictureRequested/);
  assert.doesNotMatch(view, /Toggle\("Use floating window"/);
  const start = model.slice(model.indexOf('    func start()'), model.indexOf('    func stop()'));
  assert.match(start, /cameraRunning = true[\s\S]*pip\.setEnabled\(true\)/);
  assert.equal((start.match(/pip\.setEnabled/g) ?? []).length, 1,
    'Detector completion must not re-arm automatic entry after a dismissal');
});

test('launch prepares the anchor without starting the camera or opening PiP', () => {
  const app = readFileSync(new URL('../StepSense/StepSenseApp.swift', import.meta.url), 'utf8');
  const init = model.slice(model.indexOf('    init()'), model.indexOf('    var isBusy'));
  assert.match(model, /cameraRunning = false/);
  assert.match(model, /var phase: Phase = \.idle/);
  assert.match(pip, /private var enabled = false/);
  assert.doesNotMatch(init + app, /(?:model|camera|pip)\.start\(/);
  const attach = pip.slice(pip.indexOf('    func attach('), pip.indexOf('    func setEnabled('));
  assert.match(attach, /rebuildController\(\)/);
  assert.doesNotMatch(attach, /startPictureInPicture\(|setEnabled\(true\)/);
});

test('dismissal disarms automatic entry and cancels pending manual starts', () => {
  const dismissed = pip.slice(pip.indexOf('nonisolated func pictureInPictureControllerDidStop'), pip.indexOf('failedToStartPictureInPictureWithError'));
  assert.match(dismissed, /setEnabled\(false\)/);
  assert.doesNotMatch(dismissed, /\.start\(|startPictureInPicture\(/);
  const stop = model.slice(model.indexOf('private func stop(nextPhase:'));
  assert.match(stop, /camera\.stop\(\)/);
  assert.match(stop, /pip\.setEnabled\(false\)/);
});

test('manual opening remains explicit and foreground return never re-arms PiP', () => {
  const manual = model.slice(model.indexOf('    func startPictureInPicture()'), model.indexOf('    private func handleCameraInterruption'));
  assert.match(manual, /pip\.setEnabled\(cameraRunning\)/);
  assert.match(manual, /pip\.start\(\)/);
  const foreground = model.slice(model.indexOf('    func returnedToForeground()'), model.indexOf('    func startPictureInPicture()'));
  assert.doesNotMatch(foreground, /setEnabled|pip\.start/);
});

test('backgrounding keeps a preview-only session alive in the window', () => {
  const pause = model.slice(model.indexOf('func pauseForBackground()'), model.indexOf('func returnedToForeground()'));
  assert.match(pause, /if cameraRunning, pip\.isActive, multitaskingEnabled == true/);
});

test('the controller is built from the anchor alone, not only once scanning starts', () => {
  // isPictureInPicturePossible stays false until the system inspects a real content source,
  // so building the controller lazily left the control permanently unavailable.
  const rebuild = pip.slice(pip.indexOf('private func rebuildController()'), pip.indexOf('func start()'));
  assert.match(rebuild, /guard isSupported, let sourceView else/);
  assert.doesNotMatch(rebuild, /guard isSupported, enabled, let sourceView else/);
});

test('the open button is not gated on a readiness flag the user cannot influence', () => {
  const disabled = view.match(/\.disabled\(model\.pip\.unavailableReason != nil \|\| model\.pip\.isActive\)/);
  assert.ok(disabled, 'Only hard blockers may disable the open button');
  assert.doesNotMatch(view, /\.disabled\([^)]*!model\.pip\.isPossible/);
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
  assert.match(pip, /canStartPictureInPictureAutomaticallyFromInline = enabled/);
  assert.match(pip, /controller\?\.canStartPictureInPictureAutomaticallyFromInline = newValue/);
});

test('frames are displayed immediately instead of waiting on an idle timebase', () => {
  // AVSampleBufferDisplayLayer honors presentation timestamps against its timebase, which is
  // never started here, so camera buffers queued without this attachment are never shown.
  const enqueue = pip.slice(pip.indexOf('func enqueue(_ sampleBuffer:'), pip.indexOf('func markNeedsFlush()'));
  assert.match(enqueue, /kCMSampleAttachmentKey_DisplayImmediately/);
});

test('the display layer is rebuilt across transitions that kill its decoder', () => {
  assert.match(pip, /override func willMove\(toWindow newWindow: UIWindow\?\)/);
  const enqueue = pip.slice(pip.indexOf('func enqueue(_ sampleBuffer:'), pip.indexOf('func markNeedsFlush()'));
  assert.match(enqueue, /displayLayer\.status == \.failed \|\| needsFlush/);
  assert.match(pip, /func resetDisplay\(\)/);
});

test('entering and leaving the floating window resets the display', () => {
  const start = pip.slice(pip.indexOf('DidStartPictureInPicture'), pip.indexOf('failedToStartPictureInPictureWithError'));
  assert.match(start, /resetDisplay\(\)/);
});

test('returning to the foreground and resuming capture reset the display', () => {
  const model = readFileSync(new URL('../StepSense/ScanModel.swift', import.meta.url), 'utf8');
  const foreground = model.slice(model.indexOf('func returnedToForeground()'), model.indexOf('func startPictureInPicture()'));
  assert.match(foreground, /pip\.resetDisplay\(\)/);
  const interruption = model.slice(model.indexOf('private func handleCameraInterruption('), model.indexOf('private func refreshPiPOverlay()'));
  assert.match(interruption, /pip\.resetDisplay\(\)/);
});
