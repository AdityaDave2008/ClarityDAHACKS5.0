import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

const frame = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#e8b45a' } }).jpeg().toBuffer();
const pngFrame = await sharp({ create: { width: 320, height: 240, channels: 4, background: '#e8b45a' } }).png().toBuffer();

function prediction({ width, height }) {
  return [{ class: 'backpack', score: 0.9, bbox: [width * 0.35, height * 0.3, width * 0.3, height * 0.55] }];
}

async function setup(t, { detect = prediction, state = 'ready', env = {} } = {}) {
  const detector = { state, calls: 0, async detect(...args) { this.calls += 1; return detect(...args); }, async close() {} };
  let now = 1_000_000;
  const app = await buildApp({ detector, config: loadConfig(env), clock: () => now });
  await app.ready();
  t.after(() => app.close());
  return { app, detector, advance(ms) { now += ms; } };
}

async function createSession(app, payload = {}) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/sessions', payload });
  assert.equal(response.statusCode, 201, response.body);
  return response.json();
}

function sendFrame(app, sessionId, sequence, { payload = frame, contentType = 'image/jpeg', headers = {} } = {}) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${sessionId}/frames`,
    headers: { 'content-type': contentType, 'x-frame-sequence': String(sequence), ...headers },
    payload,
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

test('liveness is available while readiness accurately reports detector state', async (t) => {
  const { app, detector } = await setup(t, { state: 'loading' });
  assert.equal((await app.inject('/health')).statusCode, 200);
  assert.equal((await app.inject('/ready')).statusCode, 503);
  const session = await createSession(app);
  assert.equal((await sendFrame(app, session.sessionId, 1)).statusCode, 503);
  assert.equal(detector.calls, 0);
  detector.state = 'ready';
  assert.equal((await app.inject('/ready')).statusCode, 200);
});

test('session presets remain editable and preferences are isolated', async (t) => {
  const { app } = await setup(t);
  const standard = await createSession(app);
  const accessible = await createSession(app, { preset: 'accessibility' });
  assert.notEqual(standard.sessionId, accessible.sessionId);
  assert.deepEqual(standard.preferences.alertModes, ['sound']);
  assert.deepEqual(accessible.preferences.alertModes, ['speech']);
  const changed = await app.inject({ method: 'PATCH', url: `/api/v1/sessions/${accessible.sessionId}/preferences`, payload: { alertModes: ['vibration', 'sound'] } });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.deepEqual(changed.json().preferences.alertModes, ['vibration', 'sound']);
  assert.deepEqual(standard.preferences.alertModes, ['sound']);
});

test('valid camera frames use real decoded RGB dimensions and per-session alert decisions', async (t) => {
  const received = [];
  const { app, advance } = await setup(t, { detect(input, threshold) { received.push({ ...input, threshold }); return prediction(input); } });
  const first = await createSession(app);
  const second = await createSession(app);
  const initial = await sendFrame(app, first.sessionId, 1);
  assert.equal(initial.statusCode, 200, initial.body);
  assert.equal(initial.json().alert.reason, 'confirming');
  assert.deepEqual(initial.json().frame, { sequence: 1, width: 320, height: 240 });
  assert.equal(received[0].pixels.length, 320 * 240 * 3);
  assert.equal(received[0].threshold, 0.6);
  advance(100);
  const confirmed = await sendFrame(app, first.sessionId, 2);
  assert.equal(confirmed.json().alert.triggered, true);
  assert.deepEqual(confirmed.json().alert.modalities, ['sound']);
  advance(100);
  assert.equal((await sendFrame(app, first.sessionId, 3)).json().alert.reason, 'cooldown');
  assert.equal((await sendFrame(app, second.sessionId, 1)).json().alert.reason, 'confirming');
  assert.equal((await sendFrame(app, second.sessionId, 2)).json().alert.triggered, true);
});

test('rejects invalid session options, unsupported image types, and malformed frames before inference', async (t) => {
  const { app, detector } = await setup(t);
  for (const payload of [
    { preset: 'unknown' },
    { preferences: { alertModes: ['email'] } },
    { preferences: { confidenceThreshold: 1.5 } },
    { preferences: { cooldownMs: -1 } },
  ]) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/sessions', payload });
    assert.equal(response.statusCode, 400, response.body);
  }
  const session = await createSession(app);
  assert.equal((await sendFrame(app, session.sessionId, 1, { contentType: 'image/gif' })).statusCode, 415);
  assert.equal((await sendFrame(app, session.sessionId, 2, { payload: Buffer.from('not an image') })).statusCode, 400);
  assert.equal((await sendFrame(app, session.sessionId, 3, { payload: pngFrame, contentType: 'image/jpeg' })).statusCode, 415);
  assert.equal(detector.calls, 0);
});

test('frame sequence is required and duplicate or older frames cannot advance alert state', async (t) => {
  const { app, detector } = await setup(t);
  const { sessionId } = await createSession(app);
  const missing = await app.inject({ method: 'POST', url: `/api/v1/sessions/${sessionId}/frames`, headers: { 'content-type': 'image/jpeg' }, payload: frame });
  assert.equal(missing.statusCode, 400);
  assert.equal((await sendFrame(app, sessionId, 0)).statusCode, 400);
  assert.equal((await sendFrame(app, sessionId, 2)).statusCode, 200);
  assert.equal((await sendFrame(app, sessionId, 2)).statusCode, 409);
  assert.equal((await sendFrame(app, sessionId, 1)).statusCode, 409);
  assert.equal(detector.calls, 1);
  const next = await sendFrame(app, sessionId, 3);
  assert.equal(next.json().alert.triggered, true);
});

test('oversized bodies and decoded dimensions are rejected before inference', async (t) => {
  const { app, detector } = await setup(t);
  const { sessionId } = await createSession(app);
  assert.equal((await sendFrame(app, sessionId, 1, { payload: Buffer.alloc(1_048_577) })).statusCode, 413);
  const tooWide = await sharp({ create: { width: 1281, height: 2, channels: 3, background: 'white' } }).jpeg().toBuffer();
  assert.equal((await sendFrame(app, sessionId, 2, { payload: tooWide })).statusCode, 413);
  const tooManyPixels = await sharp({ create: { width: 1100, height: 1000, channels: 3, background: 'white' } }).png().toBuffer();
  assert.equal((await sendFrame(app, sessionId, 3, { payload: tooManyPixels, contentType: 'image/png' })).statusCode, 413);
  assert.equal(detector.calls, 0);
});

test('a pending inference rejects other work without accumulating a frame backlog', async (t) => {
  const entered = deferred();
  const release = deferred();
  const { app, detector } = await setup(t, { async detect(input) { entered.resolve(); await release.promise; return prediction(input); } });
  const first = await createSession(app);
  const second = await createSession(app);
  const pending = sendFrame(app, first.sessionId, 1).then((response) => response);
  try {
    await entered.promise;
    assert.equal((await sendFrame(app, first.sessionId, 2)).statusCode, 429);
    assert.equal((await sendFrame(app, second.sessionId, 1)).statusCode, 429);
    assert.equal(detector.calls, 1);
  } finally {
    release.resolve();
  }
  assert.equal((await pending).statusCode, 200);
  assert.equal((await sendFrame(app, second.sessionId, 2)).statusCode, 200);
});

test('model failures release locks and break confirmation instead of reporting clear space', async (t) => {
  let fail = false;
  const { app } = await setup(t, { detect(input) { if (fail) throw new Error('inference failed'); return prediction(input); } });
  const { sessionId } = await createSession(app);
  assert.equal((await sendFrame(app, sessionId, 1)).json().alert.reason, 'confirming');
  fail = true;
  const failed = await sendFrame(app, sessionId, 2);
  assert.ok(failed.statusCode >= 500, failed.body);
  fail = false;
  const retry = await sendFrame(app, sessionId, 3);
  assert.equal(retry.statusCode, 200, retry.body);
  assert.equal(retry.json().alert.reason, 'confirming');
  assert.equal((await sendFrame(app, sessionId, 4)).json().alert.triggered, true);
});

test('preference changes reset existing confirmation and notification modes', async (t) => {
  const { app } = await setup(t);
  const { sessionId } = await createSession(app);
  await sendFrame(app, sessionId, 1);
  const changed = await app.inject({ method: 'PATCH', url: `/api/v1/sessions/${sessionId}/preferences`, payload: { alertModes: ['speech'] } });
  assert.equal(changed.statusCode, 200);
  const fresh = await sendFrame(app, sessionId, 2);
  assert.equal(fresh.json().alert.reason, 'confirming');
  const confirmed = await sendFrame(app, sessionId, 3);
  assert.equal(confirmed.json().alert.triggered, true);
  assert.deepEqual(confirmed.json().alert.modalities, ['speech']);
});

test('deleting a session makes it unavailable for subsequent frames', async (t) => {
  const { app, detector } = await setup(t);
  const { sessionId } = await createSession(app);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/v1/sessions/${sessionId}` })).statusCode, 204);
  assert.equal((await sendFrame(app, sessionId, 1)).statusCode, 404);
  assert.equal(detector.calls, 0);
});

