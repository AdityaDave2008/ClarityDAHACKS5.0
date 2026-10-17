let detector;
async function initialize() {
try {
  // Classic worker preserves importScripts for MediaPipe's WASM loader.
  const { FilesetResolver, ObjectDetector } = await import('/vendor/mediapipe/vision_bundle.mjs');
  const vision = await FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
  detector = await ObjectDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: '/models/efficientdet_lite0.tflite', delegate: 'CPU' },
    runningMode: 'VIDEO', scoreThreshold: 0.1, maxResults: 30,
  });
  self.postMessage({ type: 'ready' });
} catch (error) {
  self.postMessage({ type: 'error', message: `Could not load the on-device detector: ${error.message}` });
}
}
void initialize();
self.onmessage = ({ data }) => {
  if (data.type !== 'detect') return;
  try {
    if (!detector) throw new Error('Model unavailable.');
    const { width, height } = data.bitmap;
    // MediaPipe needs a canvas in workers; ImageBitmap is not an HTMLImageElement.
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d').drawImage(data.bitmap, 0, 0);
    const result = detector.detectForVideo(canvas, data.timestamp);
    self.postMessage({ type: 'result', width, height, detections: result.detections });
  } catch (error) { self.postMessage({ type: 'error', message: `On-device inference failed: ${error.message}` }); }
  finally { data.bitmap.close(); }
};
