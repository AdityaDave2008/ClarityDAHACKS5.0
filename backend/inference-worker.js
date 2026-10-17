import { parentPort } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { dirname, sep } from 'node:path';
import * as tf from '@tensorflow/tfjs';
import { setThreadsCount, setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

try {
  // Read matching WASM binaries from the installed package, not a CDN.
  const require = createRequire(import.meta.url);
  setWasmPaths(dirname(require.resolve('@tensorflow/tfjs-backend-wasm')) + sep);
  setThreadsCount(1);
  const available = await tf.setBackend('wasm');
  if (!available) throw new Error('WebAssembly inference is unavailable.');
  await tf.ready();
  const model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
  parentPort.on('message', async (message) => {
    if (message.type !== 'detect') return;
    let tensor;
    try {
      tensor = tf.tensor3d(new Uint8Array(message.pixels), [message.height, message.width, 3], 'int32');
      const predictions = await model.detect(tensor, 20, message.confidenceThreshold);
      parentPort.postMessage({ type: 'result', id: message.id, predictions });
    } catch {
      parentPort.postMessage({ type: 'inference-error', id: message.id });
    } finally { tensor?.dispose(); }
  });
  parentPort.postMessage({ type: 'ready' });
} catch {
  parentPort.postMessage({ type: 'initialization-error' });
}
