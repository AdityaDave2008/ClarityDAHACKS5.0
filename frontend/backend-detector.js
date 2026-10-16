import { captureSize } from './logic.js';

// Adapter for the team's existing COCO-SSD service. Captures only while visible
// and started; all uploads are same-origin and serialized, never recorded.
export function createBackendDetector({ request = (...args) => fetch(...args),
  createCanvas = () => document.createElement('canvas'), now = () => performance.now(),
  schedule = setTimeout, unschedule = clearTimeout, timeoutMs = 12000 } = {}) {
  return {
    async start({ video, signal, onObstacle, onError, onStatus = () => {} }) {
      signal.throwIfAborted();
      let sessionId = null, sequence = 0, timer, deleted = false;
      const canvas = createCanvas();
      const sessionPath = () => `/api/v1/sessions/${encodeURIComponent(sessionId)}`;
      const cleanup = () => {
        unschedule(timer);
        canvas.width = canvas.height = 0;
        if (sessionId && !deleted) {
          deleted = true;
          // Cleanup can outlive the aborted inference request and pagehide.
          try { void Promise.resolve(request(sessionPath(), { method: 'DELETE', keepalive: true })).catch(() => {}); }
          catch { /* The server also expires abandoned sessions. */ }
        }
      };
      signal.addEventListener('abort', cleanup, { once: true });
      async function api(path, options = {}) {
        signal.throwIfAborted();
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal.addEventListener('abort', abort, { once: true });
        const timeout = schedule(() => controller.abort(), timeoutMs);
        try {
          const response = await request(path, { ...options, signal: controller.signal, cache: 'no-store' });
          signal.throwIfAborted();
          if (!response.ok) {
            const messages = {
              404: 'AI session ended. Stop and Start to reconnect.',
              429: 'AI detector busy. Waiting for a fresh frame.',
              503: 'AI backend unavailable or loading. Start the backend, wait for it to be ready, then Stop and Start.',
            };
            throw Object.assign(new Error(messages[response.status] || 'AI request failed. Stop and Start to retry.'), { status: response.status });
          }
          return await response.json();
        } catch (error) {
          if (signal.aborted || error.status) throw error;
          throw new Error('AI connection failed or timed out. Check the backend, then Stop and Start.');
        } finally {
          unschedule(timeout);
          signal.removeEventListener('abort', abort);
        }
      }
      async function frame() {
        signal.throwIfAborted();
        const started = now();
        const size = captureSize(video.videoWidth, video.videoHeight);
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('This browser could not prepare a camera frame.');
        context.drawImage(video, 0, 0, size.width, size.height);
        const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value)
          : reject(new Error('This browser could not encode a camera frame.')), 'image/jpeg', .75));
        signal.throwIfAborted();
        if (blob.size > 1048576 || blob.type !== 'image/jpeg') throw new Error('Camera frame could not be prepared within the upload limits.');
        const current = ++sequence;
        const result = await api(`${sessionPath()}/frames`, { method: 'POST',
          headers: { 'Content-Type': 'image/jpeg', 'X-Frame-Sequence': String(current) }, body: blob });
        signal.throwIfAborted();
        if (result?.frame?.sequence !== current || typeof result?.alert?.triggered !== 'boolean') {
          throw new Error('AI returned an unexpected result. Stop and Start to retry.');
        }
        // A delayed result must never become a fresh obstacle alert.
        if (now() - started > 2500) {
          onStatus('AI result delayed; old alert skipped. Waiting for a fresh result.');
          return null;
        }
        return result;
      }
      async function tick() {
        if (signal.aborted) return;
        let delay = 400;
        try {
          const result = await frame();
          if (signal.aborted) return;
          if (result) {
            onStatus('Detection running.');
            if (result.alert.triggered) onObstacle();
          }
        } catch (error) {
          if (signal.aborted) return;
          if ([409, 429].includes(error.status)) {
            delay = 1100;
            onStatus('AI detector busy. Waiting for a fresh frame.');
          } else {
            cleanup();
            onError(error);
            return;
          }
        }
        if (!signal.aborted) timer = schedule(() => void tick(), delay);
      }
      try {
        const ready = await api('/ready');
        if (ready.ready !== true) throw new Error('AI backend is still loading. Stop and Start after it is ready.');
        const session = await api('/api/v1/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preset: 'standard', preferences: { alertModes: [], cooldownMs: 1000 } }) });
        if (typeof session.sessionId !== 'string' || !session.sessionId) throw new Error('AI did not create a valid session.');
        sessionId = session.sessionId;
        if (signal.aborted) { cleanup(); signal.throwIfAborted(); }
        // Confirm the actual frame path before the controller says running.
        // The first frame establishes a connection, not an obstacle event.
        await frame();
        signal.throwIfAborted();
        timer = schedule(() => void tick(), 400);
      } catch (error) {
        cleanup();
        signal.removeEventListener('abort', cleanup);
        throw error;
      }
    },
  };
}
