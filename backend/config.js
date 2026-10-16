export const LIMITS = Object.freeze({
  maxFrameBytes: 1024 * 1024,
  maxImagePixels: 1_000_000,
  maxImageSide: 1280,
  processedMaxSide: 640,
});

function integer(env, key, fallback, minimum, maximum) {
  if (env[key] === undefined || env[key] === '') return fallback;
  const value = Number(env[key]);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${key}`);
  return value;
}

export function loadConfig(env = process.env) {
  const allowedOrigins = (env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((item) => item.trim()).filter(Boolean);
  for (const origin of allowedOrigins) {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('ALLOWED_ORIGINS must contain exact HTTP(S) origins without paths or wildcards.');
  }
  return {
    host: env.HOST || '127.0.0.1',
    port: integer(env, 'PORT', 3001, 1, 65535),
    allowedOrigins,
    sessionTtlMs: integer(env, 'SESSION_TTL_MS', 1_800_000, 1000, 86_400_000),
    maxSessions: integer(env, 'MAX_SESSIONS', 200, 1, 10000),
    inferenceTimeoutMs: integer(env, 'INFERENCE_TIMEOUT_MS', 15000, 1000, 60000),
    logLevel: env.LOG_LEVEL || 'info',
    surfaceModel: (env.SURFACE_MODEL || 'on') !== 'off',
    surfaceInputSize: integer(env, 'SURFACE_INPUT_SIZE', 320, 128, 512),
  };
}
