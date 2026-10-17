// Measures real server-side frame latency at each capture size the browser uses.
// Usage: node scripts/measure-latency.js [/absolute/path/to/photo.jpg]
// Without a photo it uses a generated image, which measures the pipeline, not detection quality.
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { buildApp } from '../app.js';
import { WorkerDetector } from '../detector.js';

const source = process.argv[2];
const sizes = [640, 512, 384];
const frames = Number(process.env.FRAMES || 12);

async function imageAt(maxSide) {
  const base = source
    ? sharp(await readFile(source))
    : sharp({ create: { width: 1280, height: 960, channels: 3, background: { r: 120, g: 130, b: 140 } } });
  return base.resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

const detector = new WorkerDetector();
const app = await buildApp({ detector });
const startedAt = performance.now();
try {
  await detector.waitUntilReady();
  console.log(`Model ready in ${Math.round(performance.now() - startedAt)} ms. Source: ${source || 'generated image'}.`);
  console.log('| Capture max side | JPEG bytes | Frames | Median ms | p95 ms | Max ms |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const maxSide of sizes) {
    const body = await imageAt(maxSide);
    const created = await app.inject({ method: 'POST', url: '/api/v1/sessions', payload: {} });
    const { sessionId } = created.json();
    const samples = [];
    for (let sequence = 1; sequence <= frames; sequence++) {
      const began = performance.now();
      const response = await app.inject({ method: 'POST', url: `/api/v1/sessions/${sessionId}/frames`,
        headers: { 'Content-Type': 'image/jpeg', 'X-Frame-Sequence': String(sequence) }, payload: body });
      if (response.statusCode !== 200) throw new Error(`Frame request failed with ${response.statusCode}.`);
      samples.push(performance.now() - began);
    }
    await app.inject({ method: 'DELETE', url: `/api/v1/sessions/${sessionId}` });
    // The first frame includes warm-up allocations, so it is reported but not hidden.
    console.log(`| ${maxSide} | ${body.length} | ${frames} | ${Math.round(percentile(samples, 0.5))} | ${Math.round(percentile(samples, 0.95))} | ${Math.round(Math.max(...samples))} |`);
  }
  console.log('These are in-process server measurements on this machine. They exclude camera capture, JPEG encoding in the browser, and network transport.');
} finally { await app.close(); }
