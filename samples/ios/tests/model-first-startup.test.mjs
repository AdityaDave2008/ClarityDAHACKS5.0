import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('production startup coordinator keeps camera off until ready and fences cancellation/permission failures', { skip: process.platform !== 'darwin' }, () => {
  const scratch = process.env.JCODE_SCRATCH_DIR || join(homedir(), '.jcode', 'scratch');
  mkdirSync(scratch, { recursive: true });
  const binary = join(mkdtempSync(join(scratch, 'model-first-tests-')), 'tests');
  execFileSync('swiftc', ['-parse-as-library', fileURLToPath(new URL('../MyEyes/ModelFirstStartup.swift', import.meta.url)), fileURLToPath(new URL('ModelFirstStartupTests.swift', import.meta.url)), '-o', binary], { timeout: 60000 });
  assert.match(execFileSync(binary, { encoding: 'utf8', timeout: 15000 }), /PASS model-first startup/);
});
