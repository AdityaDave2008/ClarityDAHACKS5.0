import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { LIMITS, SessionObject } from '../src/index.js';
import { buildDetection, mapClassifierLabel, parseRegionWord, pointInZone } from '../src/detection.js';

/**
 * These exercise the Worker's real `fetch` handler, so routing, validation, CORS, and the
 * alert policy are all covered. The AI binding is stubbed because Workers AI is a remote
 * service; a live deployment is still required to prove the models themselves behave.
 */

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0xff, 0xd9]);

function stubAI({
  classes = [{ label: 'backpack', score: 0.9 }],
  horizontal = 'center',
  vertical = 'lower',
} = {}) {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push({ model, input });
      if (model.includes('resnet')) return classes;
      const asksVertical = /upper half or the lower half/.test(input.prompt);
      return { description: asksVertical ? vertical : horizontal };
    },
  };
}

/**
 * Minimal Durable Object namespace.
 *
 * Instances are addressed by id and keep their own storage, which is the property the
 * previous module-level session map lacked. Each test gets a fresh namespace.
 */
function stubNamespace(environment) {
  const instances = new Map();
  let counter = 0;
  const makeId = (value) => ({ toString: () => value });
  return {
    newUniqueId: () => makeId(`session-${++counter}`),
    idFromString(value) {
      if (!/^session-\d+$/.test(value)) throw new Error('Invalid session id');
      return makeId(value);
    },
    get(id) {
      const key = id.toString();
      if (!instances.has(key)) {
        const storage = new Map();
        const object = new SessionObject({
          id,
          storage: {
            async get(name) { return storage.get(name); },
            async put(name, value) { storage.set(name, value); },
            async deleteAll() { storage.clear(); },
          },
        }, environment);
        // Callers hold a stub and call fetch on it, exactly as the runtime requires.
        instances.set(key, { fetch: (input, init) => object.fetch(new Request(input, init)) });
      }
      return instances.get(key);
    },
  };
}

function env(overrides = {}) {
  const environment = { AI: stubAI(), ALLOWED_ORIGINS: '', ...overrides };
  environment.SESSIONS = stubNamespace(environment);
  return environment;
}

function request(path, { method = 'GET', body, headers = {} } = {}) {
  return new Request(`https://worker.test${path}`, { method, body, headers });
}

async function createSession(environment, payload = {}) {
  const response = await worker.fetch(request('/api/v1/sessions', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
  }), environment);
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return body;
}

function sendFrame(environment, sessionId, sequence, { body = JPEG, contentType = 'image/jpeg' } = {}) {
  return worker.fetch(request(`/api/v1/sessions/${sessionId}/frames`, {
    method: 'POST',
    body,
    headers: { 'Content-Type': contentType, 'X-Frame-Sequence': String(sequence) },
  }), environment);
}

test('health and readiness reflect whether inference is actually available', async () => {
  const ready = await worker.fetch(request('/ready'), env());
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { ready: true, modelState: 'ready' });

  const unbound = await worker.fetch(request('/ready'), { ALLOWED_ORIGINS: '' });
  assert.equal(unbound.status, 503, 'Readiness must fail when Workers AI is unbound');
  assert.equal((await unbound.json()).modelState, 'error');

  const health = await worker.fetch(request('/health'), { ALLOWED_ORIGINS: '' });
  assert.equal(health.status, 200, 'Liveness must not depend on the model');
});

test('the model endpoint states the deployed detector and its limits', async () => {
  const response = await worker.fetch(request('/api/v1/model'), env());
  const body = await response.json();
  assert.equal(body.version, 'v1');
  assert.equal(body.runtime, 'cloudflare-workers-ai');
  assert.ok(body.supportedLabels.includes('backpack'));
  assert.equal(body.zone.length, 4);
  assert.equal(body.limits.maxFrameBytes, LIMITS.maxFrameBytes);
  assert.ok(
    body.limitations.some((item) => /different model/i.test(item)),
    'Clients must be told this is not the same model as the other backends',
  );
});

test('a frame returns detections and the alert policy confirms before triggering', async () => {
  const environment = env();
  const session = await createSession(environment);

  const first = await sendFrame(environment, session.sessionId, 1);
  const firstBody = await first.json();
  assert.equal(first.status, 200, JSON.stringify(firstBody));
  assert.equal(firstBody.detections.length, 1);
  assert.equal(firstBody.detections[0].label, 'backpack');
  assert.equal(firstBody.detections[0].inZone, true);
  assert.equal(firstBody.alert.triggered, false);
  assert.equal(firstBody.alert.reason, 'confirming', 'One sighting must not alert');

  const second = await sendFrame(environment, session.sessionId, 2);
  const secondBody = await second.json();
  assert.equal(secondBody.alert.triggered, true, 'A confirmed object must alert');
  assert.deepEqual(secondBody.alert.modalities, ['sound']);

  const third = await sendFrame(environment, session.sessionId, 3);
  assert.equal((await third.json()).alert.reason, 'cooldown', 'Cooldown must suppress repeats');
});

