// All network activity is lazy: calling load() is the explicit opt-in boundary.
export const MODEL_ID = 'onnx-community/depth-anything-v2-small';
export const MODEL_REVISION = '4472b7362082ad9968fee890ca0f1e5aca36b93d';
export const MODEL_DOWNLOAD_BYTES = 27258801;
export const RUNTIME_DOWNLOAD_BYTES = 22512306;
export const MODEL_INPUT_SIZE = 252;
const RUNTIME_URL = './vendor-depth/transformers.min.js';

/** Validate and copy raw relative inverse-depth. Never normalize to 0..255 or metres. */
export function normalizeDepthMap(map) {
  const { data, width, height } = map ?? {};
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
      || width * height > 4194304 || data?.length !== width * height) return null;
  const copy = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    if (typeof data[i] !== 'number' || !Number.isFinite(data[i])) return null;
    copy[i] = data[i];
    if (!Number.isFinite(copy[i])) return null;
  }
  return { data: copy, width, height };
}

function bounded(promise, ms, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  })]).finally(() => clearTimeout(timer));
}

/** Injectable boundaries are for tests. Production uses local browser pixels only. */
export function createDepthModel(options = {}) {
  if (!options.importRuntime && (typeof window !== 'undefined' || options.createWorker)) {
    return createWorkerDepthModel(options);
  }
  return createLocalDepthModel(options);
}

function createLocalDepthModel({
  importRuntime = () => import(RUNTIME_URL),
  platform = globalThis.navigator,
  loadTimeoutMs = 120000,
  inferenceTimeoutMs = 15000,
} = {}) {
  let generation = 0, pipeline = null, runtime = null, device = null;
  let loading = null, estimating = false, inFlight = null, cancelLoad = null;
  const release = async (value) => { try { await value?.dispose(); } catch { /* fail closed */ } };
  const check = (token) => { if (token !== generation) throw new Error('Depth operation cancelled'); };

  async function load({ onStatus = () => {} } = {}) {
    if (pipeline) return { device };
    if (loading) return loading;
    const token = ++generation;
    const status = (value) => { if (token === generation) { try { onStatus(value); } catch { /* UI is independent */ } } };
    status({ status: 'loading' });
    const work = async () => {
      const imported = await importRuntime();
      check(token);
      runtime = imported;
      runtime.env.allowLocalModels = false;
      // The server only streams three allowlisted public assets, never frame data.
      runtime.env.remoteHost = new URL('/depth-assets/', import.meta.url).href;
      runtime.env.remotePathTemplate = '{model}/resolve/{revision}/';
      runtime.env.backends.onnx.wasm.numThreads = 1;
      runtime.env.backends.onnx.wasm.proxy = false;
      runtime.env.backends.onnx.wasm.wasmPaths = new URL('./vendor-depth/', import.meta.url).href;
      let preferred = 'wasm';
      try {
        const adapter = await bounded(Promise.resolve(platform?.gpu?.requestAdapter()), 2000, 'GPU probe');
        if (adapter) {
          const probe = adapter.requestDevice();
          // Even a late successful probe must release its temporary device.
          probe.then(value => value.destroy(), () => {});
          await bounded(probe, 2000, 'GPU device probe');
          preferred = 'webgpu';
        }
      } catch { /* WebGPU presence alone is not support. */ }
      check(token);
      for (const backend of preferred === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm']) {
        let candidate;
        try {
          candidate = await runtime.pipeline('depth-estimation', MODEL_ID, {
            revision: MODEL_REVISION, device: backend, dtype: 'q8',
            progress_callback: progress => status({ status: 'loading', device: backend, progress }),
          });
          if (token !== generation) { await release(candidate); check(token); }
          // DPT's supported resize configuration, not just output-canvas downsampling.
          const processor = candidate.processor?.image_processor ?? candidate.processor?.feature_extractor;
          if (processor) processor.size = { width: MODEL_INPUT_SIZE, height: MODEL_INPUT_SIZE };
          pipeline = candidate;
          device = backend;
          status({ status: 'ready', device });
          return { device };
        } catch (error) {
          check(token);
          if (backend === 'wasm') throw error;
        }
      }
    };
    const cancelled = new Promise((_, reject) => { cancelLoad = () => reject(new Error('Depth operation cancelled')); });
    const currentLoad = bounded(Promise.race([work(), cancelled]), loadTimeoutMs, 'Depth model load').catch(async error => {
      status({ status: 'unavailable', reason: error.message });
      if (token === generation) { generation++; await release(pipeline); pipeline = null; }
      throw error;
    }).finally(() => { if (loading === currentLoad) { loading = null; cancelLoad = null; } });
    loading = currentLoad;
    return currentLoad;
  }

  async function estimate(canvas) {
    if (!pipeline) throw new Error('Depth model not loaded');
    if (estimating) throw new Error('Depth inference already running');
    estimating = true;
    const token = generation;
    const active = pipeline;
    const operation = (async () => {
      // RawImage copies canvas pixels locally. No image URL or upload API is used.
      const image = runtime.RawImage.fromCanvas(canvas);
      const result = await active(image);
      check(token);
      const prediction = result?.predicted_depth;
      const dims = prediction?.dims;
      if (!Array.isArray(dims) || dims.length < 2 || dims.slice(0, -2).some(x => x !== 1)) {
        throw new Error('Depth model returned invalid tensor dimensions');
      }
      const map = normalizeDepthMap({ data: prediction.data, width: dims.at(-1), height: dims.at(-2) });
      if (!map) throw new Error('Depth model returned invalid raw map');
      return map;
    })();
    // Do not free a running ONNX session until it settles, even after a timeout.
    inFlight = operation;
    operation.finally(() => { estimating = false; if (inFlight === operation) inFlight = null; }).catch(() => {});
    try { return await bounded(operation, inferenceTimeoutMs, 'Depth inference'); }
    catch (error) {
      if (token === generation && /timed out/.test(error.message)) {
        generation++; pipeline = null;
        operation.finally(() => release(active)).catch(() => {});
      }
      throw error;
    }
  }

  async function dispose() {
    generation++;
    cancelLoad?.();
    cancelLoad = null;
    loading = null;
    const active = pipeline;
    pipeline = null;
    if (!inFlight) await release(active);
    // A pending inference owns its session until completion, no timer polling.
    else if (active) inFlight.finally(() => release(active)).catch(() => {});
  }
  return { load, estimate, dispose };
}

