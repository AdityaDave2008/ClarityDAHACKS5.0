import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

// Exercises the real Swift logger. Removing opt-in gating or exposing NSError userInfo
// must fail this test. PiP callbacks themselves still require the physical device.
test('diagnostics are opt-in and errors expose domain/code only', { skip: process.platform !== 'darwin' }, () => {
  const source = new URL('../StepSense/PiPDiagnostics.swift', import.meta.url).pathname;
  assert.ok(existsSync(source), 'privacy-safe diagnostic logger must exist');
  const scratch = process.env.JCODE_SCRATCH_DIR || join(homedir(), '.jcode', 'scratch');
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, 'pip-log-test-'));
  writeFileSync(join(dir, 'main.swift'), `import Foundation
PiPDiagnostics.log("probe", "count=3")
PiPDiagnostics.error("failure", NSError(domain: "TestDomain", code: 42, userInfo: [NSLocalizedDescriptionKey: "PRIVATE_IMAGE_OR_TEXT"]))
`);
  const binary = join(dir, 'probe');
  const build = spawnSync('swiftc', [source, join(dir, 'main.swift'), '-o', binary], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const quiet = spawnSync(binary, [], { encoding: 'utf8', env: { ...process.env, STEPSENSE_PIP_DIAGNOSTICS: '0' } });
  assert.equal(quiet.status, 0);
  assert.equal(quiet.stderr, '');
  const enabled = spawnSync(binary, [], { encoding: 'utf8', env: { ...process.env, STEPSENSE_PIP_DIAGNOSTICS: '1' } });
  assert.equal(enabled.status, 0);
  assert.match(enabled.stderr, /\[PiPDiag\].*probe count=3/);
  assert.match(enabled.stderr, /failure domain=TestDomain code=42/);
  assert.doesNotMatch(enabled.stderr, /PRIVATE_IMAGE_OR_TEXT/);
});