test('an unrecognized scene yields no detections rather than a guess', async () => {
  const environment = env({ AI: stubAI({ classes: [{ label: 'space shuttle', score: 0.99 }] }) });
  const session = await createSession(environment);
  const body = await (await sendFrame(environment, session.sessionId, 1)).json();
  assert.deepEqual(body.detections, []);
  assert.equal(body.alert.reason, 'no_candidate');
  assert.equal(environment.AI.calls.length, 1, 'Localization must be skipped with no supported label');
});

test('frames are rejected when they break the documented contract', async () => {
  const environment = env();
  const session = await createSession(environment);

  const wrongType = await sendFrame(environment, session.sessionId, 1, { contentType: 'application/json' });
  assert.equal(wrongType.status, 415);

  const empty = await sendFrame(environment, session.sessionId, 1, { body: new Uint8Array() });
  assert.equal(empty.status, 400);

  const tooLarge = await sendFrame(environment, session.sessionId, 1, { body: new Uint8Array(LIMITS.maxFrameBytes + 1) });
  assert.equal(tooLarge.status, 413);

  assert.equal((await sendFrame(environment, session.sessionId, 5)).status, 200);
  const stale = await sendFrame(environment, session.sessionId, 5);
  assert.equal(stale.status, 409, 'A repeated sequence must be rejected');
  assert.equal((await stale.json()).error.code, 'STALE_FRAME');

  const missing = await sendFrame(environment, 'does-not-exist', 1);
  assert.equal(missing.status, 404);
});

test('preferences are validated and applied to later alerts', async () => {
  const environment = env();
  const session = await createSession(environment, { preset: 'accessibility' });
  assert.deepEqual(session.preferences.alertModes, ['speech']);

  const patched = await worker.fetch(request(`/api/v1/sessions/${session.sessionId}/preferences`, {
    method: 'PATCH',
    body: JSON.stringify({ alertModes: ['sound', 'vibration'], cooldownMs: 5000 }),
    headers: { 'Content-Type': 'application/json' },
  }), environment);
  assert.equal(patched.status, 200);
  assert.deepEqual((await patched.json()).preferences.alertModes, ['sound', 'vibration']);

  for (const payload of [{ confidenceThreshold: 2 }, { cooldownMs: 10 }, { alertModes: ['telepathy'] }, { nope: 1 }, {}]) {
    const response = await worker.fetch(request(`/api/v1/sessions/${session.sessionId}/preferences`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    }), environment);
    assert.equal(response.status, 400, `Expected rejection for ${JSON.stringify(payload)}`);
  }
});

test('a deleted session stops accepting frames', async () => {
  const environment = env();
  const session = await createSession(environment);
  const deleted = await worker.fetch(request(`/api/v1/sessions/${session.sessionId}`, { method: 'DELETE' }), environment);
  assert.equal(deleted.status, 204);
  assert.equal((await sendFrame(environment, session.sessionId, 1)).status, 404);
});

test('browser clients receive usable CORS headers', async () => {
  const preflight = await worker.fetch(request('/api/v1/sessions', {
    method: 'OPTIONS',
    headers: { Origin: 'https://phone.example' },
  }), env());
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://phone.example');

  const restricted = env({ ALLOWED_ORIGINS: 'https://allowed.example' });
  const blocked = await worker.fetch(request('/health', { headers: { Origin: 'https://other.example' } }), restricted);
  assert.equal(blocked.headers.get('Access-Control-Allow-Origin'), null, 'An unlisted origin must not be allowed');
});

test('unknown routes report not found', async () => {
  const response = await worker.fetch(request('/api/v1/nope'), env());
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'NOT_FOUND');
});

test('classifier labels map onto the categories clients draw', () => {
  assert.equal(mapClassifierLabel('backpack, back pack, knapsack'), 'backpack');
  assert.equal(mapClassifierLabel('folding chair'), 'chair');
  assert.equal(mapClassifierLabel('sports car'), 'car');
  assert.equal(mapClassifierLabel('golden retriever'), 'dog');
  assert.equal(mapClassifierLabel('space shuttle'), null, 'Unmapped classes must not be invented');
});

test('detections never claim a bounding box this deployment cannot measure', () => {
  // Moondream's detect task returned {} for every input form, and LLaVA asked for boxes
  // returned all zeros. Reporting a fabricated rectangle would be drawn by clients as if
  // it were measured.
  const detection = buildDetection('chair', 0.8, { horizontal: 'left', vertical: 'lower' });
  assert.equal(detection.bbox, null);
  assert.equal(detection.anchor, null);
  assert.equal(detection.localization, 'coarse');
  assert.deepEqual(detection.region, { horizontal: 'left', vertical: 'lower' });
  assert.equal(detection.inZone, true, 'The lower half is where the walking zone lies');

  const upper = buildDetection('chair', 0.8, { horizontal: 'left', vertical: 'upper' });
  assert.equal(upper.inZone, false);
  assert.equal(buildDetection('unicorn', 0.8, { horizontal: 'left', vertical: 'lower' }), null);
});

