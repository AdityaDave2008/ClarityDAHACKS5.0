/**
 * StepSense detection API on Cloudflare Workers.
 *
 * Serves the same v1 contract as the Node backend in `backend/`, so existing clients only
 * need a different origin. Inference runs on Workers AI rather than a local TensorFlow.js
 * worker, which means the models differ; see `detection.js`.
 *
 * Session state lives in Durable Objects because Worker isolates do not share memory.
 */

import { ApiError } from './sessions.js';
import { handleDepthAsset } from './depth-assets.js';
import { SessionClient, SessionObject, publicSession, validatePreferences } from './session-object.js';
import { detectFrame, SUPPORTED_LABELS, ZONE } from './detection.js';

export { SessionObject };

export const LIMITS = Object.freeze({
  maxFrameBytes: 1024 * 1024,
  maxImagePixels: 1_000_000,
  maxImageSide: 1280,
  processedMaxSide: 640,
});

const LIMITATIONS = Object.freeze([
  'This detector recognizes selected object categories; it does not recognize arbitrary hazards, curbs, stairs, potholes, construction cones, or barriers.',
  'Detection runs on Cloudflare Workers AI, pairing an image classifier with a vision model. It is a different model from the Node backend and the bundled iPhone detector, so results will not match them frame for frame.',
  'This deployment does not produce bounding boxes. Each detection carries bbox and anchor as null, plus a coarse region estimate. Measured over six synthetic frames, horizontal thirds were correct 4/6 and vertical halves 5/6, so the region is a hint and not a measurement.',
  'Because there is no box, inZone reports only that the object appeared in the lower half of the frame. It does not determine ground contact, distance, a safe route, or collision probability.',
  'No detections or no alert does not establish a clear path.',
  'Each frame makes two model calls over the network, so latency is higher than local inference. Measure the complete loop on the demo device.',
]);

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Builds CORS headers.
 *
 * `ALLOWED_ORIGINS` unset means any origin, which suits a hackathon demo where phones and
 * tunnels change origin constantly. Set it to lock the API down.
 */
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = allowedOrigins(env);
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Frame-Sequence',
    'Access-Control-Expose-Headers': 'Retry-After',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (!origin) return headers;
  if (allowed.length === 0 || allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function json(body, { status = 200, request, env, extra = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(request, env),
      ...extra,
    },
  });
}

function failure(error, request, env) {
  if (error instanceof ApiError) {
    return json({ error: { code: error.code, message: error.message } }, {
      status: error.statusCode,
      request,
      env,
      extra: error.statusCode === 429 ? { 'Retry-After': '1' } : {},
    });
  }
  return json({ error: { code: 'INTERNAL_ERROR', message: 'The backend could not complete this request.' } }, {
    status: 500, request, env,
  });
}

async function readBoundedBody(request) {
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > LIMITS.maxFrameBytes) {
        await reader.cancel().catch(() => {});
        throw new ApiError(413, 'FRAME_TOO_LARGE', 'The request exceeds the 1 MiB limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}

async function readJson(request) {
  const type = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (request.method !== 'GET' && type && type !== 'application/json') {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json for preferences.');
  }
  const text = new TextDecoder().decode(await readBoundedBody(request));
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, 'INVALID_REQUEST', 'The request body could not be read.');
  }
}

