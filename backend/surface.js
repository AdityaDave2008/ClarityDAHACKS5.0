import { pointInZone, ZONE } from './alerts.js';

// ADE20K classes (SegFormer-b0) that a person can normally walk on.
export const WALKABLE_LABELS = Object.freeze([
  'floor', 'road', 'sidewalk', 'earth', 'grass', 'path', 'rug', 'field', 'sand', 'dirt track', 'land', 'runway',
]);
// Classes that block or change the walking surface. Stair-like classes use a lower threshold.
export const HAZARD_LABELS = Object.freeze([
  'wall', 'fence', 'railing', 'column', 'pole', 'stairs', 'stairway', 'step', 'bannister', 'escalator',
  'door', 'screen door', 'signboard', 'streetlight', 'traffic light', 'ashcan', 'box', 'barrel', 'rock',
  'car', 'truck', 'bus', 'van', 'bicycle', 'minibike', 'bench', 'chair', 'table', 'water', 'swimming pool',
]);
const STAIR_LABELS = new Set(['stairs', 'stairway', 'step', 'escalator']);
const walkable = new Set(WALKABLE_LABELS);
const hazard = new Set(HAZARD_LABELS);

export const SURFACE_THRESHOLDS = Object.freeze({ hazard: 0.25, stairs: 0.12, minReported: 0.05 });

/**
 * Summarize a per-pixel class map inside the walking zone.
 * labelMap: Uint8Array/Uint16Array of class ids, row-major, width x height.
 * Returns ratios of zone pixels; this is image area, not distance.
 */
export function analyzeSurface(labelMap, width, height, id2label, polygon = ZONE) {
  const counts = new Map();
  let total = 0, walk = 0;
  for (let y = 0; y < height; y++) {
    const ny = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      if (!pointInZone({ x: (x + 0.5) / width, y: ny }, polygon)) continue;
      const label = id2label[labelMap[y * width + x]]?.trim();
      total++;
      if (walkable.has(label)) walk++;
      else if (hazard.has(label)) counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  if (!total) return { walkableRatio: 0, hazards: [], warning: null };
  const hazards = [...counts]
    .map(([label, n]) => ({ label, ratio: Math.round((n / total) * 1000) / 1000 }))
    .filter((item) => item.ratio >= SURFACE_THRESHOLDS.minReported)
    .sort((a, b) => b.ratio - a.ratio);
  const warning = hazards.find((item) => item.ratio >= (STAIR_LABELS.has(item.label) ? SURFACE_THRESHOLDS.stairs : SURFACE_THRESHOLDS.hazard)) || null;
  return { walkableRatio: Math.round((walk / total) * 1000) / 1000, hazards, warning };
}
