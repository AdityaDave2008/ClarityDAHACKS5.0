/** Pure experimental depth geometry. No default camera intrinsics or object-size priors.
 * Coordinates: normalized top-left image, square pixels, centered principal point,
 * no crop/mirror/distortion. Camera ray is [right, down, forward]. Pitch is radians
 * down from horizontal; roll is clockwise rotation of camera axes around forward.
 * Times are milliseconds on one shared monotonic clock. Callers must invalidate
 * calibration on lens/zoom/crop changes even if deviceId/resolution do not change.
 * Bounds are deterministic perturbation envelopes, NOT calibrated probabilities.
 */
const finite = Number.isFinite;
const inRange = (v, lo, hi) => finite(v) && v >= lo && v <= hi;
const identity = a => a && Number.isInteger(a.frameSequence) && a.frameSequence >= 0 && finite(a.capturedAt) && a.capturedAt >= 0 && (typeof a.calibrationRevision === 'string' || finite(a.calibrationRevision)) && String(a.calibrationRevision).length > 0;
const sameIdentity = (a, b) => ['frameSequence', 'capturedAt', 'calibrationRevision'].every(k => a[k] === b[k]);
const unavailable = (source, reason, meta = {}) => ({ kind: 'unavailable', source, reason, ...meta });
const round = n => Math.round(n * 100) / 100;
function metric(source, meters, lower, upper, meta) {
  if (![meters, lower, upper].every(finite) || lower < .1 || upper > 20 || lower > meters || meters > upper || (upper - lower) / meters > .5) return unavailable(source, 'excessive-uncertainty-or-range', meta);
  return { kind: 'estimated', source, reason: null, ...meta, quantity: 'optical-axis-depth', uncertainty: 'bounded-perturbation-not-probability', meters: round(meters), lowerMeters: Math.floor(lower * 100) / 100, upperMeters: Math.ceil(upper * 100) / 100 };
}

/** Reference must be perpendicular to optical axis at measured axial distance,
 * centered, with known vertical image fraction. Returns radians or null. */
export function verticalFovFromReference({ referenceHeightM, distanceM, fractionOfImageHeight } = {}) {
  if (!inRange(referenceHeightM, .001, 100) || !inRange(distanceM, .01, 100) || !inRange(fractionOfImageHeight, .01, 1)) return null;
  const fov = 2 * Math.atan(referenceHeightM / (2 * distanceM * fractionOfImageHeight));
  return inRange(fov, .2, 2.5) ? fov : null;
}

/** See module conventions. Calibration requires measured verticalFovRad,
 * cameraHeightM and explicit nonnegative height/pitch/FOV uncertainty values.
 * A minimum 1cm / 0.5deg / 0.5deg floor prevents claims of exact calibration.
 * Roll has a fixed 0.5deg perturbation floor. Anchor has a +/-2 pixel floor.
 */