async function handleFrame(request, env, sessionId) {
  const contentType = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (!['image/jpeg', 'image/png'].includes(contentType)) {
    throw new ApiError(415, 'UNSUPPORTED_IMAGE_TYPE', 'Send raw JPEG or PNG bytes with the matching Content-Type.');
  }
  const rawSequence = request.headers.get('X-Frame-Sequence');
  if (!rawSequence || !/^[1-9][0-9]{0,14}$/.test(rawSequence)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Send X-Frame-Sequence as a positive integer.');
  }
  if (!env.AI) {
    throw new ApiError(503, 'MODEL_NOT_READY', 'Workers AI is not bound to this Worker.');
  }

  const sessions = new SessionClient(env.SESSIONS);
  const session = await sessions.call(sessionId, 'read');
  const sequence = Number(rawSequence);

  const bytes = await readBoundedBody(request);
  if (bytes.byteLength === 0) {
    throw new ApiError(400, 'INVALID_IMAGE', 'Send a non-empty JPEG or PNG image.');
  }

  const started = Date.now();
  let detections;
  try {
    ({ detections } = await detectFrame(env.AI, bytes, session.preferences.confidenceThreshold));
  } catch {
    // A failed frame breaks the confirmation streak: a gap is not evidence of a stable object.
    await sessions.call(sessionId, 'break-streak').catch(() => {});
    // Provider errors can contain request data or credentials. Keep only a stable
    // operational event, not raw text, in both the public response and logs.
    console.error('inference_failed');
    throw new ApiError(503, 'INFERENCE_FAILED', 'Frame analysis is temporarily unavailable. Retry shortly.');
  }

  const { alert } = await sessions.call(sessionId, 'frame', { sequence, detections });
  return json({
    // Workers AI reports no decoded size, and the clients scale overlays from their own
    // capture dimensions, so the frame block carries the sequence only.
    frame: { sequence, width: null, height: null },
    detections,
    alert,
    surface: null,
    processingMs: Date.now() - started,
  }, { request, env });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (url.pathname === '/depth-assets' || url.pathname.startsWith('/depth-assets/')) {
      return handleDepthAsset(request);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    try {
      if (path === '/api' && request.method === 'GET') {
        return json({
          service: 'StepSense detection API',
          version: 'v1',
          ready: Boolean(env.AI) && Boolean(env.SESSIONS),
          endpoints: {
            health: 'GET /health',
            ready: 'GET /ready',
            model: 'GET /api/v1/model',
            createSession: 'POST /api/v1/sessions',
            updatePreferences: 'PATCH /api/v1/sessions/:sessionId/preferences',
            sendFrame: 'POST /api/v1/sessions/:sessionId/frames (raw image/jpeg or image/png, X-Frame-Sequence header)',
            deleteSession: 'DELETE /api/v1/sessions/:sessionId',
          },
          notes: [
            'This origin serves an API only; there is no web interface here.',
            'Detections carry a coarse region rather than a bounding box. See GET /api/v1/model for the limitations.',
          ],
        }, { request, env });
      }

      if (path === '/health' && request.method === 'GET') {
        return json({ status: 'ok' }, { request, env });
      }

      // Workers AI needs no warm-up, so readiness reflects whether the bindings exist.
      if (path === '/ready' && request.method === 'GET') {
        const ready = Boolean(env.AI) && Boolean(env.SESSIONS);
        return json({ ready, modelState: ready ? 'ready' : 'error' }, { status: ready ? 200 : 503, request, env });
      }

      if (path === '/api/v1/model' && request.method === 'GET') {
        return json({
          name: 'workers-ai-detection',
          base: 'resnet-50 + llava-1.5-7b',
          runtime: 'cloudflare-workers-ai',
          version: 'v1',
          state: env.AI ? 'ready' : 'error',
          localization: 'coarse',
          supportedLabels: SUPPORTED_LABELS,
          zone: ZONE,
          limits: LIMITS,
          surface: { name: null, state: 'disabled', hazardLabels: [], walkableLabels: [] },
          limitations: LIMITATIONS,
        }, { request, env });
      }

      if (path === '/api/v1/sessions' && request.method === 'POST') {
        const body = await readJson(request);
        const preset = body.preset ?? 'standard';
        if (!['standard', 'accessibility'].includes(preset)) {
          throw new ApiError(400, 'VALIDATION_ERROR', 'preset must be standard or accessibility.');
        }
        const sessions = new SessionClient(env.SESSIONS);
        const record = await sessions.create(preset, validatePreferences(body.preferences));
        return json(publicSession(record), { status: 201, request, env });
      }

      const preferenceMatch = path.match(/^\/api\/v1\/sessions\/([^/]+)\/preferences$/);
      if (preferenceMatch && request.method === 'PATCH') {
        const changes = validatePreferences(await readJson(request), { partial: true });
        const sessions = new SessionClient(env.SESSIONS);
        const id = decodeURIComponent(preferenceMatch[1]);
        const record = await sessions.call(id, 'update', changes);
        return json(publicSession({ ...record, sessionId: id }), { request, env });
      }

      const frameMatch = path.match(/^\/api\/v1\/sessions\/([^/]+)\/frames$/);
      if (frameMatch && request.method === 'POST') {
        return await handleFrame(request, env, decodeURIComponent(frameMatch[1]));
      }

      const sessionMatch = path.match(/^\/api\/v1\/sessions\/([^/]+)$/);
      if (sessionMatch && request.method === 'DELETE') {
        const sessions = new SessionClient(env.SESSIONS);
        await sessions.call(decodeURIComponent(sessionMatch[1]), 'delete');
        return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', ...corsHeaders(request, env) } });
      }

      // Anything that is not an API route is the web app itself. Serving the browser
      // client from this origin means the phone opens one HTTPS URL and the camera
      // uploads are same-origin, so no CORS configuration is involved.
      if (request.method === 'GET' && !path.startsWith('/api/')) {
        const asset = await env.ASSETS?.fetch(request);
        if (asset && asset.status !== 404) return asset;
        if (path === '/' || path === '/index.html') {
          return json({
            error: {
              code: 'APP_NOT_DEPLOYED',
              message: 'The web app assets are missing from this deployment. See GET /api for the API.',
            },
          }, { status: 503, request, env });
        }
      }

      return json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } }, { status: 404, request, env });
    } catch (error) {
      return failure(error, request, env);
    }
  },
};