test('PNG input and EXIF-oriented JPEG input produce correctly oriented RGB geometry', async (t) => {
  const { app } = await setup(t);
  const { sessionId } = await createSession(app);
  const png = await sendFrame(app, sessionId, 1, { payload: pngFrame, contentType: 'image/png' });
  assert.equal(png.statusCode, 200, png.body);
  assert.deepEqual(png.json().frame, { sequence: 1, width: 320, height: 240 });
  const orientedFrame = await sharp(frame).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const oriented = await sendFrame(app, sessionId, 2, { payload: orientedFrame });
  assert.equal(oriented.statusCode, 200, oriented.body);
  assert.deepEqual(oriented.json().frame, { sequence: 2, width: 240, height: 320 });
});

test('a preference update during inference invalidates the old frame without building a new streak', async (t) => {
  const entered = deferred();
  const release = deferred();
  let block = false;
  const { app } = await setup(t, { async detect(input) { if (block) { entered.resolve(); await release.promise; } return prediction(input); } });
  const { sessionId } = await createSession(app);
  await sendFrame(app, sessionId, 1);
  block = true;
  const pending = sendFrame(app, sessionId, 2).then((response) => response);
  try {
    await entered.promise;
    const changed = await app.inject({ method: 'PATCH', url: `/api/v1/sessions/${sessionId}/preferences`, payload: { alertModes: ['speech'] } });
    assert.equal(changed.statusCode, 200, changed.body);
  } finally {
    block = false;
    release.resolve();
  }
  assert.equal((await pending).statusCode, 409);
  const fresh = await sendFrame(app, sessionId, 3);
  assert.equal(fresh.statusCode, 200, fresh.body);
  assert.equal(fresh.json().alert.reason, 'confirming');
  assert.equal((await sendFrame(app, sessionId, 4)).json().alert.triggered, true);
});

