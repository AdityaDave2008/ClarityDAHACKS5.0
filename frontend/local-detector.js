// Detection model v1 running in the browser.
//
// Loads the same COCO-SSD lite_mobilenet_v2 weights the iPhone app bundles, through
// TensorFlow.js on a WebAssembly backend. Frames never leave the device: there is no upload,
// no session, and no network call after the model files load.
//
// This exists because the deployed Cloudflare API cannot return bounding boxes. Its hosted
// models provide a label and a coarse region only, and this web app draws boxes. Running v1
// here keeps the overlay truthful and the same model the phone uses.
//
// The first load fetches roughly 20 MB of model and runtime files, cached by the service
// worker afterwards. Inference is CPU-bound in WASM, so a laptop is noticeably faster than
// a phone.

import { captureSize } from './logic.js';
import { cameraFrameAvailable, createVideoFrameGate } from './video-frames.js';

const SUPPORTED_LABELS = Object.freeze([
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
    if (Math.abs(cross) < 1e-10 && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x)
      && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)) return true;
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Converts model pixel boxes into the normalized boxes the overlay draws. */
export function assessDetections(predictions, width, height, threshold = 0.6) {
  if (!(width > 0 && height > 0) || !Number.isFinite(width + height)) return [];
  return predictions.flatMap((prediction) => {
    const { class: label, score: confidence, bbox } = prediction;
    if (!supported.has(label) || !Number.isFinite(confidence) || confidence < threshold || confidence > 1) return [];
    if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) return [];
    const [x, y, w, h] = bbox;
    if (w <= 0 || h <= 0) return [];
    const left = Math.max(0, x);
    const top = Math.max(0, y);
    const right = Math.min(width, x + w);
    const bottom = Math.min(height, y + h);
    if (right <= left || bottom <= top) return [];
    const box = { x: left / width, y: top / height, width: (right - left) / width, height: (bottom - top) / height };
    const anchor = { x: box.x + box.width / 2, y: box.y + box.height };
    return [{ label, confidence, bbox: box, anchor, inZone: pointInZone(anchor) }];
  });
}

function center(item) {
  return { x: item.bbox.x + item.bbox.width / 2, y: item.bbox.y + item.bbox.height / 2 };
}

