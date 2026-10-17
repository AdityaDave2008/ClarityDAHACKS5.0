// Dev server for the sample: serves index.html and proxies the API on the same origin,
// so one HTTPS tunnel URL works on a phone. Usage: node serve.mjs  (backend on :3001)
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const PORT = Number(process.env.PORT || 5173);
const API = process.env.API || 'http://127.0.0.1:3001';
const page = new URL('./index.html', import.meta.url);

const isApi = (url) => url.startsWith('/api/') || url === '/ready' || url === '/health';

http.createServer(async (req, res) => {
  if (!isApi(req.url)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(await readFile(page));
  }
  // Same-origin from the browser's view, so drop Origin; the backend then skips its CORS allowlist.
  const headers = { ...req.headers };
  delete headers.origin; delete headers.host; delete headers.referer;
  const upstream = http.request(API + req.url, { method: req.method, headers }, (up) => {
    res.writeHead(up.statusCode, up.headers);
    up.pipe(res);
  });
  upstream.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'BACKEND_DOWN', message: 'Backend is not reachable.' } }));
  });
  req.pipe(upstream);
}).listen(PORT, '127.0.0.1', () => console.log(`sample on http://127.0.0.1:${PORT} -> ${API}`));
