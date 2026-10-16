import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';
import { WorkerDetector } from '../detector.js';

const filename = process.argv[2];
if (!filename || !/\.(jpe?g|png)$/i.test(filename)) {
  console.error('Usage: npm run smoke:model -- /absolute/path/to/a-small-photo.jpg');
  process.exit(1);
}
const body = await readFile(filename);
const detector = new WorkerDetector();
const app = await buildApp({ detector });
const started = performance.now();
try {
  await detector.waitUntilReady();
  console.log(JSON.stringify({ modelReadyMs: Math.round(performance.now() - started) }));
  const created = await app.inject({ method: 'POST', url: '/api/v1/sessions', payload: { preferences: { confidenceThreshold: 0.4 } } });
  if (created.statusCode !== 201) throw new Error('Session creation failed.');
  const { sessionId } = created.json();
  const results = [];
  for (const sequence of [1, 2]) {
    const result = await app.inject({ method: 'POST', url: `/api/v1/sessions/${sessionId}/frames`, headers: { 'Content-Type': /\.png$/i.test(filename) ? 'image/png' : 'image/jpeg', 'X-Frame-Sequence': String(sequence) }, payload: body });
    console.log(JSON.stringify({ statusCode: result.statusCode, ...result.json() }));
    if (result.statusCode !== 200) throw new Error('Real model frame request failed.');
    results.push(result.json());
  }
  if (results[0].detections.some((item) => item.inZone)) assert.equal(results[1].alert.triggered, true, 'The repeated frame did not trigger an alert. Check inference latency against the confirmation window.');
} finally { await app.close(); }
