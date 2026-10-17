import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { handleDepthAsset } from '../src/depth-assets.js';
import worker from '../src/index.js';
import { createPreviewServer } from '../../frontend/server.js';

const prefix = '/depth-assets/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/';
const request = (path = 'config.json', options) => new Request(`https://app.example${prefix}${path}`, options);

test('only the three pinned files are fetched with clean requests and immutable responses', async () => {
  for (const file of ['config.json', 'preprocessor_config.json', 'onnx/model_quantized.onnx']) {
    const response = await handleDepthAsset(request(file + '?url=https://evil.example&token=secret', {
      headers: { Authorization: 'Bearer secret', Cookie: 'secret', Origin: 'https://evil.example', Range: 'bytes=0-4', 'X-Custom': 'secret' },
    }), async (input, options) => {
      const outgoing = new Request(input, options);
      assert.equal(outgoing.url, `https://huggingface.co${prefix.replace('/depth-assets', '')}${file}`);
      assert.equal(outgoing.method, 'GET');
      assert.deepEqual([...outgoing.headers], []);
      return new Response('asset', { headers: { 'Set-Cookie': 'bad', 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' } });
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'asset');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(response.headers.get('content-type'), file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
    for (const name of ['set-cookie', 'access-control-allow-origin', 'content-encoding']) assert.equal(response.headers.get(name), null);
  }
});

test('unknown and encoded paths never fetch', async () => {
  const paths = ['config.json/', 'config.json/extra', '%63onfig.json', 'onnx%2fmodel_quantized.onnx', 'onnx/%252e%252e/config.json', 'onnx/%2e%2e%2fconfig.json', '../config.json', 'model.onnx', 'https://evil.example', '', 'config.json%00'];
  for (const path of paths) {
    const response = await handleDepthAsset(request(path), () => assert.fail('unknown path fetched'));
    assert.equal(response.status, 404, path);
  }
  for (const path of [prefix.replace('4472b7362082ad9968fee890ca0f1e5aca36b93d', 'main') + 'config.json', '/depth-assets/other/config.json']) {
    assert.equal((await handleDepthAsset(new Request('https://app.example' + path), () => assert.fail('fetched'))).status, 404);
  }
});

test('wrong methods fail closed without fetching', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await handleDepthAsset(request('config.json', { method }), () => assert.fail('fetched'));
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('HEAD uses upstream HEAD and has no response body', async () => {
  const response = await handleDepthAsset(request('config.json', { method: 'HEAD' }), async (input, options) => {
    assert.equal(new Request(input, options).method, 'HEAD');
    return new Response(null);
  });
  assert.equal(response.status, 200);
  assert.equal(response.body, null);
});

test('upstream errors and unexpected status have safe uncacheable 502 bodies', async () => {
  for (const upstream of [async () => { throw new Error('private credentials'); }, ...[301, 403, 404, 206, 500].map(status => async () => new Response('private upstream body', { status }))]) {
    const response = await handleDepthAsset(request(), upstream);
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), 'Model asset unavailable.');
  }
});

test('GET passes through the original stream without consuming or buffering it', { timeout: 1000 }, async () => {
  let controller;
  const stream = new ReadableStream({ start(value) { controller = value; } });
  const upstream = new Response(stream);
  upstream.arrayBuffer = upstream.text = upstream.blob = () => assert.fail('buffered asset');
  const response = await handleDepthAsset(request('onnx/model_quantized.onnx'), async () => upstream);
  assert.equal(response.body, upstream.body);
  assert.equal(upstream.bodyUsed, false);
  const reader = response.body.getReader();
  controller.enqueue(new Uint8Array([1, 2, 3]));
  assert.deepEqual((await reader.read()).value, new Uint8Array([1, 2, 3]));
  controller.close();
  assert.equal((await reader.read()).done, true);
});

test('worker owns asset namespace before OPTIONS and static fallback', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('worker asset'));
  const env = { ASSETS: { fetch: () => assert.fail('static fallback reached') } };
  assert.equal(await (await worker.fetch(request(), env)).text(), 'worker asset');
  assert.equal((await worker.fetch(request('config.json', { method: 'OPTIONS' }), env)).status, 405);
  assert.equal((await worker.fetch(request('unknown'), env)).status, 404);
});

test('preview serves the same model namespace through the shared handler', async t => {
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    if (String(input).startsWith('https://huggingface.co/')) return new Response('preview asset');
    return realFetch(input, options);
  });
  const server = createPreviewServer({ apiOrigin: new URL('http://127.0.0.1:1') });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + prefix + 'config.json');
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'preview asset');
  assert.match(response.headers.get('cache-control'), /immutable/);
  assert.equal((await fetch(base + prefix + 'config.json', { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(base + prefix + 'config.json', { method: 'OPTIONS' })).status, 405);
  assert.equal((await fetch(base + prefix + 'unknown')).status, 404);
});
