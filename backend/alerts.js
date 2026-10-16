export const SUPPORTED_LABELS = Object.freeze([
  'person', 'bicycle', 'car', 'motorcycle', 'bus', 'truck', 'bench', 'cat',
  'dog', 'backpack', 'handbag', 'suitcase', 'bottle', 'cup', 'chair', 'potted plant',
]);
const supported = new Set(SUPPORTED_LABELS);

// Image coordinates only. This is not a measured walking corridor or ground plane.
export const ZONE = Object.freeze([
  Object.freeze({ x: 0.38, y: 0.42 }), Object.freeze({ x: 0.62, y: 0.42 }),
  Object.freeze({ x: 0.95, y: 1 }), Object.freeze({ x: 0.05, y: 1 }),
]);

export function pointInZone(point, polygon = ZONE) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j];
    const b = polygon[i];
    const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
    if (Math.abs(cross) < 1e-10 && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x) && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function assessDetections(predictions, width, height, threshold = 0.6) {
  if (!(width > 0 && height > 0) || !Number.isFinite(width + height)) return [];
  return predictions.flatMap((prediction) => {
    const { class: label, score: confidence, bbox } = prediction;
    if (!supported.has(label) || !Number.isFinite(confidence) || confidence < threshold || confidence > 1) return [];
    if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) return [];
    const [x, y, w, h] = bbox;
    if (w <= 0 || h <= 0) return [];
    const left = Math.max(0, x), top = Math.max(0, y);
    const right = Math.min(width, x + w), bottom = Math.min(height, y + h);
    if (right <= left || bottom <= top) return [];
    const box = { x: left / width, y: top / height, width: (right - left) / width, height: (bottom - top) / height };
    const anchor = { x: box.x + box.width / 2, y: box.y + box.height };
    return [{ label, confidence, bbox: box, anchor, inZone: pointInZone(anchor) }];
  });
}

function center(item) { return { x: item.bbox.x + item.bbox.width / 2, y: item.bbox.y + item.bbox.height / 2 }; }

export function createAlertPolicy({ cooldownMs = 3000, maxGapMs = 2500, confirmations = 2 } = {}) {
  let candidate = null;
  let lastAlertAt = -Infinity;
  return {
    reset() { candidate = null; lastAlertAt = -Infinity; },
    breakStreak() { candidate = null; },
    update(detections, now) {
      const cooldownRemainingMs = Math.max(0, Math.ceil(cooldownMs - (now - lastAlertAt)));
      const result = (reason, triggered = false) => ({ triggered, reason, modalities: [], message: triggered ? 'Object in camera zone. Check your surroundings.' : null, cooldownRemainingMs: triggered ? cooldownMs : cooldownRemainingMs });
      const items = detections.filter((item) => item.inZone).sort((a, b) => b.confidence - a.confidence);
      const match = candidate && now - candidate.seenAt <= maxGapMs
        ? items.find((item) => { const a = center(item), b = center(candidate.item); return item.label === candidate.item.label && Math.hypot(a.x - b.x, a.y - b.y) < 0.18; })
        : null;
      const next = match || items[0];
      if (!next) { candidate = null; return result('no_candidate'); }
      candidate = { item: next, seenAt: now, count: match ? candidate.count + 1 : 1 };
      if (candidate.count < confirmations) return result('confirming');
      if (cooldownRemainingMs > 0) return result('cooldown');
      lastAlertAt = now;
      return result('triggered', true);
    },
  };
}
