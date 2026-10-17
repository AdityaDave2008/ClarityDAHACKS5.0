# Optional depth model provenance and validation

Verified 2026-10-17. This is experimental **relative inverse depth**, not metres, LiDAR, obstacle clearance, or a walking-safety signal. Physical accuracy and mobile latency are unverified.

## Selected immutable artifacts

- Runtime: `@huggingface/transformers@3.7.2`, Apache-2.0. Files copied byte-for-byte from its npm `dist/` directory into `frontend/vendor-depth/`.
- Embedded ONNX Runtime Web: `1.22.0-dev.20250409-89f8206ba4`, exactly the dependency declared by Transformers.js 3.7.2. MIT. WASM and its JS loader come from the **same Transformers.js npm distribution**, not a mixed ORT release.
- Bundled Hugging Face Jinja: MIT. Runtime licenses and ONNX third-party notices are retained beside the files. ONNX notices/license source: `https://raw.githubusercontent.com/microsoft/onnxruntime/89f8206ba4/{LICENSE,ThirdPartyNotices.txt}`.
- Model: `onnx-community/depth-anything-v2-small`, revision **`4472b7362082ad9968fee890ca0f1e5aca36b93d`**, `dtype: 'q8'`, artifact `onnx/model_quantized.onnx`.
- License: Apache-2.0, explicitly declared by the [pinned ONNX model card](https://huggingface.co/onnx-community/depth-anything-v2-small/blob/4472b7362082ad9968fee890ca0f1e5aca36b93d/README.md) and upstream `depth-anything/Depth-Anything-V2-Small` metadata (inspected revision `03876f8651c73a60fe4c2c48294e09fcb6838fcf`). This is **Small**, not a differently licensed Base/Large model.
- The ONNX card points to newer `depth-anything-v2-small-ONNX`. We deliberately retain the older, immutable export because **this exact export/runtime combination was actually executed successfully**. No floating `main`, `latest`, newer model redirect, or unverified conversion is used in production.

### Verified bytes and SHA-256

Hashes below were computed from downloaded bytes, not inferred from filenames. The model hash also matches Hugging Face's LFS SHA-256 metadata.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `vendor-depth/transformers.min.js` | 871803 | `489ae9fa3deae4eed28f83b9f94a32342c63cffdabd56ad990f76d28c858a1c2` |
| `vendor-depth/ort-wasm-simd-threaded.jsep.mjs` | 44484 | `08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9` |
| `vendor-depth/ort-wasm-simd-threaded.jsep.wasm` | 21596019 | `c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39` |
| HF `onnx/model_quantized.onnx` | 27258801 | `fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d` |
| HF `config.json` | 38 | `3aee5b9bc4f711ee885c2526d871f0c8c6c8c4b26b8e04253d0167f6a83264f5` |
| HF `preprocessor_config.json` | 461 | `03576db3c13dd0471fdf5f5e1428befcb95de063fe699879150b293dc9e0a2c6` |

Runtime binary/JS total: **22,512,306 bytes**. Model plus runtime: **49,771,107 bytes**, approximately **49.8 MB** (47.5 MiB), plus 499 bytes model configuration and small app modules. HTTP compression/cache can reduce transferred bytes. The exported download constants describe artifact bytes, not a guaranteed network bill.

All local files individually fit Cloudflare's 25 MiB static-asset limit. The 27,258,801-byte ONNX model deliberately is **not** bundled into Cloudflare static assets. It downloads from:

```text
https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/onnx/model_quantized.onnx
```

HF may redirect to its content-addressed CDN. This is a model download, not inference or a frame upload. The app pins revisions and vendors runtime bytes, but does not independently recompute the model hash on each browser load. The table is build/provenance verification, not a claim of runtime SRI enforcement.

## Adapter and operational bounds

`frontend/depth-model.js` exports:

```js
createDepthModel(optionalDependencies)
MODEL_DOWNLOAD_BYTES // 27258801
RUNTIME_DOWNLOAD_BYTES // 22512306
MODEL_ID
MODEL_REVISION
MODEL_INPUT_SIZE // 252
normalizeDepthMap(map)
```

`load({onStatus})` resolves `{device: 'webgpu'|'wasm'}` or rejects. Status callback values are `{status: 'loading'|'ready'|'unavailable', device?, reason?, progress?}`. `estimate(canvas)` resolves `{data: Float32Array, width, height}` or rejects. `dispose()` cancels/invalidate pending work and terminates the browser worker. Repeated load is coalesced. At most one inference runs per adapter. Optional dependency injection exists for tests, not production configuration.

Importing the adapter is safe before opt-in. Runtime import, worker creation, and downloads begin only inside explicit `load()`. **Do not precache `vendor-depth` assets in the service worker**. Required lazy static paths:

```text
/depth-model.js
/vendor-depth/depth-worker.js
/vendor-depth/transformers.min.js
/vendor-depth/ort-wasm-simd-threaded.jsep.mjs
/vendor-depth/ort-wasm-simd-threaded.jsep.wasm
```

Serve `.js`/`.mjs` as JavaScript and `.wasm` as `application/wasm`. `depth-worker.js` is application code, not vendored upstream code. It uses a dedicated module Worker and OffscreenCanvas. Missing worker/offscreen/WASM capability fails closed, rather than falling back to blocking v1 on the main thread.

The main thread makes a same-frame `getImageData` copy, transfers its pixel buffer to the worker, and receives a transferable raw float tensor. No frame is passed to a network API. Actual browser network observation showed only GETs for static modules, local test photo and immutable HF assets, with no POST/upload requests.

WebGPU is selected only after `requestAdapter()` **and** `requestDevice()` succeed. The temporary device is destroyed. Each probe is bounded at 2 seconds. A WebGPU pipeline creation failure falls back once to WASM. WASM is explicitly `numThreads=1`, `proxy=false` inside our dedicated worker, so COOP/COEP and SharedArrayBuffer are not required. WebGPU hardware execution remains unverified on this host.

Load deadline is 120 seconds, inference deadline 15 seconds. The browser facade terminates its worker at either deadline, even if WASM is busy, and does not retry indefinitely. Dispose also terminates in-flight downloads/computation. The lower-level injectable test core has promise deadlines and deferred cleanup, but production browser execution is always the worker facade. Canvas input/output is capped at 4,194,304 pixels and input aspect ratio at 4:1. This bounds preprocessing shape, not total system memory, which remains device-dependent.

DPT image processing uses the actual supported processor `size={width:252,height:252}` instead of upstream 518. Aspect ratio and multiple-of-14 constraints remain enabled. A real 320x212 canvas produced input tensor **[1,3,252,378]**, verified by invoking the pinned real processor. This is reduced-resolution experimental inference, not a claim of upstream full-resolution accuracy parity.

The pipeline's **`predicted_depth` tensor** is used. Its raw floating values are bilinearly resized to input canvas dimensions by the upstream pipeline, without per-frame min/max normalization. The separate `depth` uint8 visualization is never used by the adapter. Higher values mean nearer relative inverse depth, with arbitrary image-dependent scale/offset. No metric fields or conversion are provided.

## Actual browser inference evidence

Host: macOS arm64, Apple M4. Browser: isolated Playwright Chromium **153.0.8010.12**, headless, `crossOriginIsolated=false`. This is not phone benchmarking.

Image: real photograph of bread shelves, downloaded to scratch only from `https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/bread_small.png`. Image SHA-256 `3a55bd3a9fea97fbe511a4b6f9c3c964f40fe67331cf1567d23ade2f6fb4fe63`. Fixture URL is not production configuration. It is not redistributed in this repository. Test canvas 320x212, original image 640x424.

| Run | Observed result |
| --- | --- |
| Initial original 518 processor, before optimization | WASM load 2043.6 ms, inference 4016.6 ms. Raw range 0.7280941..3.1333497. This was superseded by worker+252 configuration. |
| Production worker +252 processor | Load 2706.7 ms, inference 2319.9 ms. Raw output 320x212, **all 67,840 values finite**, range 0.7608626..2.9031565. |
| Same-photo ordering sanity check | Front wooden divider at normalized (0.43,0.5): **2.5325463**, dark recessed back at (0.34,0.72): **0.9417257**. Nearer surface has larger raw inverse depth as expected. One photo is not an accuracy study. |
| Main-thread responsiveness during worker inference | 20 ms interval fired **115 times**, maximum observed interval **21.6 ms** during the 2319.9 ms inference. |
| Separate repeated same-worker run | Inferences **4587.0 / 2843.0 / 2164.3 ms**. Each returned 320x212 finite maps. 20 ms timer fired 229 /142 /108 times, maximum gaps 21.9 /21.2 /21.5 ms. Host contention affects timing. |
| Raw processor verification | Actual `pixel_values.dims = [1,3,252,378]`. |
| Network privacy observation | Only GET model/config/runtime/local fixture requests. No frame uploads. |
| Final adapter opt-in/cancel/reload check | **Zero** runtime/HF requests before `load()`. Disposing 50 ms into real inference rejected with `Depth operation cancelled` at **55.8 ms**. Reload then returned another finite 320x212 map. |

These timings are **not compatible with a 500 ms live-frame freshness requirement**. The integration must use explicit frozen-frame snapshot analysis with the matching captured image, or reject stale results. Do not relabel delayed output as current live depth. Controller/UI ownership and snapshot integration are outside this module.

## Reproduction and tests

```sh
node --test frontend/depth-model.test.js
# Obtain a real photo you have permission to use, then:
node frontend/depth-model-smoke.mjs /absolute/path/to/photo.png
# Open http://127.0.0.1:8799 in a real browser and click Run.
```

The smoke helper serves only loopback, does not add COOP/COEP, and uses the production adapter and worker. It records shape, finite count, raw min/max, sample pixels, timing, timer responsiveness, browser identification, and isolation state. Front/back sample coordinates are meaningful for the documented bread image only. The helper does not download or redistribute an image automatically.

Unit tests cover lazy loading, immutable model revision, raw-not-visualized semantics, malformed/nonfinite tensors, single-thread WASM, successful/failed GPU probe, one GPU-to-WASM fallback, bounded failures, late-load cleanup, prompt cancellation, worker termination, no overlapping inference, stale output rejection, disable/re-enable races, unavailable worker platform, processor size, and pathological aspect-ratio rejection.

**Blocked/unverified:** actual WebGPU execution, iOS/Safari and Android device inference/memory/thermal behavior, camera-motion/frame-age UX acceptance, deployment asset delivery, and physical distance accuracy. The model cannot establish metres without independently validated same-frame metric references. No physical accuracy target is claimed.
