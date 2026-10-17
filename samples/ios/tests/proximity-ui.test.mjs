import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const source = name => fileURLToPath(new URL(`../MyEyes/${name}`, import.meta.url));
const read = name => readFileSync(source(name), 'utf8');

test('main overlay resolves fresh bands on a periodic clock, never zone-based box colors', () => {
  const ui = read('ScannerView.swift');
  assert.match(ui, /TimelineView\(\.periodic[^\n]*\n\s*DetectionOverlay\([^\n]*now: ProcessInfo\.processInfo\.systemUptime\)/);
  assert.match(ui, /detection\.freshProximityBand\(at: now\)/);
  assert.match(ui, /Color\(uiColor: band\.overlayColor\)/);
  assert.doesNotMatch(ui, /detection\.inZone \? \.yellow/);
  assert.match(ui, /band\.title/);
  assert.match(ui, /proximityDescription\(at: now\)/);
});

test('PiP uses the same fresh palette and always labels unknown boxes without changing lifecycle', () => {
  const pip = read('PictureInPicture.swift');
  assert.match(pip, /detection\.freshProximityBand\(at: now\)/);
  assert.match(pip, /shape\.strokeColor = band\.overlayColor\.cgColor/);
  assert.match(pip, /band\.title/);
  assert.match(pip, /proximityDescription\(at: now\)/);
  assert.doesNotMatch(pip, /shape\.strokeColor = detection\.inZone/);
  assert.match(pip, /Paused · open Clarity/);
});

test('shared band palette has red, amber, green, muted blue and neutral gray', () => {
  const ui = read('ScannerView.swift');
  assert.match(ui, /case \.near: return \.systemRed/);
  assert.match(ui, /case \.intermediate: return \.systemOrange/);
  assert.match(ui, /case \.far: return \.systemGreen/);
  assert.match(ui, /case \.outOfRange: return UIColor\(red:/);
  assert.match(ui, /case \.unknown: return \.systemGray/);
});

test('long object and proximity labels stay bounded inside the camera image', () => {
  const ui = read('ScannerView.swift');
  assert.match(ui, /let labelWidth = min\(rect\.width, 250\)/);
  assert.match(ui, /frame\(width: max\(0, labelWidth - 12\)\)/);
  assert.match(ui, /rect\.minX \+ labelWidth \/ 2/);
  assert.match(ui, /lineLimit\(3\)/);
});

test('settings explain ordered thresholds, cadence and optical-axis limitations while preserving choices', () => {
  const ui = read('ScannerView.swift');
  for (const text of ['Proximity distances', '2 Hz', '1 Hz', '0.5 Hz', 'no pulses', 'optical-axis', 'Unknown', 'not a safety indication']) assert.ok(ui.includes(text), text);
  assert.match(ui, /preferences\.effectiveProximitySettings/);
  assert.match(ui, /preferences\.proximitySettings = updated/);
  assert.match(ui, /in: 0\.2\.\.\.5, step: 0\.1/);
  assert.match(ui, /ForEach\(AlertMode\.allCases\)/);
  assert.match(ui, /\$preferences\.isLidarEnabled/);
  assert.match(ui, /Near < Intermediate < Far/);
});

test('production settings editor rejects invalid edits instead of resetting or accepting invalid bands', { skip: process.platform !== 'darwin' }, () => {
  const ui = read('ScannerView.swift');
  const helper = ui.match(/struct ProximitySettingsEditor \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper, 'production settings editor exists');
  const scratch = process.env.JCODE_SCRATCH_DIR || join(homedir(), '.jcode', 'scratch');
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, 'proximity-ui-'));
  const harness = join(dir, 'main.swift');
  writeFileSync(harness, `import Foundation\n${helper}\n` + String.raw`
let original = ProximitySettings()
func edit(_ value: Double, _ key: WritableKeyPath<ProximitySettings, Double>) -> ProximitySettings? {
    ProximitySettingsEditor.setting(value, at: key, in: original)
}
precondition(edit(0.2, \.nearMeters)?.nearMeters == 0.2)
precondition(edit(1.5, \.intermediateMeters)?.intermediateMeters == 1.5)
precondition(edit(5, \.farMeters)?.farMeters == 5)
for invalid in [Double.nan, .infinity, -.infinity, 0.19, 5.01, 2, 3] {
    precondition(edit(invalid, \.nearMeters) == nil)
}
precondition(edit(1, \.intermediateMeters) == nil)
precondition(edit(3, \.intermediateMeters) == nil)
precondition(edit(2, \.farMeters) == nil)
precondition(original.nearMeters == 1 && original.intermediateMeters == 2 && original.farMeters == 3)
print("proximity UI editing contract passed")
`);
  const binary = join(dir, 'ui-contract');
  const build = spawnSync('swiftc', [source('APIClient.swift'), source('DepthEstimate.swift'), harness, '-o', binary], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const run = spawnSync(binary, [], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /proximity UI editing contract passed/);
});


test('legend separates confirmed non-LiDAR visual estimates from measured and unknown capability', () => {
  const ui = read('ScannerView.swift');
  assert.match(ui, /model\.lidarHardwareAvailable == false/);
  assert.match(ui, /model\.lidarHardwareAvailable == true/);
  for (const text of ['Visual size estimate', '35%', '12%', '3%', 'not meters', 'physical distance', 'Checking depth capability']) assert.ok(ui.includes(text), text);
  assert.match(ui, /Unknown · gray · no pulses/);
});
