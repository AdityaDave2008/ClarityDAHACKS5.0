// One in-flight frame, off the UI thread. Runtime/model served from this app.
export class LocalDetector {
  constructor() {
    this.worker = new Worker(new URL('./local-detector-worker.js', import.meta.url));
    this.pending = null;
    this.closed = false;
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.ready.catch(() => {});
    this.startupTimer = setTimeout(() => this.fail('On-device model loading timed out. Check your connection or select Backend.'), 90000);
    this.worker.onmessage = ({ data }) => {
      if (this.closed) return;
      if (data.type === 'ready') { clearTimeout(this.startupTimer); this.resolveReady(); }
      else if (data.type === 'error') this.fail(data.message || 'On-device detector failed. Try Backend mode.');
      else if (data.type === 'result' && this.pending) {
        const pending = this.pending;
        this.pending = null;
        clearTimeout(pending.timer);
        pending.resolve(data);
      }
    };
    this.worker.onerror = () => this.fail('On-device scanning is unavailable in this browser. Select Backend mode.');
  }
  fail(message) {
    if (this.closed) return;
    this.close(new Error(message));
  }
  detect(bitmap, timestamp) {
    if (this.closed || this.pending) { bitmap.close(); return Promise.reject(new Error('Local detector is stopped or busy.')); }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail('On-device inference timed out. Try Backend mode.'), 15000);
      this.pending = { resolve, reject, timer };
      try { this.worker.postMessage({ type: 'detect', bitmap, timestamp }, [bitmap]); }
      catch (error) { bitmap.close(); this.fail(error.message); }
    });
  }
  close(error = new DOMException('Scan stopped', 'AbortError')) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.startupTimer);
    this.rejectReady(error);
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null; }
    this.worker.terminate();
  }
}
