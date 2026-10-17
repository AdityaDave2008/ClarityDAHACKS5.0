import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createPreviewServer } from './server.js';

function worker() {
  const origin = 'https://example.test';
  const handlers = {}, stores = new Map(), requests = [];
  let offline = false;
  const key = request => new URL(typeof request === 'string' ? request : request.url, origin).href;
  function cacheFor(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      async addAll(paths) { for (const path of paths) store.set(key(path), new Response(`precache:${path}`)); },
      async match(request) { return store.get(key(request))?.clone(); },
      async put(request, response) { store.set(key(request), response.clone()); },
    };
  }
  const caches = {
    open: async name => cacheFor(name), keys: async () => [...stores.keys()], delete: async name => stores.delete(name),
    async match(request) { for (const store of stores.values()) if (store.has(key(request))) return store.get(key(request)).clone(); },
  };
  vm.runInNewContext(readFileSync(new URL('./sw.js', import.meta.url), 'utf8'), {
    self: { addEventListener: (name, handler) => { handlers[name] = handler; }, skipWaiting: async () => {},
      clients: { claim: async () => {} }, location: { origin } },
    caches, URL, Response,
    fetch: async request => {
      requests.push(key(request));
      if (offline) throw new Error('offline');
      return new Response('fresh network');
    },
  });
  async function dispatch(name, extra = {}) {
    const waits = [];
    let response;
    handlers[name]({ ...extra, waitUntil: promise => waits.push(promise), respondWith: promise => { response = promise; } });
    if (response) response = await response;
    await Promise.all(waits);
    return response;
  }
  return { stores, cacheFor, dispatch, requests, setOffline: value => { offline = value; },
    request: (path, method = 'GET') => ({ url: new URL(path, origin).href, method }) };
}

test('model-neutral PiP precache installs only assets served by this baseline', async () => {
  const w = worker();
  await w.dispatch('install');
  const [name, assets] = [...w.stores][0];
  assert.match(name, /^myeyes-pwa-v13-model-first-screen$/);
  const paths = [...assets.keys()].map(url => new URL(url).pathname);
  for (const path of ['/index.html', '/camera.js', '/picture-in-picture.js', '/local-detector.js', '/depth-ui.js']) assert.ok(paths.includes(path), path);
  assert.ok(paths.every(path => !/candidate|yolox|tracking/.test(path)), 'Removed experimental assets must not return through precache');
  const server = createPreviewServer({ apiOrigin: new URL('http://127.0.0.1:3001') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const path of paths) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
      assert.equal(response.status, 200, `cache.addAll would fail for ${path}`);
      await response.arrayBuffer();
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('activation removes both prior app cache histories without deleting unrelated caches', async () => {
  const w = worker();
  for (const name of ['myeyes-pwa-v12-model-first', 'myeyes-pwa-v11-pip-object-alerts', 'myeyes-pwa-v9-depth-assets', 'myeyes-pwa-v9-pip-yolox-51661711', 'unrelated-app']) w.cacheFor(name);
  await w.dispatch('install');
  await w.dispatch('activate');
  assert.equal(w.stores.size, 2);
  assert.ok(w.stores.has('unrelated-app'));
  assert.ok(!w.stores.has('myeyes-pwa-v12-model-first'));
  assert.ok(!w.stores.has('myeyes-pwa-v11-pip-object-alerts'));
  assert.ok(!w.stores.has('myeyes-pwa-v9-depth-assets'));
  assert.ok(!w.stores.has('myeyes-pwa-v9-pip-yolox-51661711'));
});

test('runtime model requests ignore unrelated stale caches and reuse only current cache', async () => {
  const w = worker();
  const request = w.request('/vendor/model/model.json');
  await w.cacheFor('unrelated-app').put(request, new Response('stale model'));
  await w.dispatch('install');
  assert.equal(await (await w.dispatch('fetch', { request })).text(), 'fresh network');
  w.setOffline(true);
  assert.equal(await (await w.dispatch('fetch', { request })).text(), 'fresh network');
  assert.equal(w.requests.length, 1);
});

test('offline PiP module fallback ignores unrelated stale app entries', async () => {
  const w = worker();
  const request = w.request('/picture-in-picture.js');
  await w.cacheFor('unrelated-app').put(request, new Response('stale script'));
  await w.dispatch('install');
  w.setOffline(true);
  assert.equal(await (await w.dispatch('fetch', { request })).text(), 'precache:/picture-in-picture.js');
});

test('unrelated paths, cross-origin requests and uploads are not intercepted or cached', async () => {
  const w = worker();
  await w.dispatch('install');
  for (const request of [w.request('/ready'), w.request('/api/v1/sessions'), w.request('/picture-in-picture.js', 'POST'),
    w.request('https://another.test/picture-in-picture.js')]) {
    assert.equal(await w.dispatch('fetch', { request }), undefined);
  }
  assert.equal(w.requests.length, 0);
});
