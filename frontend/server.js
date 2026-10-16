import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const MAX_BODY_BYTES = 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 20_000;
const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/camera.html', ['camera.html', 'text/html; charset=utf-8']],
  ['/homePage.css', ['homePage.css', 'text/css; charset=utf-8']],
  ['/main.html', ['index.html', 'text/html; charset=utf-8']],
  ['/camera.html', ['camera.html', 'text/html; charset=utf-8']],
  ['/homePage.css', ['homePage.css', 'text/css; charset=utf-8']],
  ['/integration.css', ['integration.css', 'text/css; charset=utf-8']],
  ['/site.js', ['site.js', 'text/javascript; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/logic.js', ['logic.js', 'text/javascript; charset=utf-8']],
  ['/camera/', ['camera/camera.html', 'text/html; charset=utf-8']],
  ['/camera/camera.html', ['camera/camera.html', 'text/html; charset=utf-8']],
  ['/camera/camera.css', ['camera/camera.css', 'text/css; charset=utf-8']],
  ['/camera/camera.js', ['camera/camera.js', 'text/javascript; charset=utf-8']],
  ['/camera/backend-detector.js', ['camera/backend-detector.js', 'text/javascript; charset=utf-8']],
  ['/camera/standalone.js', ['camera/standalone.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json; charset=utf-8']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ['/demo-scene.svg', ['demo-scene.svg', 'image/svg+xml']],
  ['/icons/icon.svg', ['icons/icon.svg', 'image/svg+xml']],
  ['/icons/apple-touch-icon.png', ['icons/apple-touch-icon.png', 'image/png']],
  ['/icons/icon-192.png', ['icons/icon-192.png', 'image/png']],
  ['/icons/icon-512.png', ['icons/icon-512.png', 'image/png']],
]);

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

export function loadPreviewConfig(env = process.env) {
  const host = env.HOST ?? '127.0.0.1';
  const portValue = env.PORT ?? '5180';
  if (!host || /[\s/\\]/.test(host)) throw new Error('HOST must be a valid host name or IP address.');
  if (!/^\d+$/.test(portValue) || Number(portValue) < 1 || Number(portValue) > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535.');
  }
  let apiOrigin;
  try { apiOrigin = new URL(env.API_ORIGIN ?? 'http://127.0.0.1:3001'); }
  catch { throw new Error('API_ORIGIN must be an HTTP or HTTPS origin, such as http://127.0.0.1:3001.'); }
  if (!['http:', 'https:'].includes(apiOrigin.protocol) || apiOrigin.username || apiOrigin.password
    || apiOrigin.pathname !== '/' || apiOrigin.search || apiOrigin.hash) {
    throw new Error('API_ORIGIN must contain only an HTTP or HTTPS scheme, host, and optional port.');
  }
  return { host, port: Number(portValue), apiOrigin };
}

function sendJson(response, status, code, message) {
  if (response.destroyed || response.headersSent) return;
  const body = Buffer.from(JSON.stringify({ error: { code, message } }));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

function copyEndToEndHeaders(headers, omit = []) {
  const connectionHeaders = String(headers.connection ?? '').toLowerCase().split(',').map((value) => value.trim());
  const skipped = new Set([...HOP_BY_HOP, ...connectionHeaders, ...omit]);
  return Object.fromEntries(Object.entries(headers).filter(([name, value]) => !skipped.has(name.toLowerCase()) && value !== undefined));
}

async function readRequestBody(request, response) {
  const declaredSize = request.headers['content-length'];
  if (declaredSize !== undefined && (!/^\d+$/.test(declaredSize) || Number(declaredSize) > MAX_BODY_BYTES)) {
    sendJson(response, 413, 'FRAME_TOO_LARGE', 'Request body must be at most 1 MiB. Resize the camera frame before uploading.');
    request.resume();
    return null;
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    function cleanup() {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('aborted', onAborted);
    }
    function onData(chunk) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        cleanup();
        sendJson(response, 413, 'FRAME_TOO_LARGE', 'Request body must be at most 1 MiB. Resize the camera frame before uploading.');
        request.resume();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    }
    function onEnd() { cleanup(); resolve(Buffer.concat(chunks, size)); }
    function onError(error) { cleanup(); reject(error); }
    function onAborted() { onError(new Error('Client stopped uploading.')); }
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
    request.once('aborted', onAborted);
  });
}

