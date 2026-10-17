import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Script } from 'node:vm';
import { createPreviewServer } from './server.js';

let server;
let origin;
before(async () => {
  server = createPreviewServer({ apiOrigin: new URL('http://127.0.0.1:3001') });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

test('home and retained camera page serve their local scripts, styles, and linked assets', async () => {
  for (const path of ['/', '/camera.html', '/pip-test.html']) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /text\/html/);
    const html = await response.text();
    const assets = [...html.matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)="([^"]+)"/g)];
    assert.ok(assets.length > 0);
    for (const [, asset] of assets) {
      const url = new URL(asset, origin + path);
      if (url.origin !== origin) continue;
      assert.equal((await fetch(url)).status, 200, `${path} needs ${asset}`);
    }
  }
  assert.equal((await fetch(origin + '/logic.js')).status, 200);
});

test('removed camera routes and private repository files are unavailable', async () => {
  for (const path of ['/camera/', '/camera/camera.html', '/camera/camera.js',
    '/camera/camera.css', '/camera/backend-detector.js', '/camera/standalone.js',
    '/server.js', '/package.json', '/.git/config']) {
    assert.equal((await fetch(origin + path)).status, 404, path);
  }
});

test('both pages have unique IDs, one document, and valid inline JavaScript', async () => {
  for (const page of ['index.html', 'camera.html']) {
    const html = await readFile(new URL(page, import.meta.url), 'utf8');
    assert.equal([...html.matchAll(/<!doctype html>/gi)].length, 1, page);
    assert.equal([...html.matchAll(/<\/html>/gi)].length, 1, page);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${page} has duplicate IDs`);
    for (const [, attributes, code] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (!attributes.includes('src=')) new Script(code, { filename: page });
    }
    assert.doesNotMatch(html, /(?:src|href)="\/?(?:camera\/|site\.js|integration\.css)/);
  }
});
