import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('production proximity cadence and actual cancellable task execute', { skip: process.platform !== 'darwin' }, () => {
  const scratch = process.env.JCODE_SCRATCH_DIR || join(homedir(), '.jcode', 'scratch');
  mkdirSync(scratch, { recursive: true });
  const binary = join(mkdtempSync(join(scratch, 'feedback-tests-')), 'tests');
  const sources = ['../MyEyes/ProximityFeedback.swift', './ProximityFeedbackTests.swift'].map(name => fileURLToPath(new URL(name, import.meta.url)));
  const build = spawnSync('swiftc', ['-swift-version', '6', '-parse-as-library', ...sources, '-o', binary], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const run = spawnSync(binary, [], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /proximity cadence, modes, freshness, speech and async cancellation passed/);
});