async function proxyToApi(request, response, url, apiOrigin) {
  const body = await readRequestBody(request, response);
  if (body === null || response.destroyed || request.aborted) return;
  const headers = copyEndToEndHeaders(request.headers, ['origin', 'host', 'content-length']);
  if (body.length || request.headers['content-length'] !== undefined) headers['content-length'] = String(body.length);
  headers.host = apiOrigin.host;
  const transport = apiOrigin.protocol === 'https:' ? https : http;
  const upstream = transport.request({
    protocol: apiOrigin.protocol,
    hostname: apiOrigin.hostname.replace(/^\[|\]$/g, ''),
    port: apiOrigin.port || undefined,
    method: request.method,
    path: `${url.pathname}${url.search}`,
    headers,
  }, (incoming) => {
    if (response.destroyed) { incoming.destroy(); return; }
    response.writeHead(incoming.statusCode ?? 502, copyEndToEndHeaders(incoming.headers));
    incoming.on('error', () => response.destroy());
    incoming.pipe(response);
  });
  upstream.setTimeout(UPSTREAM_TIMEOUT_MS, () => upstream.destroy(new Error('Upstream timeout')));
  upstream.on('error', () => {
    if (response.headersSent) response.destroy();
    else sendJson(response, 503, 'BACKEND_UNAVAILABLE', 'The detection backend is unavailable. In another terminal, run cd backend && npm ci && npm start; then retry. Check API_ORIGIN if using another backend address.');
  });
  response.on('close', () => upstream.destroy());
  upstream.end(body);
}

export function createPreviewServer({ apiOrigin } = loadPreviewConfig()) {
  return http.createServer({ requestTimeout: 30_000, headersTimeout: 10_000 }, async (request, response) => {
    request.on('error', () => {});
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (!request.url?.startsWith('/') || request.url.startsWith('//') || request.url.includes('\\')) {
        sendJson(response, 400, 'INVALID_PATH', 'Use a relative application URL.');
        return;
      }
      const url = new URL(request.url, 'http://preview.local');
      if (url.pathname.startsWith('/api/') || ['/ready', '/health'].includes(url.pathname)) {
        await proxyToApi(request, response, url, apiOrigin);
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.setHeader('Allow', 'GET, HEAD');
        sendJson(response, 405, 'METHOD_NOT_ALLOWED', 'Static frontend files accept GET and HEAD requests.');
        return;
      }
      const asset = ASSETS.get(url.pathname);
      if (!asset) { sendJson(response, 404, 'NOT_FOUND', 'This preview serves only the browser demo assets and detection API.'); return; }
      let content;
      try { content = await readFile(new URL(asset[0], import.meta.url)); }
      catch (error) {
        if (error.code === 'ENOENT') sendJson(response, 404, 'ASSET_NOT_FOUND', 'This demo asset is not available. Confirm the frontend files are present.');
        else sendJson(response, 500, 'ASSET_UNAVAILABLE', 'The preview could not read this demo asset.');
        return;
      }
      response.writeHead(200, { 'Content-Type': asset[1], 'Content-Length': content.length });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch {
      sendJson(response, 400, 'INVALID_REQUEST', 'The request could not be processed. Check the URL and uploaded frame.');
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const config = loadPreviewConfig();
    const server = createPreviewServer(config);
    server.on('error', (error) => {
      console.error(error.code === 'EADDRINUSE'
        ? 'Preview port is already in use. Stop the existing preview or set PORT to another value.'
        : 'Preview could not start. Check HOST, PORT, and local networking permissions.');
      process.exitCode = 1;
    });
    server.listen(config.port, config.host, () => {
      const displayHost = config.host.includes(':') ? `[${config.host}]` : config.host;
      console.log(`StepSense preview: http://${displayHost}:${config.port}`);
      console.log('API proxy ready. Start the backend separately for live detection.');
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
