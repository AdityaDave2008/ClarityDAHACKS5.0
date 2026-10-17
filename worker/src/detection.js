/**
 * Detection model v1 on Cloudflare Workers AI.
 *
 * `@cf/microsoft/resnet-50` classifies the frame, and `@cf/llava-hf/llava-1.5-7b-hf`
 * estimates where that object sits.
 *
 * What this deployment does NOT do: precise bounding boxes. Two options were measured
 * against the live API before settling here.
 *
 * - `@cf/moondream/moondream3.1-9B-A2B` documents a `detect` task returning corner
 *   coordinates, but returned an empty result (`{}`) for every input form tried: byte
 *   array, base64 data URI, and public HTTPS URL, for `detect`, `caption`, and `query`.
 * - LLaVA asked directly for boxes returned all-zero coordinates.
 *
 * LLaVA does answer coarse position. Measured over six synthetic frames with a known
 * object placement, horizontal thirds were correct 4/6 and vertical halves 5/6. That is
 * useful as a hint and far too unreliable to draw a box from, so this API reports a coarse
 * region and sets `bbox` to null rather than inventing rectangles clients would render as
 * if they were measured.
 *
 * This is a different model from the Node backend's COCO-SSD and the iPhone's bundled
 * detector. Labels and confidences will not match them frame for frame.
 */

/**
 * Categories this deployment can actually return. This is a subset of the Node
 * backend's full COCO list, bounded by the ImageNet mapping below rather than by
 * client policy: the classifier cannot name anything outside these families.
 */
export const SUPPORTED_LABELS = Object.freeze([
  'person', 'bicycle', 'car', 'motorcycle', 'bus', 'truck', 'bench', 'cat',
  'dog', 'backpack', 'handbag', 'suitcase', 'bottle', 'cup', 'chair', 'potted plant',
]);

const CLASSIFIER = '@cf/microsoft/resnet-50';
const LOCATOR = '@cf/llava-hf/llava-1.5-7b-hf';

const HORIZONTAL_PROMPT = 'Is the %s in the left third, center third, or right third? '
  + 'Answer one word: left, center, or right.';
const VERTICAL_PROMPT = 'Is the %s in the upper half or the lower half of this image? '
  + 'Answer one word: upper or lower.';

/**
 * ImageNet class names differ from the COCO labels the clients expect, so map the
 * families that matter. Anything unmapped is ignored rather than guessed at.
 * The live API returns labels uppercased, so every pattern is case-insensitive.
 */
const IMAGENET_TO_LABEL = [
  [/\b(backpack|knapsack|rucksack|haversack)\b/i, 'backpack'],
  [/\b(suitcase|trunk|luggage|portmanteau)\b/i, 'suitcase'],
  [/\b(purse|handbag|pocketbook|wallet)\b/i, 'handbag'],
  [/\b(folding chair|rocking chair|barber chair|throne|chair)\b/i, 'chair'],
  [/\b(park bench|bench|studio couch)\b/i, 'bench'],
  [/\b(water bottle|pop bottle|beer bottle|wine bottle|bottle)\b/i, 'bottle'],
  [/\b(coffee mug|cup|goblet|teapot)\b/i, 'cup'],
  [/\b(mountain bike|bicycle-built-for-two|tricycle|unicycle|bicycle)\b/i, 'bicycle'],
  [/\b(moped|motor scooter|motorcycle)\b/i, 'motorcycle'],
  [/\b(school bus|trolleybus|minibus|bus)\b/i, 'bus'],
  [/\b(pickup|tow truck|trailer truck|garbage truck|fire engine|truck)\b/i, 'truck'],
  [/\b(sports car|convertible|limousine|jeep|minivan|cab|beach wagon|car)\b/i, 'car'],
  [/\b(pot|flowerpot|daisy|yellow lady's slipper)\b/i, 'potted plant'],
  [/\b(tabby|tiger cat|persian cat|siamese cat|egyptian cat)\b/i, 'cat'],
  [/\b(retriever|terrier|spaniel|poodle|husky|beagle|collie|chihuahua|pug|dog)\b/i, 'dog'],
];

export function mapClassifierLabel(raw) {
  const text = String(raw || '');
  for (const [pattern, label] of IMAGENET_TO_LABEL) {
    if (pattern.test(text)) return label;
  }
  return null;
}

/** Image coordinates only. Not a measured walking corridor or ground plane. */
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
    if (Math.abs(cross) < 1e-10 && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x)
      && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)) return true;
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Reads one coarse answer, accepting only the documented words. */
export function parseRegionWord(text, options) {
  const answer = String(text ?? '').toLowerCase();
  return options.find((option) => answer.includes(option)) ?? null;
}

/**
 * Builds the detection the API returns.
 *
 * `bbox` and `anchor` are null because this deployment cannot measure them. `region` is the
 * coarse estimate, and `inZone` reflects only whether that region is the lower part of the
 * frame, where the walking zone lies.
 */
export function buildDetection(label, confidence, region) {
  if (!SUPPORTED_LABELS.includes(label)) return null;
  if (!Number.isFinite(confidence) || confidence <= 0 || confidence > 1) return null;
  return {
    label,
    confidence,
    bbox: null,
    anchor: null,
    region,
    localization: 'coarse',
    inZone: region.vertical === 'lower',
  };
}

export async function askRegion(ai, image, prompt) {
  const reply = await ai.run(LOCATOR, { image, prompt, max_tokens: 8 });
  return reply?.description ?? reply?.response ?? '';
}

/**
 * Runs the pipeline for one frame.
 *
 * Classification picks the single most likely supported label. Localization is a hint and
 * must never block a detection, so a failed or unreadable position answer yields `unknown`
 * rather than discarding a real classification.
 */
export async function detectFrame(ai, bytes, confidenceThreshold) {
  const image = [...new Uint8Array(bytes)];
  const classified = await ai.run(CLASSIFIER, { image });
  const ranked = (Array.isArray(classified) ? classified : [])
    .map((item) => ({ label: mapClassifierLabel(item?.label), score: Number(item?.score) }))
    .filter((item) => item.label && Number.isFinite(item.score) && item.score >= confidenceThreshold)
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) return { detections: [], label: null };

  let region = { horizontal: 'unknown', vertical: 'unknown' };
  try {
    const [horizontal, vertical] = await Promise.all([
      askRegion(ai, image, HORIZONTAL_PROMPT.replace('%s', best.label)),
      askRegion(ai, image, VERTICAL_PROMPT.replace('%s', best.label)),
    ]);
    region = {
      horizontal: parseRegionWord(horizontal, ['left', 'center', 'right']) ?? 'unknown',
      vertical: parseRegionWord(vertical, ['upper', 'lower']) ?? 'unknown',
    };
  } catch {
    // A classification without a position is still worth reporting.
  }

  const detection = buildDetection(best.label, best.score, region);
  return { detections: detection ? [detection] : [], label: best.label };
}
