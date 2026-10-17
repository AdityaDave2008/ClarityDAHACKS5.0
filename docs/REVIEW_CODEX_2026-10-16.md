> Historical reference selectively preserved from `origin/feature/iphone-pip-test` (`8203fdb`). Descriptions and verification claims below refer to that branch at the time of writing, not acceptance results for the current app. Proposed features are not necessarily implemented.

# Review of uncommitted work, October 16, 2026 (evening)

Scope: everything uncommitted after commit `2afa886`, which is the on-device depth feature, the Docker/compose/CI additions, the light-theme UI rewrite, and the docs. Three independent read-only reviews, plus `npm run check` (pass) and `npm test` (27 backend, 11 frontend, all pass). Line numbers refer to the files as they stood at 17:45.

Overall: safe to commit. No license violations (only Depth Anything V2 Small, Apache-2.0, is referenced), depth never touches `alert.triggered`, no meters are displayed, every element id app.js references exists exactly once, the service worker does not precache the model, and the Dockerfile, compose, and CI are consistent with the code. Fix the items below in order; the first four are worth doing before submission.

## Fix before submission

1. **Pin the depth model revision.** `frontend/depth-worker.js:16` calls `pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', ...)` with no `revision`, so it tracks `main` and a future push changes the shipped weights. Add `revision: '4472b7362082ad9968fee890ca0f1e5aca36b93d'` (current `main` sha, 2026-04-14, `onnx/model_quantized.onnx` 26 MB) and record it in `docs/DEPTH.md` and `ATTRIBUTION.md`.

2. **Smoke test fails on first run.** `scripts/smoke-deployment.js:8-9` checks `/ready` once. The backend downloads COCO-SSD on every start (`backend/inference-worker.js:16`), so `/ready` is 503 for 10 to 60 s after `docker compose up`, and `infra/README.md` tells users to run `npm run smoke` immediately. Poll `/ready` every 2 to 3 s until 200 or a deadline (default 180 s). Also add GET checks for `/models/efficientdet_lite0.tflite`, `/vendor/mediapipe/vision_bundle.mjs`, `/vendor/mediapipe/wasm/vision_wasm_internal.wasm`, `/app.js`, `/sw.js` with non-zero content length, since on-device mode is now the default.

3. **SIMULATED badge is unreadable on a phone.** `frontend/styles.css` sets `.source-badge` to 9px muted grey, 8px under 760px, and the "Simulated camera & detections" caption is 9px. The submission must not let a judge mistake the walkthrough for live detection. Use at least 11px, weight 600, ink color, and drop the 8px override.

4. **Attribute onnxruntime-web.** `transformers.min.js@3.8.1` bundles onnxruntime-web (MIT) and downloads a 20.6 MB ORT WASM binary from jsDelivr at runtime. Neither `ATTRIBUTION.md:7` nor `docs/DEPTH.md` mentions it. Add a line. Also reword "ONNX conversion" to "ONNX export source (onnx-community)" since the docs do not describe a conversion.

## Fix if time allows

5. **First-run depth download is about 48 MB** (0.9 MB runtime + 20.6 MB ORT WASM + 26 MB model). `docs/DEPTH.md:7` and the UI copy in `frontend/camera.html:61` say only "large". The 240 s first-run timeout in `frontend/depth.js:46` is marginal on cellular, and a timeout terminates the worker so partial files are re-downloaded. State the size, and reset the timer on each `progress` message instead of a fixed wall clock.

6. **Remove the dead `centerRelativeDepth` scalar.** `frontend/depth-worker.js:51-61` computes a central-patch mean and label that nothing reads. It is exactly the kind of per-frame number the team agreed must never feed alerts. Delete it, or keep it with a comment and a perception test asserting it is never passed to `TrackAlertPolicy`.

7. **Any inference error tears down the depth worker.** `frontend/depth.js:29` calls `dispose()` on a plain error message, so the next click re-imports the runtime and re-inits 20 MB of WASM. Only timeout, `onerror`, and `onmessageerror` need termination; a normal error should reject the pending promise and keep the worker.

8. **Header "Preferences" link goes to settings the scanner ignores.** `frontend/index.html:22` links to `/#settings`, whose Alert style, Vibration, Spoken alerts, Save preferences, and Walking mode write `clearpath-alert` and `clearpath-mode`, but `app.js:209,583` reads only `clearpath-alert-sound`. Either preselect the sound/speech/vibration switches in app.js from `clearpath-alert`, or point the link at camera.html's own preferences card and remove the duplicate rows.

9. **Blocking log follow in the Docker instructions.** `infra/README.md` Docker block runs `docker compose logs -f --tail=100` before `npm run smoke`; followed literally the smoke never runs. Drop `-f` or move it after.

10. **Unbacked audit claim.** `infra/README.md` says production audits "reported zero known vulnerabilities on October 16, 2026" but no run is recorded anywhere. Save the `npm audit --omit=dev` output under `.run-logs/`, add an audit step to `ci.yml`, or soften the sentence.

11. **Ephemeral tunnel URL at the top of a doc.** `docs/PHONE_LAUNCH.md:27` opens with `https://webshots-sector-tooth-melissa.trycloudflare.com/camera.html`, which dies when the tunnel restarts. Keep the reproducible steps first and move the URL to a dated session-record line, or regenerate it right before submission.

