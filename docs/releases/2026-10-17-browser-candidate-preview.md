# Browser candidate preview in the v1 release grouping

## Deployment and identity

- Preview: https://stepsense-yolox-v2-preview.stepsense-dahacks.workers.dev
- Worker: `stepsense-yolox-v2-preview`, deployed version `11e4f98c-1d12-4aa2-a56d-4a15822d7e24`.
- Model: actual fine-tuned **experimental YOLOX-Nano candidate**, not COCO-SSD or selected pretrained baseline. “v1” is a release grouping, not a claim that this is the previous v1 model or a promoted safety model.
- SHA-256: `516617114420ce3c2bac545869ee91bac8ff7a63e148a73afdb12f126433fab4`.
- Default confidence threshold: `0.7874982953071594`.
- Runtime: bundled ONNX Runtime Web1.20.1, single-thread WASM. Files, sizes and hashes are pinned in `frontend/vendor/yolox-51661711/ASSETS.json` and were independently downloaded and hashed from public HTTPS.

The trained candidate underperformed its pretrained baseline in evaluation. Empty output does not mean a clear path. See its bundled PROVENANCE.md for preprocessing limits. No phone/native files were changed by this integration.

## Scope and isolation

Implementation was in a separate clone. Fresh `origin/main` at `1dcc74e` was integrated and merge conflicts resolved without touching the shared working tree. Committed depth delivery fixes from `fa44c55` were preserved. The final change relative to main adds the candidate adapter/assets/tests and separate preview configuration, not experimental native bundles or a wholesale feature-branch merge.

Production `stepsense-detection` was not directly deployed or reconfigured. Its deployment history showed Wrangler deployments and no Pages projects or GitHub deploy workflow was found. Cloudflare Builds API returned403, so absence of an automatic build connection could not be conclusively verified. Main integration proceeded after explicit user authorization and coordinator review of this limitation.

Deploy only with:

```sh
wrangler deploy --config worker/preview.wrangler.toml
```

The preview has only the `ASSETS` binding. Its tiny Worker allows static GET/HEAD and the existing revision-pinned, allowlisted `/depth-assets/` downloads needed by optional depth. It has no AI, session or Durable Object bindings and rejects frame/API POSTs. `/camera.html` redirects to the current browser-local camera entry point. No paid service was added.

## Validation on the merged tree and public preview

- Frontend: **196/196** Node tests. Backend regression suite: **27/27**. Worker suite including preview routing and depth allowlist: **33/33**. `npm run check` passed.
- Test-first regressions demonstrated incorrect baseline threshold, callbacks/results after stop/abort, and missing cached asset route, then passed after fixes. Adapter tests cover BGR CHW pad114 input, output validation/disposal, inverse geometry, class-aware NMS and preserve16class policy.
- Real Chromium loaded the packaged ONNX on both localhost and public HTTPS. Lossless reference cat confidence: `0.7931427443873815`, normalized box `[0, 0.12703961592454177, 0.9147736842815694, 0.83825500194843]`. The alert policy progressed `confirming`, `triggered`, `cooldown`.
- Real service-worker activation removed the old v7 cache and precached the candidate/runtime. Offline page reload created a fresh runtime and reproduced identical detections. Cache-unit tests also reject stale entries from unrelated cache namespaces.
- Browser UI fake-camera start/stop/restart passed with no frame uploads and no unsolicited depth downloads. Corrupt model bytes failed integrity validation, then retry loaded the genuine model.
- Public depth opt-in acceptance passed: pinned real depth model initialized and produced a paired relative-depth snapshot while object detection remained active. Synthetic orientation/camera fixtures tested UI/geometry state transitions, not physical distance accuracy.
- Public HTTPS downloads matched every pinned asset hash and byte length. Allowed depth config returned200, unknown/traversal paths404, inference POST405, legacy camera redirect302.

Browser scripts:

```sh
npm --prefix frontend test
npm test
node --test worker/tests/*.test.mjs
npm run check
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
CANDIDATE_FIXTURE=/absolute/path/to/cat-lossless.png \
CANDIDATE_APP_URL=https://stepsense-yolox-v2-preview.stepsense-dahacks.workers.dev/ \
node scripts/candidate-browser-smoke.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
DEPTH_APP_URL=https://stepsense-yolox-v2-preview.stepsense-dahacks.workers.dev/ \
DEPTH_TEST_MODEL=1 DEPTH_TEST_GEOMETRY=1 node scripts/depth-browser-smoke.mjs
```

The lossless fixture is the native candidate parity fixture retained locally with the training verification artifacts. This verification is not field accuracy, safety certification or a claim of cross-browser pixel equivalence. Browser video uses direct canvas pixels without a JPEG round-trip. Optional depth still has separate opt-in download/offline limitations.
