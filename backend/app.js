import Fastify, { LogController } from 'fastify';
import cors from '@fastify/cors';
import { performance } from 'node:perf_hooks';
import { LIMITS, loadConfig } from './config.js';
import { ApiError } from './errors.js';
import { SessionStore } from './sessions.js';
import { assessDetections, SUPPORTED_LABELS, ZONE } from './alerts.js';
import { decodeFrame } from './images.js';
import { HAZARD_LABELS, WALKABLE_LABELS } from './surface.js';

const preferenceProperties = {
  alertModes: { type: 'array', maxItems: 3, uniqueItems: true, items: { type: 'string', enum: ['sound', 'vibration', 'speech'] } },
  confidenceThreshold: { type: 'number', minimum: 0.4, maximum: 0.95 },
  cooldownMs: { type: 'integer', minimum: 1000, maximum: 10000 },
};
const preferenceSchema = { type: 'object', additionalProperties: false, properties: preferenceProperties };
const sessionParams = { type: 'object', required: ['sessionId'], properties: { sessionId: { type: 'string', minLength: 1, maxLength: 128 } } };

export async function buildApp({ detector, surfaceDetector = null, config = loadConfig({}), clock = Date.now, logger = false } = {}) {
  if (!detector) throw new Error('A detector is required. Production uses WorkerDetector; tests inject their own detector.');
  const app = Fastify({
    bodyLimit: LIMITS.maxFrameBytes,
    requestTimeout: 15000,
    logger,
    logController: new LogController({ disableRequestLogging: true }),
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false, useDefaults: false } },
  });
  const sessions = new SessionStore({ ttlMs: config.sessionTtlMs, maxSessions: config.maxSessions, clock });
  let frameInFlight = false;

  app.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });
  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.includes(origin)) callback(null, true);
      else callback(new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'This frontend origin is not allowed.'), false);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Frame-Sequence'],
    exposedHeaders: ['Retry-After'],
    maxAge: 600,
    credentials: false,
  });
  app.addContentTypeParser(['image/jpeg', 'image/png'], { parseAs: 'buffer', bodyLimit: LIMITS.maxFrameBytes }, (_request, body, done) => done(null, body));

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      if (error.statusCode === 429) reply.header('Retry-After', '1');
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    if (error.validation) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request fields. Check the API contract.' } });
    if (error.statusCode === 413) return reply.code(413).send({ error: { code: 'FRAME_TOO_LARGE', message: 'The request exceeds the 1 MiB limit.' } });
    if (error.statusCode === 415) return reply.code(415).send({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Use application/json for preferences or image/jpeg or image/png for frames.' } });
    if (error.statusCode === 400) return reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: 'The request body could not be read.' } });
    app.log.error({ code: 'INTERNAL_ERROR' }, 'Backend request failed');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'The backend could not complete this request.' } });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } }));
  app.addHook('onClose', async () => { sessions.clear(); await detector.close?.(); await surfaceDetector?.close?.(); });

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) => reply.code(detector.state === 'ready' ? 200 : 503).send({ ready: detector.state === 'ready', modelState: detector.state }));
  app.get('/api/v1/model', async () => ({
    name: 'coco-ssd', base: 'lite_mobilenet_v2', runtime: 'tensorflowjs-wasm', state: detector.state,
    supportedLabels: SUPPORTED_LABELS, zone: ZONE, limits: LIMITS,
    surface: { name: 'segformer-b0-ade20k', state: surfaceDetector?.state ?? 'disabled', hazardLabels: HAZARD_LABELS, walkableLabels: WALKABLE_LABELS },
    limitations: [
      'This detector recognizes selected COCO object categories; it does not recognize arbitrary hazards, curbs, stairs, potholes, construction cones, or barriers.',
      'The optional surface model labels image regions such as wall, pole, stairs, and sidewalk. Its labels are frequently wrong outdoors and on unusual surfaces; it does not detect curb height or drop-offs.',
      'The marked image zone is a heuristic. It does not determine ground contact, distance, a safe route, or collision probability.',
      'No detections or no alert does not establish a clear path.',
      'Frame upload and CPU processing add latency; measure the complete loop on the demo device.',
    ],
  }));

  app.post('/api/v1/sessions', {
    schema: { body: { type: 'object', additionalProperties: false, properties: { preset: { type: 'string', enum: ['standard', 'accessibility'] }, preferences: preferenceSchema } } },
  }, async (request, reply) => {
    const session = sessions.create(request.body.preset, request.body.preferences);
    return reply.code(201).send(sessions.public(session));
  });
  app.patch('/api/v1/sessions/:sessionId/preferences', {
    schema: { params: sessionParams, body: { ...preferenceSchema, minProperties: 1 } },
  }, async (request) => sessions.public(sessions.update(request.params.sessionId, request.body)));
  app.delete('/api/v1/sessions/:sessionId', { schema: { params: sessionParams } }, async (request, reply) => {
    sessions.delete(request.params.sessionId);
    return reply.code(204).send();
  });

  app.post('/api/v1/sessions/:sessionId/frames', {
    schema: {
      params: sessionParams,
      headers: { type: 'object', required: ['x-frame-sequence'], properties: { 'x-frame-sequence': { type: 'string', pattern: '^[1-9][0-9]{0,14}$' } } },
    },
  }, async (request, reply) => {
    const contentType = request.headers['content-type']?.split(';')[0].trim().toLowerCase();
    if (!['image/jpeg', 'image/png'].includes(contentType)) throw new ApiError(415, 'UNSUPPORTED_IMAGE_TYPE', 'Send raw JPEG or PNG bytes with the matching Content-Type.');
    if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') throw new ApiError(415, 'UNSUPPORTED_ENCODING', 'Encode the image directly without HTTP content compression.');
    const session = sessions.get(request.params.sessionId);
    const sequence = Number(request.headers['x-frame-sequence']);
    if (sequence <= session.lastSequence) throw new ApiError(409, 'STALE_FRAME', 'Use a new frame with a higher sequence number.');
    if (session.busy || frameInFlight) throw new ApiError(429, 'DETECTOR_BUSY', 'Another frame is being processed. Wait and capture a fresh frame.');
    if (detector.state !== 'ready') throw new ApiError(503, 'MODEL_NOT_READY', 'The detector is not ready. Check /ready.');

    session.busy = true;
    frameInFlight = true;
    session.lastSequence = sequence;
    const revision = session.revision;
    const started = performance.now();
    try {
      const frame = await decodeFrame(request.body, contentType);
      // Surface segmentation is slower than object detection, so it runs alongside without
      // blocking: each response carries the latest finished result and the frame it came from.
      if (surfaceDetector?.state === 'ready' && !surfaceDetector.pending) {
        surfaceDetector.analyze(frame).then((result) => { if (result) session.surface = { ...result, sequence }; });
      }
      const predictions = await detector.detect(frame, session.preferences.confidenceThreshold);
      const surface = session.surface && sequence - session.surface.sequence <= 5 ? session.surface : null;
      const current = sessions.get(session.sessionId, false);
      if (current !== session) throw new ApiError(404, 'SESSION_NOT_FOUND', 'The session ended while this frame was processing.');
      if (session.revision !== revision) throw new ApiError(409, 'SESSION_CHANGED', 'Preferences changed while the frame was processing. Capture a fresh frame.');
      if (request.raw.aborted || reply.raw.destroyed) throw new ApiError(409, 'FRAME_CANCELLED', 'This frame request was cancelled.');
      const detections = assessDetections(predictions, frame.width, frame.height, session.preferences.confidenceThreshold);
      const alert = session.policy.update(detections, clock());
      if (alert.triggered) alert.modalities = [...session.preferences.alertModes];
      return { frame: { sequence, width: frame.width, height: frame.height }, detections, alert, surface, processingMs: Math.round(performance.now() - started) };
    } catch (error) {
      if (session.revision === revision) session.policy.breakStreak();
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, 'INFERENCE_FAILED', 'Frame analysis failed. Capture a fresh frame and retry.');
    } finally {
      session.busy = false;
      frameInFlight = false;
    }
  });
  await app.ready();
  return app;
}
