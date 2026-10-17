// Source contracts only, not substitutes for device UI or snapshot tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL(`../MyEyes/${name}`, import.meta.url), 'utf8');
const ui = read('ScannerView.swift');
const app = read('MyEyesApp.swift');

test('native screens consume the web background and coral palette', () => {
  assert.match(app, /senseBackground = Color\(red: 16 \/ 255, green: 24 \/ 255, blue: 32 \/ 255\)/);
  assert.match(app, /senseTeal = Color\(red: 243 \/ 255, green: 139 \/ 255, blue: 104 \/ 255\)/);
  assert.match(ui, /background\(Color\.senseBackground\.ignoresSafeArea\(\)\)/);
  assert.doesNotMatch(ui, /background\(Color\.black\.ignoresSafeArea/);
});

test('Clarity logo brand and persistent Home Settings navigation expose only native destinations', () => {
  assert.match(ui, /Image\("ClarityLogo"\)/);
  assert.match(ui, /safeAreaInset\(edge: \.bottom\) \{ bottomNavigation \}/);
  assert.match(ui, /Label\("Home", systemImage: "house.fill"\)/);
  assert.match(ui, /Label\("Settings", systemImage: "slider.horizontal.3"\)/);
  assert.match(ui, /Button \{ showingSettings = true \}/);
  assert.match(ui, /sheet\(isPresented: \$showingSettings\) \{ SettingsView\(model: model\) \}/);
  assert.doesNotMatch(ui, /Label\("Issues"|WKWebView/);
});

test('camera remains native with a web gradient and neutral rounded border', () => {
  assert.match(ui, /CameraPreview\(session: model.camera.session\)/);
  assert.match(ui, /LinearGradient\(colors: \[\.senseSurface, \.senseSurfaceBottom\]/);
  assert.match(ui, /RoundedRectangle\(cornerRadius: 24\)\.stroke\(Color\.white\.opacity\(0.1\)/);
  assert.match(ui, /model.startPictureInPicture\(\)/);
  assert.match(ui, /PiPSourceAnchor\(controller: model.pip\)/);
});

test('navigation and scanner action text scale and settings retain native controls', () => {
  assert.match(ui, /accessibilityAddTraits\(\.isSelected\)/);
  assert.match(ui, /font\(\.body.weight\(\.semibold\)\)/);
  for (const control of ['distanceStepper("Near"', 'ForEach(AlertMode.allCases)', '$preferences.isLidarEnabled', 'model.applyPreferences(preferences)', 'model.testAlert()']) assert.ok(ui.includes(control), control);
});
