import { handleDepthAsset } from './depth-assets.js';

// Static judging preview: no AI binding, sessions, frame upload, or model choice.
// The bundled frontend owns local inference. Optional depth assets stay allowlisted.
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/depth-assets' || path.startsWith('/depth-assets/')) return handleDepthAsset(request);
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Method not allowed.', {
        status: 405,
        headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' },
      });
    }
    if (path === '/api' || path.startsWith('/api/') || path === '/ready' || path === '/health') {
      return new Response('No remote inference API in this preview.', { status: 404 });
    }
    return env.ASSETS.fetch(request);
  },
};