export function estimateGroundDepth({ anchor: a, calibration: c, attitude: t, frame: f, now } = {}) {
  const source = 'camera-geometry';
  const meta = { frameSequence: f?.sequence, capturedAt: f?.capturedAt, calibrationRevision: c?.revision };
  const reject = reason => unavailable(source, reason, meta);
  if (!c || c.projectionMeasured !== true || c.groundPlaneDeclared !== true || !identity(meta)) return reject('missing-calibration');
  if (!f || !Number.isInteger(f.width) || !Number.isInteger(f.height) || f.width < 16 || f.height < 16 || typeof f.deviceId !== 'string' || !f.deviceId || typeof f.orientation !== 'string' || !f.orientation || ['width', 'height', 'deviceId', 'orientation'].some(k => c[k] !== f[k])) return reject('calibration-frame-mismatch');
  if (!a || a.groundContact !== true || !inRange(a.x, 0, 1) || !inRange(a.y, 0, 1)) return reject('ground-contact-not-established');
  if (!finite(now) || !inRange(now - f.capturedAt, 0, 500)) return reject('stale-frame');
  if (!t || !inRange(now - t.timestamp, 0, 250) || Math.abs(t.timestamp - f.capturedAt) > 250 || !inRange(t.pitchRad, -Math.PI / 3, Math.PI / 3) || !inRange(t.rollRad, -.25, .25)) return reject('invalid-or-stale-attitude');
  if (!inRange(c.cameraHeightM, .2, 3) || !inRange(c.verticalFovRad, .2, 2.5) || !inRange(c.heightUncertaintyM, 0, .5) || !inRange(c.pitchUncertaintyRad, 0, .15) || !inRange(c.fovUncertaintyRad, 0, .15)) return reject('invalid-calibration-uncertainty');
  const dh = Math.max(.01, c.heightUncertaintyM), dp = Math.max(Math.PI / 360, c.pitchUncertaintyRad), df = Math.max(Math.PI / 360, c.fovUncertaintyRad), dr = Math.PI / 360;
  // Interval arithmetic encloses every perturbation, including interior extrema.
  const mul = (u, v) => { const p = u.flatMap(x => v.map(y => x * y)); return [Math.min(...p), Math.max(...p)]; };
  const sin = ([lo, hi]) => [Math.sin(lo), Math.sin(hi)]; // bounded within +/-pi/2
  const cos = ([lo, hi]) => [Math.min(Math.cos(lo), Math.cos(hi)), lo <= 0 && hi >= 0 ? 1 : Math.max(Math.cos(lo), Math.cos(hi))];
  const p = [t.pitchRad - dp, t.pitchRad + dp], r = [t.rollRad - dr, t.rollRad + dr];
  if (c.verticalFovRad - df <= 0 || c.verticalFovRad + df >= Math.PI || c.cameraHeightM - dh <= 0) return reject('invalid-perturbation');
  const focal = [Math.tan((c.verticalFovRad - df) / 2), Math.tan((c.verticalFovRad + df) / 2)];
  const x = mul([(2 * a.x - 1 - 4 / f.width) * f.width / f.height, (2 * a.x - 1 + 4 / f.width) * f.width / f.height], focal);
  const y = mul([2 * a.y - 1 - 4 / f.height, 2 * a.y - 1 + 4 / f.height], focal);
  const xr = mul(x, sin(r)), yr = mul(y, cos(r));
  const down = mul([xr[0] + yr[0], xr[1] + yr[1]], cos(p));
  const sp = sin(p), denom = [sp[0] + down[0], sp[1] + down[1]];
  const rayX = (2 * a.x - 1) * f.width / f.height * Math.tan(c.verticalFovRad / 2);
  const rayY = (2 * a.y - 1) * Math.tan(c.verticalFovRad / 2);
  const d = Math.sin(t.pitchRad) + Math.cos(t.pitchRad) * (rayX * Math.sin(t.rollRad) + rayY * Math.cos(t.rollRad));
  if (denom[0] <= .08 || d <= .08) return reject('near-or-above-horizon');
  return metric(source, c.cameraHeightM / d, (c.cameraHeightM - dh) / denom[1], (c.cameraHeightM + dh) / denom[0], meta);
}

const median = values => { const a = [...values].sort((x, y) => x - y); const i = Math.floor(a.length / 2); return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2; };
function robustLine(anchors) {
  const slopes = [];
  for (let i = 0; i < anchors.length; i++) for (let j = i + 1; j < anchors.length; j++) {
    const dx = anchors[j].relative - anchors[i].relative;
    if (Math.abs(dx) > 1e-10) slopes.push((1 / anchors[j].meters - 1 / anchors[i].meters) / dx);
  }
  const slope = median(slopes);
  return { slope, intercept: median(anchors.map(a => 1 / a.meters - slope * a.relative)) };
}
const acceptedFits = new WeakSet();
/** Raw model inverse-depth -> inverse optical metres. Rejects rather than silently
 * dropping bad anchors. >=4 distinct IDs, >=0.05 image separation, >=1.5x depth
 * spread, positive Theil-Sen slope, <=10% residual, <=15% leave-one-out error.
 * References must declare quantity:'optical-axis-depth', have valid physical/geometry
 * intervals and same frame. Arbitrary box bottoms are not ground contacts.
 * Fit is immutable and in-memory only: never restore a scale from another scene.
 */
