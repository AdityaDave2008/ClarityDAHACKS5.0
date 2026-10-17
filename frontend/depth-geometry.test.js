import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateGroundDepth, fitInverseDepth, estimateModelDepth, verticalFovFromReference } from './depth-geometry.js';

const scene = () => ({
  anchor: { x: .5, y: .75, groundContact: true },
  calibration: { revision: 'cal-1', width: 640, height: 480, deviceId: 'rear', orientation: 'landscape', verticalFovRad: Math.PI / 2, cameraHeightM: 1.5, projectionMeasured: true, groundPlaneDeclared: true, heightUncertaintyM: .02, pitchUncertaintyRad: .005, fovUncertaintyRad: .01 },
  attitude: { pitchRad: 0, rollRad: 0, timestamp: 1000 },
  frame: { sequence: 1, capturedAt: 1000, width: 640, height: 480, deviceId: 'rear', orientation: 'landscape' }, now: 1000,
});
const noMeters = r => { assert.equal(r.kind, 'unavailable'); for (const key of ['meters', 'lowerMeters', 'upperMeters']) assert.equal(key in r, false); };
const anchors = () => [1, 2, 3, 4, 5].map((relative, i) => ({ id: `a${i}`, x: .1 + i * .18, y: .6 + (i % 2) * .2, relative, meters: 1 / (.15 * relative + .1), lowerMeters: .98 / (.15 * relative + .1), upperMeters: 1.02 / (.15 * relative + .1), frameSequence: 1, capturedAt: 1000, calibrationRevision: 'cal-1', kind: 'estimated', quantity: 'optical-axis-depth', groundContact: true }));
const sample = value => ({ value, frameSequence: 1, capturedAt: 1000, calibrationRevision: 'cal-1' });

