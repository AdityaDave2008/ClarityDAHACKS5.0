import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { WorkerDetector } from './detector.js';
import { SurfaceDetector } from './surface-detector.js';

const config = loadConfig();
const detector = new WorkerDetector({ timeoutMs: config.inferenceTimeoutMs });
const surfaceDetector = config.surfaceModel
  ? new SurfaceDetector({ cacheDir: fileURLToPath(new URL('./.cache/segformer', import.meta.url)), inputSize: config.surfaceInputSize })
  : null;
let app;
try {
  app = await buildApp({ detector, surfaceDetector, config, logger: { level: config.logLevel } });
  await app.listen({ host: config.host, port: config.port });
  detector.waitUntilReady().then(() => app.log.info('COCO-SSD model ready'), () => app.log.error('Model unavailable. Check network access and restart the backend.'));
  surfaceDetector?.waitUntilReady().then(() => app.log.info('Surface model ready'), () => app.log.warn('Surface model unavailable; continuing with object detection only.'));
} catch (error) {
  if (app) await app.close(); else { await detector.close(); await surfaceDetector?.close(); }
  console.error(error.code === 'EADDRINUSE' ? 'API port is already in use.' : 'Backend could not start. Check configuration, permissions, and logs.');
  process.exitCode = 1;
}

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await app?.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
