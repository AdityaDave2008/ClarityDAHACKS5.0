import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL(`../MyEyes/${name}.swift`, import.meta.url), 'utf8');
const view = read('ScannerView');
const service = read('NotificationService');
const model = read('ScanModel');
// Structural regression checks. UI acceptance is tested separately with XCTest.
test('settings explain immediate notification saving versus draft scan settings', () => {
  assert.match(view, /Close discards unapplied changes/);
  assert.match(view, /System notification preferences save immediately/);
  assert.match(view, /try await model.applyPreferences\(preferences\)/);
});
test('confidence control displays precision and can restore exact model default', () => {
  assert.match(view, /specifier: "%.2f"/);
  assert.match(view, /preferences.confidenceThreshold = ScanPreferences\(\).confidenceThreshold/);
  assert.doesNotMatch(view, /in: 0.4\.\.\.0.95, step: 0.05/);
});
test('permission requests respect notification opt-out in UI and service', () => {
  assert.match(view, /Button\("Request permissions"\)[\s\S]*?\.disabled\(notifications.isBusy \|\| !notifications.enabled\)/);
  assert.match(service, /func requestPermission\(\) async \{\s*guard enabled, !isBusy/);
  assert.match(service, /System notifications are off. Pending test notifications were cancelled./);
  assert.match(service, /if !enabled \{ cancelPending\(\); return \}/);
});
test('critical control explains disabled state and hides unavailable volume', () => {
  assert.match(view, /Critical Alerts are unavailable in this build/);
  assert.match(view, /if notifications.criticalEnabled && notifications.supportsCritical/);
});
test('hardware changes remain blocked during capture and persisted through Apply', () => {
  assert.match(view, /\.disabled\(model.isBusy \|\| model.cameraRunning \|\| model.cameraStopping \|\| saving\)/);
  assert.match(model, /updated.isLidarEnabled != preferences.isLidarEnabled, isBusy \|\| cameraRunning \|\| cameraStopping/);
  assert.match(model, /UserDefaults.standard.set\(encoded, forKey: "myeyes.preferences"\)/);
});
