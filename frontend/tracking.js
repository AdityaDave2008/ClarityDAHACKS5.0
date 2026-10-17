// Browser adaptation of ByteTrack's two-stage association algorithm.
// See ../docs/TRACKING.md for differences, attribution, and upstream MIT notice.

export function intersectionOverUnion(a, b) {
  const intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return intersection / Math.max(1e-12, a.width * a.height + b.width * b.height - intersection);
}

// Rectangular Hungarian assignment, padded with unmatched alternatives. A
// rejected edge can never consume a detection needed by a valid assignment.
function associate(tracks, detections, maxCost, fuseScore = false) {
  if (!tracks.length || !detections.length) return { matches: [], tracks, detections };
  const n = tracks.length, m = detections.length + n;
  const costs = tracks.map(t => [
    ...detections.map(d => t.label === d.label
      ? 1 - intersectionOverUnion(t.predicted, d.bbox) * (fuseScore ? d.confidence : 1) : 1e6),
    ...Array(n).fill(maxCost + 1e-6),
  ]);
  for (const row of costs) for (let j = 0; j < detections.length; j++) {
    if (row[j] > maxCost) row[j] = 1e6;
  }
  const u = Array(n + 1).fill(0), v = Array(m + 1).fill(0), p = Array(m + 1).fill(0), way = Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const min = Array(m + 1).fill(Infinity), used = Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= m; j++) if (!used[j]) {
        const cur = costs[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < min[j]) { min[j] = cur; way[j] = j0; }
        if (min[j] < delta) { delta = min[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else min[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const matches = [], usedTracks = new Set(), usedDetections = new Set();
  for (let j = 1; j <= detections.length; j++) if (p[j] && costs[p[j] - 1][j - 1] <= maxCost) {
    matches.push([tracks[p[j] - 1], detections[j - 1]]);
    usedTracks.add(tracks[p[j] - 1]); usedDetections.add(detections[j - 1]);
  }
  return { matches, tracks: tracks.filter(t => !usedTracks.has(t)), detections: detections.filter(d => !usedDetections.has(d)) };
}

// Four independent constant-velocity Kalman filters for center x/y and width/
// height. This deliberately avoids shipping Python, torch, or a native solver.
class BoxFilter {
  constructor(box) {
    this.axes = [box.x + box.width / 2, box.y + box.height / 2, box.width, box.height]
      .map(value => ({ value, velocity: 0, a: .01, b: 0, c: .1 }));
  }
  predict(dt) {
    for (const axis of this.axes) {
      axis.value += axis.velocity * dt;
      axis.a += 2 * dt * axis.b + dt * dt * axis.c + .0001 * dt;
      axis.b += dt * axis.c;
      axis.c += .001 * dt;
    }
    const [x, y, width, height] = this.axes.map(a => a.value);
    return { x: x - width / 2, y: y - height / 2, width: Math.max(.001, width), height: Math.max(.001, height) };
  }
  correct(box) {
    const values = [box.x + box.width / 2, box.y + box.height / 2, box.width, box.height];
    this.axes.forEach((axis, index) => {
      const residual = values[index] - axis.value, s = axis.a + .001;
      const k0 = axis.a / s, k1 = axis.b / s, oldA = axis.a, oldB = axis.b;
      axis.value += k0 * residual; axis.velocity += k1 * residual;
      axis.a -= k0 * oldA; axis.b -= k0 * oldB; axis.c -= k1 * oldB;
    });
  }
}

export class ObjectTracker {
  constructor(options = {}) {
    this.options = { highThreshold: .5, lowThreshold: .1, newTrackThreshold: .6,
      matchThreshold: .8, lowMatchThreshold: .5, maxLostMs: 1500, minHits: 2, ...options };
    this.reset();
  }
  reset() { this.tracks = []; this.nextId = 1; this.lastTime = null; }
  update(detections, now = performance.now()) {
    const o = this.options;
    if (!Number.isFinite(now) || (this.lastTime !== null && now < this.lastTime)) throw new Error('Tracker requires monotonic milliseconds');
    const dt = this.lastTime === null ? 0 : Math.min(1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.tracks = this.tracks.filter(t => now - t.lastSeen <= o.maxLostMs);
    for (const t of this.tracks) { t.predicted = t.filter.predict(dt); t.observed = false; }
    const valid = detections.filter(d => typeof d.label === 'string' && Number.isFinite(d.confidence)
      && d.bbox && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(d.bbox[k]))
      && d.bbox.width > 0 && d.bbox.height > 0);
    const high = valid.filter(d => d.confidence >= o.highThreshold);
    const low = valid.filter(d => d.confidence >= o.lowThreshold && d.confidence < o.highThreshold);
    const confirmed = this.tracks.filter(t => t.confirmed), tentative = this.tracks.filter(t => !t.confirmed);
    const first = associate(confirmed, high, o.matchThreshold, true);
    const second = associate(first.tracks.filter(t => t.status === 'tracked'), low, o.lowMatchThreshold);
    const third = associate(tentative, first.detections, .7, true);
    for (const [t, d] of [...first.matches, ...second.matches, ...third.matches]) {
      t.filter.correct(d.bbox); t.detection = { ...d, bbox: { ...d.bbox } };
      t.hits++; t.lastSeen = now; t.observed = true; t.status = 'tracked';
      t.confirmed = t.hits >= o.minHits;
    }
    // Tentative tracks need consecutive evidence. Lost confirmed tracks can be
    // recovered by high-confidence detections, but never by low-only detections.
    this.tracks = this.tracks.filter(t => t.confirmed || t.observed);
    for (const t of this.tracks) if (!t.observed) t.status = 'lost';
    for (const d of third.detections) if (d.confidence >= o.newTrackThreshold) {
      const filter = new BoxFilter(d.bbox);
      this.tracks.push({ trackId: this.nextId++, label: d.label, filter, predicted: { ...d.bbox },
        detection: { ...d, bbox: { ...d.bbox } }, hits: 1, confirmed: o.minHits <= 1,
        firstSeen: now, lastSeen: now, observed: true, status: 'tracked' });
    }
    return this.tracks.filter(t => t.observed).map(t => ({ ...t.detection,
      trackId: t.trackId, hits: t.hits, confirmed: t.confirmed, age: now - t.firstSeen, status: t.status }));
  }
}
