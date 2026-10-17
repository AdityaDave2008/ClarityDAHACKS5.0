import { handleDepthAsset } from './depth-assets.js';

// No inference endpoint or stateful bindings. The only remote data is the existing
// optional, revision-pinned public depth model. Camera frames stay in the browser.
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/depth-assets' || path.startsWith('/depth-assets/')) return handleDepthAsset(request);
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Method not allowed.', { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
    }
    if (path.startsWith('/api/') || path === '/ready' || path === '/health') return new Response('No remote inference API in this preview.', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
