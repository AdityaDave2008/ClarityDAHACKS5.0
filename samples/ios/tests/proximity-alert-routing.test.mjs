import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('fresh proximity routing bypasses generic cooldown without masking unknown objects', { skip: process.platform !== 'darwin' }, () => {
  const scratch = process.env.JCODE_SCRATCH_DIR || join(homedir(), '.jcode', 'scratch'); mkdirSync(scratch, { recursive: true });
  const binary = join(mkdtempSync(join(scratch, 'proximity-routing-')), 'tests');
  const source = ['../MyEyes/APIClient.swift', '../MyEyes/ProximityPolicy.swift', '../MyEyes/ProximityAlertRouting.swift', '../MyEyes/ProximityFeedback.swift', 'ProximityAlertRoutingTests.swift'].map(p => fileURLToPath(new URL(p, import.meta.url)));
  execFileSync('swiftc', ['-parse-as-library', ...source, '-o', binary], { timeout: 60000 });
  assert.match(execFileSync(binary, { encoding: 'utf8', timeout: 10000 }), /PASS proximity alert routing/);
});
test('production scan routes enriched detections and clears proximity on invalidation', () => {
  const source = readFileSync(new URL('../MyEyes/ScanModel.swift', import.meta.url), 'utf8');
  assert.match(source, /ProximityAlertRoute\.select\(detections/);
  assert.match(source, /case \.outsideRange\(let target\):\s*alerts\.stop\(\)/, 'known outside-range transition must also stop prior generic speech/beep');
  assert.match(source, /alerts\.updateProximity\(target: target, modes: preferences\.alertModes\)/);
  const clear = source.slice(source.indexOf('private func clearDisplayedResult()'), source.indexOf('private func stop(nextPhase:'));
  assert.match(clear, /alerts\.stop\(\)/, "pause/invalidated display must stop generic output too");
  assert.match(clear, /proximityPolicy\.reset\(\)/);
  const expiry = source.slice(source.indexOf('private func expireDepth('), source.indexOf('private func clearCenterDepth()'));
  assert.match(expiry, /alerts\.stopProximity\(\)/);
  assert.match(expiry, /expired\.proximityBand = \.unknown/);
});
