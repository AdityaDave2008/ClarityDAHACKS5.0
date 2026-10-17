import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('main header uses the exact approved coral eye without duplicating its accessible name', () => {
  const header = read('./index.html').match(/<header>[\s\S]*?<\/header>/)?.[0];
  assert.match(header, /<img\s+class="logo"\s+src="\/icons\/clarity-eye.png"\s+alt=""\s+width="52"\s+height="52"\s*>/);
  assert.match(header, />\s*Clarity\s*<\/div>/);
  assert.doesNotMatch(header, /<span class="logo">C<\/span>/);
  const asset = new URL('./icons/clarity-eye.png', import.meta.url);
  assert.ok(existsSync(asset), 'approved header logo is shipped');
  assert.equal(createHash('sha256').update(readFileSync(asset)).digest('hex'), 'be2319576af5fed17dca061dc162469e3bb09e6cf5e311c39cbdfc07ab541dea');
});

test('header logo preserves its footprint without cropping or recoloring the supplied image', () => {
  const rule = read('./homePage.css').match(/\.logo\s*\{([^}]+)\}/)?.[1];
  assert.match(rule, /width:\s*52px/);
  assert.match(rule, /height:\s*52px/);
  assert.match(rule, /object-fit:\s*contain/);
  assert.doesNotMatch(rule, /background:|border-radius:|filter:/);
});