/** Same confirmation and cooldown rules as the backend, so alerts behave identically. */
export function createAlertPolicy({ cooldownMs = 3000, maxGapMs = 2500, confirmations = 2 } = {}) {
  let candidate = null;
  let lastAlertAt = -Infinity;
  return {
    reset() { candidate = null; lastAlertAt = -Infinity; },
    breakStreak() { candidate = null; },
    update(detections, now) {
      const cooldownRemainingMs = Math.max(0, Math.ceil(cooldownMs - (now - lastAlertAt)));
      const result = (reason, triggered = false) => ({
        triggered,
        reason,
        modalities: [],
        message: triggered ? 'Object in camera zone. Check your surroundings.' : null,
        cooldownRemainingMs: triggered ? cooldownMs : cooldownRemainingMs,
      });
      const items = detections.filter((item) => item.inZone).sort((a, b) => b.confidence - a.confidence);
      const match = candidate && now - candidate.seenAt <= maxGapMs
        ? items.find((item) => {
          const a = center(item);
          const b = center(candidate.item);
          return item.label === candidate.item.label && Math.hypot(a.x - b.x, a.y - b.y) < 0.18;
        })
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

/** Loads the runtime and weights once per page, shared by every start/stop cycle. */
let loadPromise = null;

async function loadScript(source) {
  if (document.querySelector(`script[data-stepsense="${source}"]`)) return;
  await new Promise((resolve, reject) => {
    const element = document.createElement('script');
    element.src = source;
    element.dataset.stepsense = source;
    element.onload = resolve;
    element.onerror = () => { element.remove(); reject(new Error(`Could not load ${source}.`)); };
    document.head.append(element);
  });
}

export function loadModel({ base = 'vendor/', onStatus = () => {} } = {}) {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    onStatus('Loading the detection model. The first load downloads about 20 MB.');
    await loadScript(`${base}tf.min.js`);
    await loadScript(`${base}tf-backend-wasm.min.js`);
    await loadScript(`${base}coco-ssd.min.js`);
    const { tf, cocoSsd } = window;
    if (!tf || !cocoSsd) throw new Error('The detection runtime did not load.');
    // Single-threaded WASM avoids requiring SharedArrayBuffer and its COOP/COEP headers.
    tf.wasm.setThreadsCount(1);
    tf.wasm.setWasmPaths(new URL(base, document.baseURI).href);
    if (!await tf.setBackend('wasm')) throw new Error('This browser cannot run WebAssembly inference.');
    await tf.ready();
    const model = await cocoSsd.load({
      base: 'lite_mobilenet_v2',
      modelUrl: new URL(`${base}model/model.json`, document.baseURI).href,
    });
    onStatus('Detection model ready.');
    return model;
  })().catch((error) => {
    // A failed load must not poison later attempts; the user can retry by starting again.
    loadPromise = null;
    throw error;
  });
  return loadPromise;
}

/**
 * Detector with the same interface as the backend client, so the camera feature does not
 * care which one it was given.
 */
export function createLocalDetector({
  loader = loadModel,
  createCanvas = () => document.createElement('canvas'),
  now = () => performance.now(),
  schedule = setTimeout,
  unschedule = clearTimeout,
  preferences = { confidenceThreshold: 0.6, cooldownMs: 3000 },
  minIntervalMs = 90,
  maxResultAgeMs = 2500,
} = {}) {
  return {
    async start({ video, signal, onObstacle, onError, onStatus = () => {}, onResult = () => {}, onMetrics = () => {}, onFrame }) {
      signal.throwIfAborted();
      let timer;
      let sequence = 0;
      const canvas = createCanvas();
      const policy = createAlertPolicy(preferences);
      const newFrame = createVideoFrameGate();

      let model;
      try {
        model = await loader({ onStatus });
      } catch (error) {
        onError(error instanceof Error ? error.message : String(error));
        return () => {};
      }
      if (signal.aborted) return () => {};
      onStatus('Detecting on this device. Frames are not uploaded.');

      async function frame() {
        signal.throwIfAborted();
        if (!newFrame(video)) {
          policy.breakStreak();
          onStatus('Waiting for a fresh camera frame. Alerts paused.');
          return null;
        }
        const started = now();
        const sourceWidth = video.videoWidth;
        const sourceHeight = video.videoHeight;
        if (!(sourceWidth > 0 && sourceHeight > 0)) return null;
        const size = captureSize(sourceWidth, sourceHeight);
        canvas.width = size.width;
        canvas.height = size.height;
        canvas.getContext('2d').drawImage(video, 0, 0, size.width, size.height);

        const predictions = await model.detect(canvas, 20, preferences.confidenceThreshold);
        if (signal.aborted) return null;
        if (!cameraFrameAvailable(video) || video.videoWidth !== sourceWidth || video.videoHeight !== sourceHeight) {
          policy.breakStreak(); return null;
        }
        const elapsed = now() - started;
        sequence += 1;
        // A result older than the staleness window describes a scene that has moved on.
        if (elapsed >= maxResultAgeMs) {
          policy.breakStreak();
          onStatus('Detection is slower than the freshness limit on this device. Alert skipped.');
          return null;
        }
        const detections = assessDetections(predictions, size.width, size.height, preferences.confidenceThreshold);
        // Optional consumers must copy this canvas synchronously before the next frame.
        // Their failures must never become v1 errors or suppress object results/alerts.
        if (onFrame) {
          try {
            const pending = onFrame({ canvas, sequence, capturedAt: started, sourceWidth, sourceHeight, detections });
            pending?.catch?.(() => {});
          } catch { /* Experimental depth is independent of v1. */ }
        }
        const alert = policy.update(detections, Date.now());
        onMetrics({ lastMs: Math.round(elapsed), averageMs: Math.round(elapsed), captureMaxSide: Math.max(size.width, size.height) });
        return {
          frame: { sequence, width: size.width, height: size.height },
          detections,
          alert,
          sequence,
          ageMs: elapsed,
          roundTripMs: Math.round(elapsed),
          processingMs: Math.round(elapsed),
          sourceWidth,
          sourceHeight,
        };
      }

      async function tick() {
        if (signal.aborted) return;
        try {
          const result = await frame();
          if (signal.aborted) return;
          if (result) {
            onResult(result);
            if (result.alert.triggered) onObstacle();
          }
        } catch (error) {
          if (signal.aborted) return;
          policy.breakStreak();
          onError(error instanceof Error ? error.message : String(error));
        }
        if (!signal.aborted) timer = schedule(tick, minIntervalMs);
      }

      const stop = () => unschedule(timer);
      signal.addEventListener('abort', stop, { once: true });
      tick();
      return stop;
    },
  };
}
