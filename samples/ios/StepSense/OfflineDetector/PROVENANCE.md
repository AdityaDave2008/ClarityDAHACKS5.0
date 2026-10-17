# Offline detector provenance

This is the **same pretrained TensorFlow.js COCO-SSD `lite_mobilenet_v2` model** selected by `backend/inference-worker.js`, not a newly trained detector or a substitute Core ML architecture. No conversion, fine-tuning, quantization, or edits to the graph/weight shards were performed.

## Exact artifact

Repository path: `samples/ios/StepSense/OfflineDetector/model/model.json`

Weights: `model/group1-shard1of5` through `model/group1-shard5of5`, totalling **18,034,528 bytes**. The graph JSON specifies the order of those five files. Xcode copies the complete `OfflineDetector` directory into `StepSense.app/OfflineDetector`.

Official source, downloaded October 16, 2026:

`https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/model.json`

Each shard comes from the same URL directory. This is the default URL resolved by `@tensorflow-models/coco-ssd@2.2.3` when passed `{ base: 'lite_mobilenet_v2' }`. `ASSETS.json` pins byte sizes and SHA-256 hashes because the provider URL itself is not revision-versioned.

## Runtime and licenses

- `coco-ssd.min.js`: unmodified browser distribution from installed `@tensorflow-models/coco-ssd@2.2.3`.
- `tf.min.js`: unmodified browser distribution from `@tensorflow/tfjs@4.22.0`.
- `tf-backend-wasm.min.js` and all three `.wasm` files: unmodified browser distribution from `@tensorflow/tfjs-backend-wasm@4.22.0`. Only one single-threaded backend is selected. The fallback binaries remain bundled for backend feature detection.
- Source package versions are pinned in `backend/package-lock.json`.
- TensorFlow.js, its WASM backend, and the official TensorFlow.js models repository are **Apache-2.0**, copyright Google LLC. Full upstream Apache notices are retained under `licenses/`, along with original copyright/license headers in the JS distributions. The pretrained detector is distributed by the official TensorFlow.js models project under its repository license, with no separate weight license advertised by its COCO-SSD documentation.
- Upstream documentation: <https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd>.
- License sources: <https://github.com/tensorflow/tfjs-models/blob/master/LICENSE> and <https://github.com/tensorflow/tfjs/blob/master/LICENSE>.
- COCO is the original training/category dataset: <https://cocodataset.org/#termsofuse>. No COCO training images or test photograph is included in this app bundle.

## Offline execution

A nonpersistent WKWebView executes the packaged scripts. A `WKURLSchemeHandler` serves `stepsense://offline/` from the app bundle, with successful HTTP-style status/MIME headers for WebAssembly fetch. There is **no listening server** and no network request for the model, scripts, images, or inference. Camera JPEGs are passed directly to JavaScript as base64 and never uploaded. Content Security Policy disallows HTTP(S) fetch/navigation/resources. `unsafe-eval` is required for the pinned TensorFlow.js generated kernels, not for downloaded code.

`policy.js` is a verbatim classic-script copy of `backend/alerts.js` with only the `export` keywords removed. Tests enforce this equivalence. It retains the 16 supported alert labels, normalized top-left boxes, bottom-center image-zone anchor, two spatially matching confirmations, cooldown, and failure/stale streak breaking. This is an image heuristic, not a walking-corridor or distance estimate. Empty detections do not prove a clear or safe path.
