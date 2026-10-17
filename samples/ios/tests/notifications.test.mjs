import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../MyEyes/NotificationService.swift', import.meta.url), 'utf8');
const view = readFileSync(new URL('../MyEyes/ScannerView.swift', import.meta.url), 'utf8');
const plist = readFileSync(new URL('../MyEyes/Info.plist', import.meta.url), 'utf8');
const entitlements = readFileSync(new URL('../MyEyes/Clarity.entitlements', import.meta.url), 'utf8');
// Source-contract regression checks, not a substitute for physical-device delivery tests.
test('normal build never claims restricted Critical Alerts entitlement', () => {
  assert.match(plist, /ClarityCriticalAlertsApproved<\/key>\s*<false\/>/);
  assert.doesNotMatch(entitlements, /usernotifications\.critical-alerts/);
  assert.match(entitlements, /usernotifications\.time-sensitive/);
});
test('critical authorization and sound require explicit opt-in and OS permission', () => {
  assert.match(source, /if supportsCritical && criticalEnabled \{ options.insert\(\.criticalAlert\) \}/);
  assert.match(source, /supportsCritical && criticalEnabled && settings.criticalAlertSetting == \.enabled/);
  assert.match(source, /defaultCriticalSound\(withAudioVolume: Float\(min\(1, max\(0, volume\)\)\)\)/);
});
test('notifications are permission checked and cancellation aware', () => {
  assert.equal((source.match(/guard enabled, !Task.isCancelled/g) || []).length, 2);
  assert.match(source, /\.authorized, \.provisional, \.ephemeral/);
  assert.match(source, /if !enabled \{ cancelPending\(\); return \}/);
  assert.match(source, /removePendingNotificationRequests/);
  assert.match(source, /catch \{ message = "Notification could not be scheduled:/);
});
test('test is delayed and foreground hazard sound is not doubled', () => {
  assert.match(source, /timeInterval: 5, repeats: false/);
  assert.match(source, /test" \? \[\.banner, \.sound\] : \[\.banner\]/);
});
test('settings exposes exactly five expandable permission answers', () => {
  assert.equal((view.match(/DisclosureGroup\(/g) || []).length, 5);
  assert.match(view, /notifications\.openSettings\(\)/);
  assert.match(view, /notifications\.sendTest\(\)/);
});
