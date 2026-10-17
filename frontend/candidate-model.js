import { CANDIDATE_THRESHOLD, preprocessRGBA, decodeYOLOX } from './yolox.js';
export { CANDIDATE_THRESHOLD };
export const MODEL_SHA256 = '516617114420ce3c2bac545869ee91bac8ff7a63e148a73afdb12f126433fab4';
export const MODEL_BASE = 'vendor/yolox-51661711/';

/** The output stays in source-image pixel coordinates for the existing overlay policy. */
export function createCandidateModel(session, runtime) {
  return {
    async detect(canvas, _maxBoxes = 20, threshold = CANDIDATE_THRESHOLD) {
      const { width, height } = canvas;
      const rgba = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
      const { data } = preprocessRGBA(rgba, width, height);
      const input = new runtime.Tensor('float32', data, [1, 3, 416, 416]);
      let outputs;
      try {
        outputs = await session.run({ images: input });
        const output = outputs.predictions;
        if (!output || JSON.stringify(output.dims) !== '[1,3549,85]') throw new Error('Unexpected candidate output shape');
        return decodeYOLOX(output.data, width, height, threshold);
      } finally {
        input.dispose();
        for (const output of Object.values(outputs || {})) output.dispose();
      }
    },
  };
}

let loadPromise;
let scriptPromise;
function loadRuntime() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(`${MODEL_BASE}ort.wasm.min.js`, document.baseURI).href;
    script.onload = resolve;
    script.onerror = () => { script.remove(); scriptPromise = null; reject(new Error('Could not load the bundled ONNX runtime. Start again to retry.')); };
    document.head.append(script);
  });
  return scriptPromise;
}

/** Failed loads can retry, successful sessions are reused across camera start/stop cycles. */
export function loadCandidateModel({ onStatus = () => {} } = {}) {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    onStatus('Loading experimental YOLOX candidate (about 15 MB on first use).');
    await loadRuntime();
    const runtime = window.ort;
    if (!runtime) throw new Error('The bundled ONNX runtime did not initialize.');
    runtime.env.wasm.numThreads = 1;
    runtime.env.wasm.proxy = false;
    runtime.env.wasm.wasmPaths = new URL(MODEL_BASE, document.baseURI).href;
    const response = await fetch(new URL(`${MODEL_BASE}candidate.onnx`, document.baseURI));
    if (!response.ok) throw new Error(`Candidate download failed (${response.status}).`);
    const bytes = await response.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    if (hash !== MODEL_SHA256) throw new Error('Candidate model integrity check failed.');
    const session = await runtime.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    if (session.inputNames[0] !== 'images' || session.outputNames[0] !== 'predictions') {
      await session.release();
      throw new Error('Unexpected candidate model contract.');
    }
    onStatus('Experimental YOLOX candidate ready. Empty results do not mean a clear path.');
    return createCandidateModel(session, runtime);
  })().catch(error => { loadPromise = null; throw error; });
  return loadPromise;
}
