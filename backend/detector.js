import { Worker } from 'node:worker_threads';
import { ApiError } from './errors.js';

export class WorkerDetector {
  constructor({ timeoutMs = 15000, startupTimeoutMs = 120000 } = {}) {
    this.state = 'loading';
    this.closed = false;
    this.pending = null;
    this.nextId = 0;
    this.timeoutMs = timeoutMs;
    this.readyPromise = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    // The HTTP process may serve liveness before anyone awaits readiness.
    this.readyPromise.catch(() => {});
    this.worker = new Worker(new URL('./inference-worker.js', import.meta.url));
    this.startupTimer = setTimeout(() => this.fail('Model initialization timed out.'), startupTimeoutMs);
    this.worker.on('message', (message) => {
      if (message.type === 'ready' && !this.closed && this.state === 'loading') {
        clearTimeout(this.startupTimer); this.state = 'ready'; this.resolveReady();
      } else if (message.type === 'initialization-error') {
        this.fail('Model initialization failed. Check server network access and restart.');
      } else if (this.pending && message.id === this.pending.id) {
        const pending = this.pending;
        this.pending = null;
        clearTimeout(pending.timer);
        if (message.type === 'result') pending.resolve(message.predictions);
        else pending.reject(new ApiError(503, 'INFERENCE_FAILED', 'Model inference failed. Capture a fresh frame and try again.'));
      }
    });
    this.worker.on('error', () => this.fail('The inference worker failed. Restart the backend.'));
    this.worker.on('exit', () => { if (!this.closed && this.state !== 'error') this.fail('The inference worker stopped. Restart the backend.'); });
  }
  fail(message) {
    if (this.closed || this.state === 'error') return;
    this.state = 'error';
    clearTimeout(this.startupTimer);
    const error = new ApiError(503, 'MODEL_UNAVAILABLE', message);
    this.rejectReady(error);
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null; }
    void this.worker.terminate();
  }
  waitUntilReady() { return this.readyPromise; }
  detect({ pixels, width, height }, confidenceThreshold) {
    if (this.state !== 'ready' || this.closed) return Promise.reject(new ApiError(503, 'MODEL_NOT_READY', 'The detector is not ready. Check /ready.'));
    if (this.pending) return Promise.reject(new ApiError(429, 'DETECTOR_BUSY', 'The detector is processing another frame.'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail('Inference timed out. Restart the backend.'), this.timeoutMs);
      this.pending = { id, timer, resolve, reject };
      const copy = Uint8Array.from(pixels);
      try { this.worker.postMessage({ type: 'detect', id, pixels: copy.buffer, width, height, confidenceThreshold }, [copy.buffer]); }
      catch (error) { clearTimeout(timer); this.pending = null; reject(error); }
    });
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.state = 'error';
    clearTimeout(this.startupTimer);
    const error = new ApiError(503, 'MODEL_CLOSED', 'The detector has stopped.');
    this.rejectReady(error);
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null; }
    await this.worker.terminate();
  }
}
