import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectTracker } from './tracking.js';

const detection = (x = .2, confidence = .9, label = 'chair') => ({ label, confidence,
  bbox: { x, y: .3, width: .2, height: .3 }, inZone: true });

test('confirms consecutive observations and preserves identity through low confidence', () => {
  const tracker = new ObjectTracker();
  const [first] = tracker.update([detection()], 0);
  assert.equal(first.confirmed, false);
  const [second] = tracker.update([detection(.21)], 100);
  assert.equal(second.confirmed, true);
  const [third] = tracker.update([detection(.22, .2)], 200);
  assert.equal(third.trackId, first.trackId);
  assert.equal(third.hits, 3);
});
test('low-confidence observations cannot create or resurrect tracks', () => {
  const tracker = new ObjectTracker({ minHits: 1 });
  assert.deepEqual(tracker.update([detection(.2, .2)], 0), []);
  const [first] = tracker.update([detection()], 100);
  assert.deepEqual(tracker.update([], 200), []);
  assert.deepEqual(tracker.update([detection(.2, .2)], 300), []);
  const [recovered] = tracker.update([detection()], 400);
  assert.equal(recovered.trackId, first.trackId);
});
test('associates multiple objects one-to-one independently of detector order', () => {
  const tracker = new ObjectTracker();
  const initial = tracker.update([detection(.1), detection(.6)], 0);
  const next = tracker.update([detection(.61), detection(.11)], 100);
  assert.equal(next.find(t => t.bbox.x === .11).trackId, initial[0].trackId);
  assert.equal(next.find(t => t.bbox.x === .61).trackId, initial[1].trackId);
});
test('expired tracks get new IDs; classes never share identity', () => {
  const tracker = new ObjectTracker({ minHits: 1, maxLostMs: 500 });
  const [first] = tracker.update([detection()], 0);
  const [other] = tracker.update([detection(.2, .9, 'person')], 100);
  assert.notEqual(other.trackId, first.trackId);
  const [expired] = tracker.update([detection()], 1000);
  assert.notEqual(expired.trackId, first.trackId);
});
test('missed tentative tracks are discarded and reset clears state', () => {
  const tracker = new ObjectTracker();
  const [first] = tracker.update([detection()], 0);
  tracker.update([], 100);
  const [next] = tracker.update([detection()], 200);
  assert.notEqual(next.trackId, first.trackId);
  assert.equal(next.confirmed, false);
  tracker.reset();
  assert.equal(tracker.update([detection()], 0)[0].trackId, 1);
  assert.throws(() => tracker.update([], -1), /monotonic/);
});
test('invalid boxes are ignored and lost tracks never produce stale alerts', () => {
  const tracker = new ObjectTracker({ minHits: 1 });
  tracker.update([detection()], 0);
  assert.deepEqual(tracker.update([{ ...detection(), bbox: { x: NaN, y: 0, width: 1, height: 1 } }], 100), []);
});
