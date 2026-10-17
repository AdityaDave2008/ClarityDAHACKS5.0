import { parentPort, workerData } from 'node:worker_threads';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import * as ort from 'onnxruntime-web';
import sharp from 'sharp';
import { analyzeSurface } from './surface.js';

// Pinned Hugging Face revision of Xenova/segformer-b0-finetuned-ade-512-512 (ADE20K, 150 classes).
const REPO = 'https://huggingface.co/Xenova/segformer-b0-finetuned-ade-512-512/resolve/d3e5499fa8701ff0453ca940a8dfeae39b2f1504';
const FILES = { model: 'onnx/model_quantized.onnx', config: 'config.json' };
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

async function cached(cacheDir, path) {
  const file = join(cacheDir, path.replaceAll('/', '_'));
  try { await access(file); } catch {
    const response = await fetch(`${REPO}/${path}`);
    if (!response.ok) throw new Error(`Download failed: ${path}`);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
  }
  return readFile(file);
}

try {
  const { cacheDir, inputSize } = workerData;
  // Use the installed package's WASM files, not a CDN.
  const require = createRequire(import.meta.url);
  ort.env.wasm.wasmPaths = dirname(require.resolve('onnxruntime-web')) + sep;
  ort.env.wasm.numThreads = 1;
  const [modelBytes, configBytes] = await Promise.all([cached(cacheDir, FILES.model), cached(cacheDir, FILES.config)]);
  const id2label = JSON.parse(configBytes).id2label;
  const session = await ort.InferenceSession.create(modelBytes);
  const N = inputSize * inputSize;
  const input = new Float32Array(3 * N);

  parentPort.on('message', async (message) => {
    if (message.type !== 'analyze') return;
    try {
      const rgb = await sharp(Buffer.from(message.pixels), { raw: { width: message.width, height: message.height, channels: 3 } })
        .resize(inputSize, inputSize, { fit: 'fill' }).raw().toBuffer();
      for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) input[c * N + i] = (rgb[i * 3 + c] / 255 - MEAN[c]) / STD[c];
      const output = await session.run({ pixel_values: new ort.Tensor('float32', input, [1, 3, inputSize, inputSize]) });
      const logits = output.logits;
      const [, classes, h, w] = logits.dims;
      const plane = h * w, data = logits.data;
      const labelMap = new Uint8Array(plane);
      for (let p = 0; p < plane; p++) {
        let best = 0, bestValue = data[p];
        for (let k = 1; k < classes; k++) { const v = data[k * plane + p]; if (v > bestValue) { bestValue = v; best = k; } }
        labelMap[p] = best;
      }
      parentPort.postMessage({ type: 'result', id: message.id, surface: analyzeSurface(labelMap, w, h, id2label) });
    } catch {
      parentPort.postMessage({ type: 'inference-error', id: message.id });
    }
  });
  parentPort.postMessage({ type: 'ready' });
} catch {
  parentPort.postMessage({ type: 'initialization-error' });
}
