// Shared normalization and alert policy for observed tracks, never predictions.
export const LABELS = new Set(['person', 'bicycle', 'car', 'motorcycle', 'bus', 'truck', 'bench', 'cat', 'dog', 'backpack', 'handbag', 'suitcase', 'bottle', 'cup', 'chair', 'potted plant']);
export function pointInZone(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function normalizeLocal(result, zone) {
  return result.detections.flatMap((detection) => {
    const category = detection.categories?.[0];
    const label = category?.categoryName;
    const confidence = category?.score;
    const raw = detection.boundingBox;
    if (!LABELS.has(label) || !Number.isFinite(confidence) || !raw || confidence < .1) return [];
    const x = Math.max(0, raw.originX / result.width), y = Math.max(0, raw.originY / result.height);
    const right = Math.min(1, (raw.originX + raw.width) / result.width), bottom = Math.min(1, (raw.originY + raw.height) / result.height);
    if (right <= x || bottom <= y) return [];
    const bbox = { x, y, width: right - x, height: bottom - y };
    const anchor = { x: (x + right) / 2, y: bottom };
    return [{ label, confidence, bbox, anchor, inZone: pointInZone(anchor, zone) }];
  });
}
export class TrackAlertPolicy {
  constructor() { this.reset(); }
  reset() { this.lastAlertAt = -Infinity; this.previous = null; }
  update(tracks, now, modalities) {
    const candidates = tracks.filter((t) => t.inZone && t.confirmed && t.confidence >= .5);
    const candidate = candidates.sort((a, b) => b.bbox.width * b.bbox.height - a.bbox.width * a.bbox.height)[0];
    const remaining = Math.max(0, 3000 - (now - this.lastAlertAt));
    if (!candidate) { this.previous = null; return { triggered: false, reason: tracks.some(t => t.inZone) ? 'confirming' : 'no_candidate' }; }
    if (remaining) return { triggered: false, reason: 'cooldown', cooldownRemainingMs: remaining };
    const center = candidate.bbox.x + candidate.bbox.width / 2;
    const direction = center < .4 ? 'left' : center > .6 ? 'right' : 'ahead';
    const message = `${candidate.label} ${direction}. Check your surroundings.`;
    this.lastAlertAt = now;
    return { triggered: true, reason: 'triggered', message, modalities };
  }
}