export function fitInverseDepth(anchors) {
  const source = 'camera-model';
  const reject = reason => unavailable(source, reason);
  if (!Array.isArray(anchors) || anchors.length < 4 || anchors.length > 64) return reject('insufficient-independent-anchors');
  for (const a of anchors) {
    if (!a || !identity(a) || !sameIdentity(a, anchors[0]) || typeof a.id !== 'string' || !a.id || !inRange(a.x, 0, 1) || !inRange(a.y, 0, 1) || !finite(a.relative) || !['estimated', 'measured'].includes(a.kind) || a.quantity !== 'optical-axis-depth' || a.groundContact !== true || !inRange(a.lowerMeters, .1, 20) || !inRange(a.meters, a.lowerMeters, 20) || !inRange(a.upperMeters, a.meters, 20) || (a.upperMeters - a.lowerMeters) / a.meters > .5) return reject('invalid-or-mixed-anchor');
  }
  for (let i = 0; i < anchors.length; i++) for (let j = i + 1; j < anchors.length; j++) if (anchors[i].id === anchors[j].id || Math.hypot(anchors[i].x - anchors[j].x, anchors[i].y - anchors[j].y) < .05) return reject('dependent-anchors');
  const depths = anchors.map(a => a.meters);
  if (Math.max(...depths) / Math.min(...depths) < 1.5) return reject('insufficient-depth-spread');
  const line = robustLine(anchors);
  if (!finite(line.slope) || line.slope <= 0 || !finite(line.intercept)) return reject('nonpositive-slope');
  let errorInverse = 0;
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i], inv = 1 / a.meters, predicted = line.slope * a.relative + line.intercept;
    const held = robustLine(anchors.filter((_, j) => i !== j));
    const heldPrediction = held.slope * a.relative + held.intercept;
    if (held.slope <= 0 || !finite(heldPrediction) || heldPrediction <= 0 || predicted <= 0 || Math.abs(1 / predicted - a.meters) / a.meters > .1 || Math.abs(1 / heldPrediction - a.meters) / a.meters > .15) return reject('residual-or-heldout-disagreement');
    errorInverse = Math.max(errorInverse, Math.abs(predicted - inv), Math.abs(heldPrediction - inv), Math.abs(inv - 1 / a.lowerMeters), Math.abs(inv - 1 / a.upperMeters));
  }
  const fit = Object.freeze({ kind: 'fit', source, ...line, errorInverse: Math.max(errorInverse, .005), minRelative: Math.min(...anchors.map(a => a.relative)), maxRelative: Math.max(...anchors.map(a => a.relative)), frameSequence: anchors[0].frameSequence, capturedAt: anchors[0].capturedAt, calibrationRevision: anchors[0].calibrationRevision, anchorCount: anchors.length });
  acceptedFits.add(fit);
  return fit;
}

/** Relative sample is {value,frameSequence,capturedAt,calibrationRevision}.
 * Identity is mandatory. Caller must separately enforce current frame freshness
 * and discard on stop/calibration changes, as this pure conversion has no clock.
 */
export function estimateModelDepth(relative, fit) {
  const source = 'camera-model';
  if (!fit || !acceptedFits.has(fit)) return unavailable(source, 'unaccepted-fit');
  const meta = { frameSequence: fit.frameSequence, capturedAt: fit.capturedAt, calibrationRevision: fit.calibrationRevision };
  if (!identity(relative) || !sameIdentity(relative, fit) || !inRange(relative.value, fit.minRelative, fit.maxRelative)) return unavailable(source, 'frame-mismatch-or-extrapolation', meta);
  const inverse = fit.slope * relative.value + fit.intercept;
  if (inverse <= fit.errorInverse) return unavailable(source, 'invalid-inverse-depth', meta);
  return metric(source, 1 / inverse, 1 / (inverse + fit.errorInverse), 1 / (inverse - fit.errorInverse), meta);
}
