/* All assets are packaged in the app. The WKWebView has no HTTP(S) navigation or fetch access. */
'use strict';
let detector;
let policy;
let settingsKey;
let busy = false;
const reply = payload => window.webkit.messageHandlers.detector.postMessage(payload);

async function initialize() {
  try {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = 'stepsense://offline/';
    detector = await ort.InferenceSession.create('stepsense://offline/candidate.onnx', { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    if (detector.inputNames[0] !== 'images' || detector.outputNames[0] !== 'predictions') throw new Error('Unexpected model contract');
    reply({ id: 'ready', value: { backend: 'ONNX WASM · experimental YOLOX-Nano', zone: ZONE } });
  } catch (error) { reply({ id: 'ready', error: String(error) }); }
}

window.analyzeOffline = async function (id, jpeg, sequence, preferences, ageMs) {
  if (busy) { reply({ id, error: 'Detector already processing a frame' }); return; }
  busy = true;
  const start = performance.now();
  try {
    if (!detector) throw new Error('Offline detector not ready');
    const nextKey = JSON.stringify([preferences.cooldownMs, preferences.confidenceThreshold, preferences.alertModes]);
    if (nextKey !== settingsKey) {
      policy = createAlertPolicy({ cooldownMs: preferences.cooldownMs });
      settingsKey = nextKey;
    }
    const image = new Image();
    image.src = 'data:image/jpeg;base64,' + jpeg;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const input = preprocessRGBA(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    const outputs = await detector.run({ images: new ort.Tensor('float32', input.data, [1, 3, 416, 416]) });
    let predictions;
    try {
      const output = outputs.predictions;
      if (JSON.stringify(output.dims) !== '[1,3549,85]') throw new Error('Unexpected output shape');
      predictions = decodeYOLOX(output.data, canvas.width, canvas.height, preferences.confidenceThreshold);
    } finally { for (const output of Object.values(outputs)) output.dispose(); }
    const elapsed = performance.now() - start;
    const stale = ageMs + elapsed > 2500;
    const detections = stale ? [] : assessDetections(predictions, image.naturalWidth, image.naturalHeight, preferences.confidenceThreshold);
    let alert;
    if (stale) {
      policy.breakStreak();
      alert = { triggered: false, reason: 'stale', modalities: [], message: null, cooldownRemainingMs: 0 };
    } else {
      alert = policy.update(detections, performance.now());
      if (alert.triggered) alert.modalities = preferences.alertModes;
    }
    reply({ id, value: { frame: { sequence, width: image.naturalWidth, height: image.naturalHeight }, detections, alert, processingMs: Math.round(elapsed) } });
  } catch (error) {
    if (policy) policy.breakStreak();
    reply({ id, error: String(error) });
  } finally { busy = false; }
};
initialize();