// Browser-only RPC facade. Termination enforces time budgets even if WASM is busy.
function createWorkerDepthModel({
  createWorker = () => new Worker(new URL('./vendor-depth/depth-worker.js', import.meta.url), { type: 'module' }),
  loadTimeoutMs = 120000, inferenceTimeoutMs = 15000,
} = {}) {
  let worker = null, ready = null, loading = null, busy = false, nextId = 0, generation = 0;
  let notify = () => {};
  const pending = new Map();
  const status = value => { try { notify(value); } catch { /* isolate UI callbacks */ } };
  function stop(reason = new Error('Depth operation cancelled')) {
    generation++;
    if (reason.message !== 'Depth operation cancelled') status({ status: 'unavailable', reason: reason.message });
    worker?.terminate(); worker = null; ready = null; loading = null; busy = false;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(reason); }
    pending.clear();
  }
  function request(type, payload, transfer, timeout) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => stop(new Error(`Depth ${type} timed out`)), timeout);
      pending.set(id, { resolve, reject, timer });
      try { worker.postMessage({ id, type, ...payload }, transfer); }
      catch (error) { stop(error); }
    });
  }
  async function load({ onStatus = () => {} } = {}) {
    if (ready) return ready;
    if (loading) return loading;
    notify = onStatus; status({ status: 'loading' });
    const token = ++generation;
    let current;
    try {
      worker = createWorker();
      worker.onmessage = ({ data }) => {
        if (token !== generation) return;
        if (data.status) { status(data.status); return; }
        const job = pending.get(data.id);
        if (!job) return;
        clearTimeout(job.timer); pending.delete(data.id);
        if (data.error) job.reject(new Error(data.error)); else job.resolve(data.result);
      };
      worker.onerror = event => { if (token === generation) stop(new Error(event.message || 'Depth worker unavailable')); };
      current = request('load', {}, [], loadTimeoutMs);
      loading = current;
      const result = await current;
      if (token !== generation) throw new Error('Depth operation cancelled');
      ready = result;
      status({ status: 'ready', ...ready });
      return ready;
    } catch (error) {
      if (token === generation) stop(error);
      throw error;
    } finally { if (loading === current) loading = null; }
  }
  async function estimate(canvas) {
    if (!ready) throw new Error('Depth model not loaded');
    if (busy) throw new Error('Depth inference already running');
    const { width, height } = canvas;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
        || width * height > 4194304 || Math.max(width, height) / Math.min(width, height) > 4) {
      throw new Error('Depth input dimensions invalid');
    }
    busy = true;
    const token = generation;
    try {
      // getImageData creates a same-frame copy before the detector can reuse canvas.
      const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
      const map = await request('estimate', { width, height, pixels }, [pixels.buffer], inferenceTimeoutMs);
      if (token !== generation) throw new Error('Depth operation cancelled');
      const checked = normalizeDepthMap(map);
      if (!checked) throw new Error('Depth worker returned invalid raw map');
      return checked;
    } finally { if (token === generation) busy = false; }
  }
  return { load, estimate, dispose: async () => stop() };
}
