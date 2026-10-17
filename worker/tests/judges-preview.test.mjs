import test from 'node:test';
import assert from 'node:assert/strict';

test('judge preview serves static assets but never accepts inference uploads', async () => {
  const { default: worker } = await import('../src/judges-preview.js');
  const served = [];
  const env = { ASSETS: { fetch: async request => {
    served.push(request.method);
    return new Response(request.method === 'HEAD' ? null : 'static');
  } } };
  assert.equal(await (await worker.fetch(new Request('https://preview.test/'), env)).text(), 'static');
  assert.equal((await worker.fetch(new Request('https://preview.test/', { method: 'HEAD' }), env)).status, 200);
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    const response = await worker.fetch(new Request('https://preview.test/api/v1/sessions', { method }), env);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET, HEAD');
  }
  for (const path of ['/api', '/api/v1/model', '/ready', '/health', '/depth-assets/unknown']) {
    assert.equal((await worker.fetch(new Request(`https://preview.test${path}`), env)).status, 404);
  }
  assert.deepEqual(served, ['GET', 'HEAD']);
});