test('a session deleted during inference cannot receive a late successful alert response', async (t) => {
  const entered = deferred();
  const release = deferred();
  let block = false;
  const { app } = await setup(t, { async detect(input) { if (block) { entered.resolve(); await release.promise; } return prediction(input); } });
  const { sessionId } = await createSession(app);
  await sendFrame(app, sessionId, 1);
  block = true;
  const pending = sendFrame(app, sessionId, 2).then((response) => response);
  try {
    await entered.promise;
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/v1/sessions/${sessionId}` })).statusCode, 204);
  } finally {
    release.resolve();
  }
  assert.equal((await pending).statusCode, 404);
});

test('expiry frees session capacity and expired identifiers cannot submit frames', async (t) => {
  const { app, advance, detector } = await setup(t, { env: { SESSION_TTL_MS: '1000', MAX_SESSIONS: '1' } });
  const first = await createSession(app);
  const full = await app.inject({ method: 'POST', url: '/api/v1/sessions', payload: {} });
  assert.equal(full.statusCode, 429);
  advance(1001);
  assert.equal((await sendFrame(app, first.sessionId, 1)).statusCode, 404);
  const next = await createSession(app);
  assert.notEqual(next.sessionId, first.sessionId);
  assert.equal(detector.calls, 0);
});

test('CORS permits the configured frontend preflight and denies other origins before inference', async (t) => {
  const { app, detector } = await setup(t, { env: { ALLOWED_ORIGINS: 'https://frontend.example' } });
  const { sessionId } = await createSession(app);
  const url = `/api/v1/sessions/${sessionId}/frames`;
  const preflight = await app.inject({ method: 'OPTIONS', url, headers: { origin: 'https://frontend.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-frame-sequence' } });
  assert.equal(preflight.statusCode, 204, preflight.body);
  assert.equal(preflight.headers['access-control-allow-origin'], 'https://frontend.example');
  assert.match(preflight.headers['access-control-allow-headers'].toLowerCase(), /x-frame-sequence/);
  const denied = await sendFrame(app, sessionId, 1, { headers: { origin: 'https://other.example' } });
  assert.equal(denied.statusCode, 403, denied.body);
  assert.equal(detector.calls, 0);
  const allowed = await sendFrame(app, sessionId, 2, { headers: { origin: 'https://frontend.example' } });
  assert.equal(allowed.statusCode, 200, allowed.body);
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://frontend.example');
});
