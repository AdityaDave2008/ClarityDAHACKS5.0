import { Worker } from 'node:worker_threads';

// Optional second model. Unlike WorkerDetector, failures never fail a frame:
// analyze() resolves null and the object detector keeps working.
export class SurfaceDetector {
  constructor({ cacheDir, inputSize = 320, timeoutMs = 5000 } = {}) {
    this.state = 'loading';
    this.closed = false;
    this.pending = null;
    this.nextId = 0;
    this.timeoutMs = timeoutMs;
    this.readyPromise = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.readyPromise.catch(() => {});
    this.worker = new Worker(new URL('./surface-worker.js', import.meta.url), { workerData: { cacheDir, inputSize } });
    this.worker.on('message', (message) => {
      if (message.type === 'ready' && this.state === 'loading') { this.state = 'ready'; this.resolveReady(); }
      else if (message.type === 'initialization-error') this.fail();
      else if (this.pending && message.id === this.pending.id) this.settle(message.type === 'result' ? message.surface : null);
    });
    this.worker.on('error', () => this.fail());
    this.worker.on('exit', () => { if (!this.closed) this.fail(); });
  }
  settle(value) {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.resolve(value);
    this.pending = null;
  }
  fail() {
    if (this.state === 'error') return;
    this.state = 'error';
    this.rejectReady(new Error('Surface model unavailable.'));
    this.settle(null);
    void this.worker.terminate();
  }
  waitUntilReady() { return this.readyPromise; }
  analyze({ pixels, width, height }) {
    if (this.state !== 'ready' || this.closed || this.pending) return Promise.resolve(null);
    const id = ++this.nextId;
    return new Promise((resolve) => {
      // A slow segmentation is skipped for this frame rather than delaying the alert;
      // pending stays set until the worker answers, so frames never queue up behind it.
      const timer = setTimeout(() => { if (this.pending?.id === id) this.pending.resolve(null); }, this.timeoutMs);
      this.pending = { id, timer, resolve };
      const copy = Uint8Array.from(pixels);
      this.worker.postMessage({ type: 'analyze', id, pixels: copy.buffer, width, height }, [copy.buffer]);
    });
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.state = 'error';
    this.settle(null);
    await this.worker.terminate();
  }
}