test('coarse position answers are read strictly', () => {
  assert.equal(parseRegionWord('Left', ['left', 'center', 'right']), 'left');
  assert.equal(parseRegionWord('  LOWER  ', ['upper', 'lower']), 'lower');
  assert.equal(parseRegionWord('somewhere about', ['upper', 'lower']), null, 'Unreadable answers must not be guessed');
  assert.equal(parseRegionWord(undefined, ['upper', 'lower']), null);
});

test('an unreadable position still reports the classification', async () => {
  const environment = env({ AI: stubAI({ horizontal: 'no idea', vertical: 'no idea' }) });
  const session = await createSession(environment);
  const body = await (await sendFrame(environment, session.sessionId, 1)).json();
  assert.equal(body.detections.length, 1, 'A classification must not be discarded');
  assert.deepEqual(body.detections[0].region, { horizontal: 'unknown', vertical: 'unknown' });
  assert.equal(body.detections[0].inZone, false, 'An unknown position cannot be in the zone');
});

test('a failed position query does not lose the detection', async () => {
  const environment = env({
    AI: {
      calls: [],
      async run(model) {
        if (model.includes('resnet')) return [{ label: 'backpack', score: 0.9 }];
        throw new Error('locator unavailable');
      },
    },
  });
  const session = await createSession(environment);
  const response = await sendFrame(environment, session.sessionId, 1);
  assert.equal(response.status, 200, 'Localization is a hint, not a requirement');
  assert.equal((await response.json()).detections.length, 1);
});

test('the classifier handles the uppercase labels the live API returns', () => {
  // The deployed model returns "GOLDEN RETRIEVER", which silently matched nothing before.
  assert.equal(mapClassifierLabel('GOLDEN RETRIEVER'), 'dog');
  assert.equal(mapClassifierLabel('FOLDING CHAIR'), 'chair');
});

test('the zone test matches the shape the clients draw', () => {
  assert.equal(pointInZone({ x: 0.5, y: 0.9 }), true);
  assert.equal(pointInZone({ x: 0.5, y: 0.1 }), false);
  assert.equal(pointInZone({ x: 0.02, y: 0.5 }), false);
});

test('a session survives the isolate that created it', async () => {
  // Worker isolates do not share memory and are recycled freely. Holding sessions in a
  // module-level map lost roughly three in five of them between requests on the first
  // deployment, so session state must not live in the request handler's isolate.
  const environment = env();
  const session = await createSession(environment);

  const moduleScope = await import('../src/index.js');
  assert.equal(typeof moduleScope.SessionObject, 'function', 'Session state must be a Durable Object');

  // A fresh request handler, as if served by a different isolate, still finds the session.
  const laterFrame = await sendFrame(environment, session.sessionId, 1);
  assert.equal(laterFrame.status, 200, await laterFrame.text());
});

test('session identifiers are rejected rather than crashing the Worker', async () => {
  const environment = env();
  const response = await sendFrame(environment, 'not-a-real-id', 1);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'SESSION_NOT_FOUND');
});

test('readiness fails when session storage is missing', async () => {
  const response = await worker.fetch(request('/ready'), { AI: stubAI() });
  assert.equal(response.status, 503, 'Sessions are required for the API to work');
});

test('a failed inference breaks the confirmation streak', async () => {
  // A gap in sightings is not evidence of a stable object, so a failure must not let the
  // next frame alert immediately.
  let frames = 0;
  const environment = env({
    AI: {
      async run(model, input) {
        if (model.includes('resnet')) {
          frames += 1;
          // Fail only the second frame, so the streak is interrupted mid-confirmation.
          if (frames === 2) throw new Error('upstream unavailable');
          return [{ label: 'backpack', score: 0.9 }];
        }
        return { description: /upper half or the lower half/.test(input.prompt) ? 'lower' : 'center' };
      },
    },
  });
  const session = await createSession(environment);

  assert.equal((await (await sendFrame(environment, session.sessionId, 1)).json()).alert.reason, 'confirming');
  const failed = await sendFrame(environment, session.sessionId, 2);
  assert.equal(failed.status, 503);
  assert.match((await failed.json()).error.message, /upstream unavailable/, 'The real reason must reach the client');

  const resumed = await (await sendFrame(environment, session.sessionId, 3)).json();
  assert.equal(resumed.alert.reason, 'confirming', 'The streak must restart after a failure');
  assert.equal(resumed.alert.triggered, false);
});

test('the bare origin explains the API instead of returning not found', async () => {
  // Opening the deployed URL in a browser previously showed only NOT_FOUND.
  const response = await worker.fetch(request('/'), env());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.version, 'v1');
  assert.match(body.endpoints.sendFrame, /X-Frame-Sequence/);
  assert.ok(body.notes.some((note) => /API only/i.test(note)));
});
