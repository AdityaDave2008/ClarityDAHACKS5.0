// The full COCO vocabulary the detectors are trained on. A narrow whitelist
// silently discarded correct predictions: on the v2 candidate it hid 64 of 80
// classes, so whole scenes (a stop sign, a bed, a TV) reported nothing at all.
const SUPPORTED_LABELS = Object.freeze([
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
  'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat',
  'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack',
  'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball',
  'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket',
  'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
  'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair',
  'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
  'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
  'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier',
  'toothbrush',
]);
const supported = new Set(SUPPORTED_LABELS);

// Image coordinates only. This is not a measured walking corridor or ground plane.
const ZONE = Object.freeze([
  Object.freeze({ x: 0.38, y: 0.42 }), Object.freeze({ x: 0.62, y: 0.42 }),
  Object.freeze({ x: 0.95, y: 1 }), Object.freeze({ x: 0.05, y: 1 }),
]);

function pointInZone(point, polygon = ZONE) {
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

function assessDetections(predictions, width, height, threshold = 0.6) {
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

function createAlertPolicy({ cooldownMs = 3000, maxGapMs = 2500, confirmations = 2 } = {}) {
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
