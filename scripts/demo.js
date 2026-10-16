import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const lan = process.argv.includes('--lan');
let reuseBackend = false;
try {
  const response = await fetch('http://127.0.0.1:3001/api/v1/model', { signal: AbortSignal.timeout(1200) });
  const model = await response.json();
  reuseBackend = response.ok && model.name === 'coco-ssd' && Array.isArray(model.supportedLabels);
} catch { /* Start our own backend when none is already running. */ }
const projects = reuseBackend ? ['frontend'] : ['backend', 'frontend'];
if (reuseBackend) console.log('Reusing the existing StepSense API on port 3001.');
const children = [];
let shuttingDown = false;
function stop(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = code;
  children.forEach((child) => child.kill('SIGTERM'));
}
for (const project of projects) {
  const child = spawn(process.execPath, project === 'backend' ? ['--env-file-if-exists=.env', 'server.js'] : ['server.js'], {
    cwd: fileURLToPath(new URL(`../${project}/`, import.meta.url)),
    env: { ...process.env, HOST: lan ? '0.0.0.0' : '127.0.0.1', PORT: project === 'backend' ? '3001' : '5180' },
    stdio: 'inherit',
  });
  children.push(child);
  child.on('error', () => { console.error(`Could not launch ${project}. Run npm --prefix backend ci first.`); stop(1); });
  child.on('exit', (code, signal) => { if (!shuttingDown) { console.error(`${project} stopped${signal ? ` (${signal})` : ''}.`); stop(code || 1); } });
}
console.log('Starting the combined ClearPath website at http://localhost:5180');
console.log('Open Camera, then Start. AI detection needs the backend model to finish loading. The original walkthrough is at /camera.html.');
if (lan) {
  if (reuseBackend) console.log('An existing API is being reused. Native phones can reach it only if it was started with HOST=0.0.0.0.');
  for (const entries of Object.values(networkInterfaces())) for (const address of entries || []) {
    if (address.family === 'IPv4' && !address.internal) console.log(`Native phone app backend on this Wi-Fi: http://${address.address}:3001`);
  }
  console.log('Phone browsers require trusted HTTPS for camera access; HTTP LAN URLs are for the native development samples.');
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
