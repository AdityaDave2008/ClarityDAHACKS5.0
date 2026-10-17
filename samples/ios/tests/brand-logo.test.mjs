import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('native brand packages the exact user-approved coral eye artwork', () => {
  const root = new URL('../MyEyes/Assets.xcassets/ClarityLogo.imageset/', import.meta.url);
  const manifest = new URL('Contents.json', root);
  assert.ok(existsSync(manifest), 'ClarityLogo asset must be packaged');
  const { images } = JSON.parse(readFileSync(manifest, 'utf8'));
  assert.equal(images[0].filename, 'ClarityLogo.png');
  const bytes = readFileSync(new URL(images[0].filename, root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    'be2319576af5fed17dca061dc162469e3bb09e6cf5e311c39cbdfc07ab541dea');
});