test('known level ray gives optical axial depth, bounded outward interval and provenance', () => {
  const r = estimateGroundDepth(scene());
  assert.equal(r.kind, 'estimated'); assert.equal(r.meters, 3); assert.equal(r.quantity, 'optical-axis-depth');
  assert.ok(r.lowerMeters < 3 && r.upperMeters > 3); assert.equal(r.frameSequence, 1); assert.equal(r.calibrationRevision, 'cal-1');
});
test('pitched center ray intersects ground at h / sin(pitch), not horizontal range', () => {
  const s = scene(); s.anchor.y = .5; s.attitude.pitchRad = Math.PI / 6;
  assert.equal(estimateGroundDepth(s).meters, 3);
});
for (const [name, change] of Object.entries({
  missingCalibration: s => { delete s.calibration; }, mismatchedLens: s => { s.frame.deviceId = 'front'; },
  mismatchedSize: s => { s.frame.width = 1280; }, mismatchedOrientation: s => { s.frame.orientation = 'portrait'; },
  missingRevision: s => { delete s.calibration.revision; }, unmeasuredProjection: s => { s.calibration.projectionMeasured = false; },
  undeclaredPlane: s => { s.calibration.groundPlaneDeclared = false; }, falseGround: s => { s.anchor.groundContact = false; },
  staleAttitude: s => { s.attitude.timestamp = 749; }, staleFrame: s => { s.frame.capturedAt = 499; }, futureAttitude: s => { s.attitude.timestamp = 1001; },
  unsynchronizedAttitude: s => { s.frame.capturedAt = 500; }, horizon: s => { s.anchor.y = .5; }, aboveHorizon: s => { s.anchor.y = .1; },
  largeRoll: s => { s.attitude.rollRad = .5; }, uncertain: s => { s.calibration.pitchUncertaintyRad = .3; },
  nonFinite: s => { s.anchor.x = NaN; }, outOfImage: s => { s.anchor.y = 1.1; }, missingUncertainty: s => { delete s.calibration.heightUncertaintyM; },
})) test(`ground estimate fails closed: ${name}`, () => { const s = scene(); change(s); noMeters(estimateGroundDepth(s)); });
test('empty input never invents metres', () => noMeters(estimateGroundDepth()));
test('measured perpendicular centered reference yields vertical FOV in radians', () => {
  assert.ok(Math.abs(verticalFovFromReference({ referenceHeightM: 2, distanceM: 2, fractionOfImageHeight: .5 }) - Math.PI / 2) < 1e-12);
  assert.equal(verticalFovFromReference({ referenceHeightM: -1, distanceM: 2, fractionOfImageHeight: .5 }), null);
});
test('same-frame independent reference fit converts raw inverse depth', () => {
  const fit = fitInverseDepth(anchors()); assert.equal(fit.kind, 'fit'); assert.ok(Math.abs(fit.slope - .15) < 1e-12);
  const r = estimateModelDepth(sample(3), fit); assert.equal(r.kind, 'estimated'); assert.ok(Math.abs(r.meters - 1.82) < .001);
  assert.ok(r.lowerMeters < r.meters && r.upperMeters > r.meters);
});
for (const [name, change] of Object.entries({
  tooFew: a => a.slice(0, 3), mixedFrame: a => { a[0].frameSequence++; return a; }, mixedCalibration: a => { a[0].calibrationRevision = 'old'; return a; },
  duplicateId: a => { a[1].id = a[0].id; return a; }, clustered: a => a.map(v => ({ ...v, x: .5, y: .5 })),
  flatDepth: a => a.map(v => ({ ...v, meters: 2, lowerMeters: 1.98, upperMeters: 2.02 })),
  negativeSlope: a => a.map(v => ({ ...v, relative: -v.relative })),
  outlier: a => { a[2].meters = 8; a[2].lowerMeters = 7.9; a[2].upperMeters = 8.1; return a; },
  invalidMixed: a => { a[0].relative = NaN; return a; }, undeclared: a => { a[0].groundContact = false; return a; },
})) test(`inverse fit fails closed: ${name}`, () => noMeters(fitInverseDepth(change(anchors()))));
test('model conversion rejects extrapolation, stale identity and bare numbers', () => {
  const fit = fitInverseDepth(anchors());
  for (const r of [sample(.9), sample(5.1), { ...sample(3), frameSequence: 2 }, { ...sample(3), capturedAt: 1001 }, 3, null]) noMeters(estimateModelDepth(r, fit));
  noMeters(estimateModelDepth(sample(3), { kind: 'fit', slope: .15, intercept: .1 }));
});
test('small roll follows clockwise image-axis convention', () => {
  const s = scene(); s.anchor.x = .8; s.attitude.rollRad = .1;
  const expected = 1.5 / (.8 * Math.sin(.1) + .5 * Math.cos(.1));
  assert.equal(estimateGroundDepth(s).meters, Math.round(expected * 100) / 100);
});
test('perturbation envelope contains independent sampled height, pitch, FOV and roll rays', () => {
  const s = scene(); s.anchor.x = .7; s.attitude.pitchRad = .2; s.attitude.rollRad = -.1;
  const r = estimateGroundDepth(s); assert.equal(r.kind, 'estimated');
  for (const dh of [-.02, 0, .02]) for (const dp of [-Math.PI / 360, 0, Math.PI / 360]) for (const df of [-.01, 0, .01]) for (const dr of [-Math.PI / 360, 0, Math.PI / 360]) {
    const x = .4 * 640 / 480 * Math.tan((Math.PI / 2 + df) / 2), y = .5 * Math.tan((Math.PI / 2 + df) / 2);
    const depth = (1.5 + dh) / (Math.sin(.2 + dp) + Math.cos(.2 + dp) * (x * Math.sin(-.1 + dr) + y * Math.cos(-.1 + dr)));
    assert.ok(depth >= r.lowerMeters && depth <= r.upperMeters);
  }
});
test('exact four-anchor fit passes and fit cannot be mutated or serialized into acceptance', () => {
  const fit = fitInverseDepth(anchors().slice(0, 4)); assert.equal(fit.kind, 'fit');
  assert.equal(Object.isFrozen(fit), true); noMeters(estimateModelDepth(sample(2), { ...fit }));
});
test('holdout gate rejects leverage error despite an acceptable training residual', () => {
  const a = anchors().slice(0, 4);
  a[3].relative = 15; a[3].meters = 1 / (.15 * 15 + .1) * 1.18;
  a[3].lowerMeters = a[3].meters * .98; a[3].upperMeters = a[3].meters * 1.02;
  noMeters(fitInverseDepth(a));
});
test('ground uncertainty and inverse fit reject nonfinite values without throwing', () => {
  for (const value of [NaN, Infinity, -Infinity, undefined]) {
    const s = scene(); s.calibration.verticalFovRad = value; noMeters(estimateGroundDepth(s));
    const a = anchors(); a[0].upperMeters = value; noMeters(fitInverseDepth(a));
  }
  noMeters(fitInverseDepth([null, ...anchors()]));
});
test('references explicitly identify optical axial metres, not ground range or unspecified units', () => {
  for (const quantity of [undefined, 'ground-range', 'euclidean-range']) {
    const a = anchors(); a[0].quantity = quantity; noMeters(fitInverseDepth(a));
  }
});
test('plausible calibration perturbations reject a wide or horizon-crossing interval', () => {
  const wide = scene(); wide.calibration.pitchUncertaintyRad = .15; noMeters(estimateGroundDepth(wide));
  const horizon = scene(); horizon.anchor.y = .55; horizon.calibration.pitchUncertaintyRad = .12; noMeters(estimateGroundDepth(horizon));
});
test('accepted scene grid always has finite ordered bounds and explicit units', () => {
  let accepted = 0;
  for (const x of [.1, .5, .9]) for (const y of [.4, .6, .9]) for (const pitch of [-.2, 0, .4]) {
    const s = scene(); s.anchor.x = x; s.anchor.y = y; s.attitude.pitchRad = pitch;
    const r = estimateGroundDepth(s);
    if (r.kind === 'unavailable') { noMeters(r); continue; }
    accepted++;
    assert.equal(r.quantity, 'optical-axis-depth');
    assert.ok([r.lowerMeters, r.meters, r.upperMeters].every(Number.isFinite));
    assert.ok(r.lowerMeters <= r.meters && r.meters <= r.upperMeters);
  }
  assert.ok(accepted > 10);
});
test('attitude timestamps require finite numbers without coercion', () => {
  for (const timestamp of [null, '1000', true, false, '', [], [1000], NaN, Infinity, -Infinity, -1]) {
    const s = scene(); s.attitude.timestamp = timestamp;
    if (timestamp !== '1000' && !(Array.isArray(timestamp) && timestamp.length)) { s.now = 0; s.frame.capturedAt = 0; }
    noMeters(estimateGroundDepth(s));
  }
});
test('fit envelope combines residual and reference uncertainty around exact affine truth', () => {
  const a = anchors().map((anchor, i) => {
    const truth = 1 / (.15 * anchor.relative + .1);
    const meters = truth * (1 + .06 * Math.sin(78 + i * 7));
    return { ...anchor, kind: 'measured', meters, lowerMeters: Math.min(truth, meters) * .999, upperMeters: Math.max(truth, meters) * 1.001 };
  });
  const fit = fitInverseDepth(a); assert.equal(fit.kind, 'fit');
  for (const value of [1, 2, 3, 4, 5]) {
    const out = estimateModelDepth(sample(value), fit);
    const truth = 1 / (.15 * value + .1);
    if (out.kind === 'unavailable') noMeters(out);
    else assert.ok(out.lowerMeters <= truth && truth <= out.upperMeters, `${truth} outside [${out.lowerMeters}, ${out.upperMeters}]`);
  }
});
