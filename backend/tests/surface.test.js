import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSurface } from '../surface.js';

const id2label = { 0: 'wall', 3: 'floor', 11: 'sidewalk', 53: 'stairs', 2: 'sky' };

function map(width, height, fill) {
  const labels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) labels[y * width + x] = fill(x / width, y / height);
  return labels;
}

test('an all-walkable corridor has no warning', () => {
  const result = analyzeSurface(map(40, 40, () => 11), 40, 40, id2label);
  assert.equal(result.walkableRatio, 1);
  assert.deepEqual(result.hazards, []);
  assert.equal(result.warning, null);
});

test('a wall filling the far half of the corridor warns', () => {
  const result = analyzeSurface(map(40, 40, (_x, y) => (y < 0.7 ? 0 : 3)), 40, 40, id2label);
  assert.equal(result.warning.label, 'wall');
  assert.ok(result.warning.ratio >= 0.25);
  assert.ok(result.walkableRatio < 0.75);
});

test('stairs warn at a lower share than other hazards', () => {
  const result = analyzeSurface(map(40, 40, (_x, y) => (y > 0.94 ? 53 : 3)), 40, 40, id2label);
  assert.equal(result.warning?.label, 'stairs');
  assert.ok(result.warning.ratio < 0.25);
});

test('pixels outside the zone are ignored', () => {
  // Wall only in the top 40% of the image, above the zone (which starts at y = 0.42).
  const result = analyzeSurface(map(40, 40, (_x, y) => (y < 0.4 ? 0 : 3)), 40, 40, id2label);
  assert.equal(result.warning, null);
  assert.equal(result.walkableRatio, 1);
});
