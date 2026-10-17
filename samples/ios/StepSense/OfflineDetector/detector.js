/* All assets are packaged in the app. The WKWebView has no HTTP(S) navigation or fetch access. */
'use strict';
let detector;
let policy;
let settingsKey;
let busy = false;
const reply = payload => window.webkit.messageHandlers.detector.postMessage(payload);

async function initialize() {
  try {
    // Single-threaded WASM works in an offscreen view and needs neither a CDN nor SharedArrayBuffer.
    tf.wasm.setThreadsCount(1);
    tf.wasm.setWasmPaths('stepsense://offline/');
    if (!await tf.setBackend('wasm')) throw new Error('Offline WASM backend unavailable: ' + window.offlineDiagnostics.join(' | '));
    await tf.ready();
    detector = await cocoSsd.load({ base: 'lite_mobilenet_v2', modelUrl: 'stepsense://offline/model/model.json' });
    reply({ id: 'ready', value: { backend: tf.getBackend(), zone: ZONE } });
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
    const predictions = await detector.detect(image, 20, preferences.confidenceThreshold);
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
