import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('production floor calibration validates provenance and exact pixel/radial mappings', { skip: process.platform !== 'darwin' }, () => {
  const scratch = process.env.JCODE_SCRATCH_DIR || join(homedir(), '.jcode', 'scratch');
  mkdirSync(scratch, { recursive: true });
  const binary = join(mkdtempSync(join(scratch, 'floor-calibration-')), 'tests');
  const files = ['../MyEyes/FloorCalibration.swift', './FloorCalibrationTests.swift'].map(path => fileURLToPath(new URL(path, import.meta.url)));
  const compile = spawnSync('swiftc', ['-parse-as-library', ...files, '-o', binary], { encoding: 'utf8' });
  assert.equal(compile.status, 0, compile.stderr);
  const run = spawnSync(binary, [], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /Floor calibration tests passed/);
});
