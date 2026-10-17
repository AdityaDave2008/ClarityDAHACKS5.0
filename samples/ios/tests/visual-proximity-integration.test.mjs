import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('source-aware visual and LiDAR observations reach actual feedback safely', { skip: process.platform !== 'darwin' }, () => {
  const scratch = process.env.JCODE_SCRATCH_DIR || join(homedir(), '.jcode', 'scratch'); mkdirSync(scratch, { recursive: true });
  const binary = join(mkdtempSync(join(scratch, 'visual-proximity-integration-')), 'tests');
  const sources = ['APIClient', 'DepthEstimate', 'ProximityPolicy', 'ProximityAlertRouting', 'ProximityFeedback'].map(name => fileURLToPath(new URL(`../MyEyes/${name}.swift`, import.meta.url)));
  execFileSync('swiftc', ['-parse-as-library', ...sources, fileURLToPath(new URL('VisualProximityIntegrationTests.swift', import.meta.url)), '-o', binary], { timeout: 60000 });
  assert.match(execFileSync(binary, { encoding: 'utf8', timeout: 10000 }), /PASS real visual/);
});