12. **Dead camera screen in index.html.** `index.html:415` redirects `camera` to `/camera.html?mode=live`, leaving `<section id="camera">` (110-143) and `startCamera`/`stopCamera` (808-870) unreachable in a 35 KB page. Delete them; keep `setCameraPermissionState` and `refreshCameraPermission`.

## Cosmetic

13. No visible link back to the home page from camera.html on mobile: `styles.css` hides `.topbar nav>a` under 760px, leaving only the logo. Keep the `/` link visible.
14. `styles.css` dropped `fieldset:disabled .switch-row{opacity:.6}`, so while scanning only the toggle thumb dims, not the label.
15. `docs/ON_DEVICE_VALIDATION.md:19` "about 6.5 seconds including initial runtime/model loading" is only plausible with a warm cache; say so.
16. README.md:13 and the dialog in `camera.html:74` say "Backend" while the select in `camera.html:42` says "Server". Pick one word.
17. `index.html:24-25` status dot is green before permission is granted ("Camera off"); add a neutral class for the prompt state. Desktop only.
18. `sw.js` matches by pathname but `caches.match` keys by full URL, so `/camera.html?mode=live` misses the precached `/camera.html` offline. Use `{ ignoreSearch: true }`. Offline is not a demo requirement.
19. `.dockerignore:11-12` `samples` and `tests` are root-anchored, so `backend/tests`, `frontend/*.test.js`, `frontend/scripts`, and `frontend/sample` land in the image. Harmless. Use `**/tests`, `**/*.test.js`.
20. `ci.yml:3-4` runs the same commit twice on same-repo PR branches. Use `push: branches: [main]`.
21. `index.html:72` "Shared neighborhood reports are coming next." reads like a feature promise; consider "Not shared between phones yet."
22. `docs/COMMUNITY_HAZARDS_PROPOSAL.md` is correctly labeled not implemented. It is not buildable before the deadline (persistent reports, authenticated identity, geo queries, push). If any piece ships later, `docs/api.md` lines 5, 335, and 341 (no accounts, frames not saved, no community reports) must change first, and the proposal needs a retention and deletion policy for user location data.

## Verified fine

- Model and runtime provenance: `onnx-community/depth-anything-v2-small` is Apache-2.0, base model Depth-Anything-V2-Small; `dtype: 'q8'` maps to `onnx/model_quantized.onnx` (26 MB). No Base, Large, or Giant reference anywhere. Runtime pinned to `@huggingface/transformers@3.8.1`. WASM only, so the iOS 26 WebGPU gate is moot.
- Depth worker lifecycle: one in-flight job, 240 s and 60 s timeouts, ImageBitmap transferred and closed on every path, generation guard on status writes, depth runs only on button click, never per frame. `clearDepth()` runs on stop, mode change, and Clear.
- Policy: `alert.triggered` is produced only in `frontend/perception.js:33-39`; depth output only paints `#depth-preview` and a status line that says "Relative depth only, not meters or a live safety signal".
- Service worker precaches 18 same-origin paths, all on disk and in the server allowlist; no tflite, no MediaPipe WASM, no depth model; cache bumped to v3; activate does not wipe the transformers cache.
- Every id in app.js's `ui` map and its other lookups exists exactly once in camera.html; index.html inline script ids all resolve; the "both pages have unique IDs" test passes.
- Accessibility: `aria-pressed` on tabs and presets, `aria-current` on nav, `role="status" aria-live="polite"` on status and toast, the How it works dialog and its three handlers intact, Walkthrough still the default tab.
- Mobile at 390px: no fixed widths exceed the viewport, 16px inputs (no iOS zoom), safe-area insets on the bottom nav.
- Dockerfile: `node:24-bookworm-slim`, `npm ci --omit=dev` with lockfiles, sharp prebuilts present in the backend lockfile, `HOST=0.0.0.0 PORT=3001`, non-root `node` user with `.cache` chowned, HEALTHCHECK on `/health`, frontend `API_ORIGIN=http://backend:3001` matches the compose service name.
- compose.yaml: backend not published, frontend on 127.0.0.1:5180, `depends_on: service_healthy`, `SURFACE_MODEL` default off. `ALLOWED_ORIGINS` absence is fine because the frontend proxy strips the Origin header.
- ci.yml: Node 24, cache keyed on both lockfiles, runs the real check and test scripts, no model download, no secrets, no Android build, no Playwright browser run. The container job only runs `docker compose config` and `build`.
- `scripts/verify-model.js` passes (SHA-256 of the committed tflite matches `frontend/models/README.md`). `scripts/smoke-deployment.js` uses 15 s abort timeouts and is honest that it does not test camera inference.
- Attribution: MediaPipe 0.10.32 matches package.json; EfficientDet URL matches the model README, server route, and verify script; `LICENSE.mediapipe` is the upstream Apache-2.0 text; ByteTrack is described as an adaptation with the MIT notice in `docs/TRACKING.md`; Playwright 1.64.1 is a devDependency.
- Docker is not installed on this machine, so the image was not built here; the CI container job will be the first real build.
