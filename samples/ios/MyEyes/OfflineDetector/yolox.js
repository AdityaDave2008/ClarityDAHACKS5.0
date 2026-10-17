'use strict';
const CANDIDATE_THRESHOLD = 0.7874982953071594;
const COCO_LABELS = ["person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush"];
// OpenCV-style half-pixel bilinear resize, uint8 rounding, top-left pad, BGR CHW.
function preprocessRGBA(rgba, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || rgba.length !== width * height * 4) throw new Error('Invalid image dimensions');
  const ratio = Math.min(416 / width, 416 / height);
  const rw = Math.floor(width * ratio), rh = Math.floor(height * ratio);
  const plane = 416 * 416, data = new Float32Array(plane * 3).fill(114);
  for (let y = 0; y < rh; y++) {
    const sy = Math.max(0, (y + .5) * height / rh - .5), y0 = Math.floor(sy), y1 = Math.min(height - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < rw; x++) {
      const sx = Math.max(0, (x + .5) * width / rw - .5), x0 = Math.floor(sx), x1 = Math.min(width - 1, x0 + 1), fx = sx - x0;
      for (let c = 0; c < 3; c++) {
        const channel = 2 - c;
        const a = rgba[(y0 * width + x0) * 4 + channel] * (1 - fx) + rgba[(y0 * width + x1) * 4 + channel] * fx;
        const b = rgba[(y1 * width + x0) * 4 + channel] * (1 - fx) + rgba[(y1 * width + x1) * 4 + channel] * fx;
        data[c * plane + y * 416 + x] = Math.round(a * (1 - fy) + b * fy);
      }
    }
  }
  return { data, ratio };
}
function boxIoU(a, b) {
  const w = Math.max(0, Math.min(a[0]+a[2],b[0]+b[2])-Math.max(a[0],b[0]));
  const h = Math.max(0, Math.min(a[1]+a[3],b[1]+b[3])-Math.max(a[1],b[1]));
  return w*h/(a[2]*a[3]+b[2]*b[3]-w*h);
}
function decodeYOLOX(values, width, height, threshold = CANDIDATE_THRESHOLD) {
  if (values.length !== 3549 * 85 || !(width > 0 && height > 0) || !Number.isFinite(width+height) || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('Invalid YOLOX output or threshold');
  const ratio = Math.min(416 / width,416 / height), candidates = [];
  for (let i = 0; i < values.length; i += 85) {
    let cls = 0;
    for (let c = 1; c < 80; c++) if (values[i+5+c] > values[i+5+cls]) cls = c;
    const score = values[i+4] * values[i+5+cls];
    if (!Number.isFinite(score) || score < threshold || score > 1) continue;
    const bbox = [(values[i]-values[i+2]/2)/ratio,(values[i+1]-values[i+3]/2)/ratio,values[i+2]/ratio,values[i+3]/ratio];
    if (!bbox.every(Number.isFinite) || bbox[2] <= 0 || bbox[3] <= 0) continue;
    candidates.push({ class: COCO_LABELS[cls], score, bbox });
  }
  candidates.sort((a,b)=>b.score-a.score);
  const kept = [];
  for (const item of candidates) if (!kept.some(other=>other.class===item.class && boxIoU(other.bbox,item.bbox) > .65)) kept.push(item);
  return kept;
}
