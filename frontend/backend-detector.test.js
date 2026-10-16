import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackendDetector } from './backend-detector.js';

const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
function fixture({ response, toBlob } = {}) {
  const controller = new AbortController();
  const tasks = new Map();
  const calls = [], obstacles = [], errors = [], statuses = [];
  let now = 0, id = 0;
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {} }),
    toBlob: toBlob || (fn => fn(new Blob(['jpeg'], { type: 'image/jpeg' }))) };
  const request = async (path, options = {}) => {
    calls.push({ path, options });
    if (response) {
      const value = await response(path, options, { calls, controller, advance: ms => { now += ms; } });
      if (value) return value;
    }
    if (options.method === 'DELETE') return { ok: true, status: 204 };
    const data = path === '/ready' ? { ready: true } : path === '/api/v1/sessions' ? { sessionId: 'test-session' }
      : { frame: { sequence: Number(options.headers['X-Frame-Sequence']) }, alert: { triggered: true } };
    return { ok: true, status: 200, json: async () => data };
  };
  const adapter = createBackendDetector({ request, createCanvas: () => canvas, now: () => now,
    schedule: (fn, ms) => { tasks.set(++id, { fn, ms }); return id; }, unschedule: id => tasks.delete(id) });
  const start = () => adapter.start({ video: { videoWidth: 1920, videoHeight: 1080 }, signal: controller.signal,
    onObstacle: () => obstacles.push(true), onError: error => errors.push(error), onStatus: text => statuses.push(text) });
  const tick = async () => {
    const next = [...tasks].sort((a, b) => a[1].ms - b[1].ms)[0];
    assert.ok(next, 'A task should be scheduled');
    tasks.delete(next[0]);
    now += next[1].ms;
    next[1].fn();
    await flush();
    return next[1].ms;
  };
  return { start, tick, controller, calls, obstacles, errors, statuses, tasks, canvas };
}

test('backend adapter does nothing before Start; reuses API and alerts only on confirmed results', async () => {
  const f = fixture();
  assert.equal(f.calls.length, 0);
  await f.start();
  assert.deepEqual(f.calls.map(call => call.path), ['/ready', '/api/v1/sessions', '/api/v1/sessions/test-session/frames']);
  assert.equal(f.canvas.width, 640);
  assert.equal(f.canvas.height, 360);
  const preferences = JSON.parse(f.calls[1].options.body).preferences;
  assert.deepEqual(preferences.alertModes, []);
  assert.equal(f.obstacles.length, 0, 'Startup is a connection check, not a confirmed alert');
  await f.tick();
  assert.equal(f.obstacles.length, 1);
  assert.equal(f.calls.at(-1).options.headers['X-Frame-Sequence'], '2');
  assert.equal(f.calls.at(-1).options.headers['Content-Type'], 'image/jpeg');
  f.controller.abort();
});

test('no_candidate results never produce an obstacle', async () => {
  const f = fixture({ response: async (path, options) => path.endsWith('/frames') ? {
    ok: true, json: async () => ({ frame: { sequence: Number(options.headers['X-Frame-Sequence']) }, alert: { triggered: false } }) } : null });
  await f.start();
  await f.tick();
  assert.equal(f.obstacles.length, 0);
  f.controller.abort();
});

test('Stop cancels queued work, aborts requests and deletes the session once', async () => {
  const f = fixture();
  await f.start();
  f.controller.abort();
  await flush();
  assert.equal(f.tasks.size, 0);
  assert.equal(f.canvas.width, 0);
  assert.equal(f.calls.filter(call => call.options.method === 'DELETE').length, 1);
  assert.equal(f.errors.length, 0);
});

test('a cancelled capture cannot upload after async JPEG encoding completes', async () => {
  let encode;
  const f = fixture({ toBlob: fn => { encode = fn; } });
  const starting = f.start();
  await flush();
  f.controller.abort();
  encode(new Blob(['jpeg'], { type: 'image/jpeg' }));
  await assert.rejects(starting, { name: 'AbortError' });
  assert.equal(f.calls.filter(call => call.path.endsWith('/frames')).length, 0);
});

test('busy detector backs off and uploads a fresh sequence rather than queuing frames', async () => {
  const f = fixture({ response: async (path, options) => path.endsWith('/frames') && options.headers['X-Frame-Sequence'] === '2'
    ? { ok: false, status: 429 } : null });
  await f.start();
  await f.tick();
  assert.match(f.statuses.at(-1), /busy/);
  assert.equal(await f.tick(), 1100);
  assert.equal(f.calls.at(-1).options.headers['X-Frame-Sequence'], '3');
  assert.equal(f.obstacles.length, 1);
  f.controller.abort();
});

test('late AI results are skipped without speaking stale obstacles', async () => {
  const f = fixture({ response: async (path, options, { advance }) => {
    if (path.endsWith('/frames') && options.headers['X-Frame-Sequence'] === '2') advance(3000);
  } });
  await f.start();
  await f.tick();
  assert.equal(f.obstacles.length, 0);
  assert.match(f.statuses.at(-1), /old alert skipped/);
  f.controller.abort();
});

test('unavailable backend gives recovery instructions without uploading a frame', async () => {
  const f = fixture({ response: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(f.start(), /backend unavailable or loading/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.tasks.size, 0);
});

test('expired session stops work, deletes session, and reports recovery', async () => {
  const f = fixture({ response: async (path, options) => path.endsWith('/frames') && options.headers['X-Frame-Sequence'] === '2'
    ? { ok: false, status: 404 } : null });
  await f.start();
  await f.tick();
  assert.match(f.errors[0].message, /session ended/);
  assert.equal(f.tasks.size, 0);
  assert.equal(f.calls.at(-1).options.method, 'DELETE');
});

test('mismatched sequence is rejected and oversized images never upload', async () => {
  const wrong = fixture({ response: async path => path.endsWith('/frames') ? {
    ok: true, json: async () => ({ frame: { sequence: 999 }, alert: { triggered: true } }) } : null });
  await assert.rejects(wrong.start(), /unexpected result/);
  assert.equal(wrong.obstacles.length, 0);
  const large = fixture({ toBlob: fn => fn(new Blob([new Uint8Array(1048577)], { type: 'image/jpeg' })) });
  await assert.rejects(large.start(), /upload limits/);
  assert.equal(large.calls.filter(call => call.path.endsWith('/frames')).length, 0);
});

test('requests time out and shutdown cannot publish a late response', async () => {
  const f = fixture({ response: async (_path, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }) });
  const starting = f.start();
  const rejection = assert.rejects(starting, /timed out/);
  await flush();
  await f.tick();
  await rejection;
  assert.equal(f.obstacles.length, 0);
  assert.equal(f.tasks.size, 0);
});
