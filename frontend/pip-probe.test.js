import test from 'node:test';
import assert from 'node:assert/strict';
import { createPiPProbe, enterPiP, mayContinue, pipActive } from './pip-probe.js';

test('PiP permits a hidden experiment while a hidden page without PiP stops', () => {
  assert.equal(mayContinue(true, true), true);
  assert.equal(mayContinue(true, false), false);
  assert.equal(mayContinue(false, false), true);
  const video = {};
  assert.equal(pipActive(video, { pictureInPictureElement: video }), true);
  assert.equal(pipActive({ webkitPresentationMode: 'picture-in-picture' }, {}), true);
  assert.equal(pipActive(video, {}), false);
});

test('opening PiP invokes supported browser API synchronously within the click gesture', async () => {
  let invoked = false;
  const result = enterPiP({ requestPictureInPicture() { invoked = true; return Promise.resolve(); } }, {});
  assert.equal(invoked, true);
  await result;
  const calls = [];
  await enterPiP({ webkitSupportsPresentationMode: () => true, webkitSetPresentationMode: mode => calls.push(mode) }, {});
  assert.deepEqual(calls, ['picture-in-picture']);
  await assert.rejects(enterPiP({}, {}), /does not offer/);
  await assert.rejects(enterPiP({ webkitSupportsPresentationMode: () => true,
    webkitSetPresentationMode() { throw new Error('Camera stream rejected'); } }, {}), /Camera stream rejected/);
});

test('frozen, muted, ended, unready or hidden-without-PiP inputs cannot become detection evidence', () => {
  const probe = createPiPProbe({ now: () => 0 });
  const frame = { currentTime: 1, readyState: 4, muted: false, trackState: 'live', hidden: true, pip: true };
  assert.equal(probe.acceptInput(frame), true);
  assert.equal(probe.acceptInput(frame), false);
  for (const invalid of [{ muted: true }, { trackState: 'ended' }, { readyState: 1 }, { pip: false }, { currentTime: NaN }]) {
    assert.equal(probe.acceptInput({ ...frame, currentTime: 2, ...invalid }), false);
  }
  probe.record('result', { hidden: true, pip: true, detail: 'chair' });
  probe.record('obstacle', { hidden: false, pip: true });
  const report = probe.snapshot();
  assert.equal(report.counts.hiddenInputs, 1);
  assert.equal(report.counts.hiddenResults, 1);
  assert.equal(report.counts.hiddenObstacleAlerts, 0);
  assert.equal(report.counts.hiddenSpeechCompleted, 0);
  assert.match(report.limitation, /do not prove/);
});
