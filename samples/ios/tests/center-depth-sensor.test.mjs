import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('production center sensor delivery is bounded independently of inference and preserves freshness', { skip: process.platform !== 'darwin' }, () => {
  const scratch = process.env.JCODE_SCRATCH_DIR || join(homedir(), '.jcode', 'scratch');
  mkdirSync(scratch, { recursive: true });
  const binary = join(mkdtempSync(join(scratch, 'center-depth-tests-')), 'tests');
  const sources = ['APIClient.swift', 'DepthEstimate.swift', 'CenterDepthSensor.swift'].map(name => fileURLToPath(new URL(`../MyEyes/${name}`, import.meta.url)));
  const result = spawnSync('swiftc', ['-parse-as-library', ...sources, fileURLToPath(new URL('./CenterDepthSensorTests.swift', import.meta.url)), '-o', binary], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const run = spawnSync(binary, [], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /bounded delivery, restart and freshness passed/);
});

test('an RGB fallback does not permanently suppress LiDAR setup on the next start', () => {
  const camera = readFileSync(new URL('../MyEyes/CameraCapture.swift', import.meta.url), 'utf8');
  assert.match(camera, /lidarEnabled && synchronizedDepth == nil/);
});
