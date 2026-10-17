// Public, immutable model bytes only. Inference and camera frames stay in the browser.
export const DEPTH_ASSET_PREFIX = '/depth-assets/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/';
const FILES = new Set(['config.json', 'preprocessor_config.json', 'onnx/model_quantized.onnx']);

function failure(request, status, message, headers = {}) {
  return new Response(request.method === 'HEAD' ? null : message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}

/** Standard Web APIs only, shared by the Worker and the Node preview server. */
export async function handleDepthAsset(request, fetchImpl = fetch) {
  const path = new URL(request.url).pathname;
  const file = path.startsWith(DEPTH_ASSET_PREFIX) ? path.slice(DEPTH_ASSET_PREFIX.length) : '';
  if (!FILES.has(file)) return failure(request, 404, 'Not found.');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return failure(request, 405, 'Method not allowed.', { Allow: 'GET, HEAD' });
  }

  try {
    // Build from constants plus the exact allowlist match, never user query/headers/body.
    // HF redirects pinned files to its public storage CDN, so follow those server-side.
    const upstream = await fetchImpl(`https://huggingface.co${DEPTH_ASSET_PREFIX.slice('/depth-assets'.length)}${file}`, {
      method: request.method,
      redirect: 'follow',
    });
    if (upstream.status !== 200) {
      if (upstream.body) await upstream.body.cancel();
      return failure(request, 502, 'Model asset unavailable.');
    }
    if (request.method === 'HEAD' && upstream.body) await upstream.body.cancel();
    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      headers: {
        'Content-Type': file.endsWith('.json') ? 'application/json' : 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return failure(request, 502, 'Model asset unavailable.');
  }
}
