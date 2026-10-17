import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('production proximity contract and policy execute without an app build', { skip: process.platform !== 'darwin' }, () => {
  const scratch = process.env.JCODE_SCRATCH_DIR || join(homedir(), '.jcode', 'scratch');
  mkdirSync(scratch, { recursive: true });
  const binary = join(mkdtempSync(join(scratch, 'proximity-tests-')), 'tests');
  const sources = ['APIClient.swift', 'ProximityPolicy.swift'].map(name => fileURLToPath(new URL(`../MyEyes/${name}`, import.meta.url)));
  const build = spawnSync('swiftc', ['-parse-as-library', ...sources, fileURLToPath(new URL('./ProximityPolicyTests.swift', import.meta.url)), '-o', binary], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const run = spawnSync(binary, [], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /proximity settings, freshness, association, hysteresis and closest passed/);
});

test('native visual source matrix executes without an app build', { skip: process.platform !== 'darwin' }, () => {
  const scratch = process.env.JCODE_SCRATCH_DIR || join(homedir(), '.jcode', 'scratch');
  mkdirSync(scratch, { recursive: true });
  const binary = join(mkdtempSync(join(scratch, 'visual-proximity-tests-')), 'tests');
  const sources = ['APIClient.swift', 'ProximityPolicy.swift'].map(name => fileURLToPath(new URL(`../MyEyes/${name}`, import.meta.url)));
  const build = spawnSync('swiftc', ['-parse-as-library', ...sources, fileURLToPath(new URL('./VisualProximityTests.swift', import.meta.url)), '-o', binary], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const run = spawnSync(binary, [], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /visual proximity matrix passed/);
});
