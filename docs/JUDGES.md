# Judge guide: StepSense / Clarity

A camera-based object-alert prototype exploring how everyday phones can provide visual, spoken, sound, and supported haptic cues. This is **not a navigation aid certified for safety**. Demonstrate it stationary, not while walking into obstacles or traffic.

## Fastest way to inspect it

1. Open the [browser preview](https://stepsense-yolox-v2-preview.stepsense-dahacks.workers.dev/).
2. Select **Camera**, press **Start**, and allow camera permission. Wait for model loading before interpreting results.
3. Show an ordinary supported object, such as a chair, bottle, or person, in good light. The model may miss it. Explain observed results rather than promising a detection.
4. Inspect the overlay/status and try the available alert preferences. Move the object in and out of the displayed image zone. That zone is a screen-coordinate heuristic, not measured free space.
5. Press **Stop** and confirm camera capture stops. If permission is denied, restore it through browser settings rather than repeatedly pressing Start.

The existing isolated preview was updated on **October 17, 2026 at 08:52 UTC**, from tested source `3fb11da`, as version `7b46f74f-ca3c-4902-8ea6-b2279742d767`. Its historical `yolox-v2-preview` hostname does **not** identify the current model: this deployment uses **COCO-SSD**. Six application files and all ten measured runtime/model assets matched the tested source byte-for-byte. Actual Chrome 155 hosted checks passed real inference, camera restart, cache migration and fresh offline inference with synthetic media. This does not establish physical-phone accuracy or permissions. The preview has no remote inference API and rejects uploads, so do not select backend detector mode. The separate [production app/API origin](https://stepsense-detection.stepsense-dahacks.workers.dev/) was not redeployed by this work.

For the iPhone app already opened in Xcode, use the **[native judge guide](../samples/ios/JUDGES.md)**. It explains the actual build, bundled model, install requirements, and outstanding physical-device checks. Source access is not an App Store or TestFlight distribution guarantee.

## Reproduce from this checkout

Use Node.js 24+ in the repository root:

```sh
npm --prefix frontend start
```

Open **http://127.0.0.1:5180/**. This path needs no npm installation or Node detection backend. Desktop loopback HTTP supports camera permission, while a phone requires trusted HTTPS. The browser's default detector is bundled COCO-SSD through TensorFlow.js/WASM, with a 0.6 score threshold and a maximum 640-pixel capture edge. The native app retains a separate experimental YOLOX candidate. See [`standalone.js`](../frontend/standalone.js), [model loader](../frontend/local-detector.js), and [experimental native model evaluation](v2-testing/README.md).

If the camera or model is unavailable, the retained **http://127.0.0.1:5180/camera.html** page offers a **Walkthrough** with explicitly simulated objects. Use this only to explain interaction and alert behavior, and say clearly that it is not live AI evidence.

### Optional backend comparison

Stop the standalone frontend first. Then run:

```sh
npm --prefix backend ci
npm run demo
```

Open **http://127.0.0.1:5180/?detector=backend**. This deliberately uploads frames to the local Node API's COCO-SSD detector. Model download/loading can take time. Check **http://127.0.0.1:3001/ready** before the demonstration. `/camera.html` also uses the API when **Live camera** is selected, but its Walkthrough remains simulated.

Do not confuse the Node API with the Cloudflare API: the [Worker](../worker/README.md) uses different hosted models, returns coarse regions rather than bounding boxes, and has documented high latency. Its historical measurements are not performance claims for the current browser or phone.

## Suggested two-minute presentation

| Time | Show and explain |
| --- | --- |
| 0:00–0:20 | **Modern Life:** exploring accessible awareness cues on the phone people already carry, with explicit safety boundaries. |
| 0:20–1:05 | **Functionality:** Start, actual live result/status, alert preferences, and Stop. Distinguish camera preview from a confirmed inference result. If live detection fails, disclose it and use the labeled walkthrough only as a fallback. |
| 1:05–1:30 | **Originality:** the team's integration of local inference, image-zone alert policy, accessibility controls, and experimental depth/PiP work. Credit pretrained models and libraries in [ATTRIBUTION.md](../ATTRIBUTION.md). Do not present third-party models as invented here. |
| 1:30–2:00 | **Presentation:** explain the browser/native/backend split, what was verified, and the next device tests. Show limitations rather than hiding empty results or latency. |

Functionality, originality, theme (**Modern Life**), and presentation each account for **25%** of the recorded rubric. The recorded deadline is **October 17, 2026, 2:00 PM PDT**. See [submission checklist](demo.md) and [official event rules](https://dahacks5.devpost.com/rules). This guide does not predict judging outcomes.

## Honest limitations and privacy boundaries

- **Different models:** the browser uses COCO-SSD. The native fine-tuned YOLOX-Nano candidate underperforms its baseline on recorded evaluation. Sparse/default-threshold results and JPEG/runtime differences are documented in [V2 evidence](v2-testing/README.md). There is no general accuracy claim.
- **Not complete hazard detection:** selected object categories do not cover arbitrary obstacles, potholes, curbs, stairs, or safe routes. No alert does not mean clear path.
- **Depth:** experimental browser depth and optional native LiDAR have separate device/model constraints. Do not describe an image-zone overlay as measured distance. See [depth acceptance](DEPTH_ACCEPTANCE.md).
- **PiP/background use:** a floating live feed does not establish continuing inference or alerts. Web PiP shows the raw camera preview only. While an owned PiP window remains open, supported browsers may retain the hidden camera feed, but inference and alerts pause until the page becomes visible. Browser/OS support varies. Test the exact device and browser. Native PiP is a separate implementation with its own [acceptance guidance](../samples/ios/JUDGES.md).
- **Data flow:** default browser object detection processes frames locally. Optional depth may fetch model assets. Explicit Node/hosted API modes upload camera frames. The native offline detector uses packaged assets. Do not describe every mode as offline or no-upload.
- **Evidence scope:** source/automated tests, Mac runtime checks, signed builds, installation, and physical live-camera acceptance are different evidence. Neither successful compilation nor HTTP 200 proves the complete demo works.

## Checks for reviewers

```sh
npm --prefix backend ci
npm run check
npm test
npm run test:native
```

Root tests aggregate backend, frontend, and Worker suites. Native checks are separate and some require macOS/Swift. They do not replace [manual end-to-end acceptance](../tests/e2e/README.md), phone permission tests, actual model/device latency measurements, or observation of live PiP pixels and fresh detections.

For code navigation, use the [root runtime map](../README.md#which-runtime-am-i-using), [API contract](api.md), [native judge guide](../samples/ios/JUDGES.md), and [model provenance](../samples/ios/MyEyes/OfflineDetector/PROVENANCE.md). Older design notes and historical benchmark results may describe different model revisions or planned features. Check the runtime map before applying their claims.

### Current local integration evidence, October 17 UTC

The restored COCO browser integration passed 27 backend, 206 frontend, 39 Worker and 56 native tests. Real bundled COCO-SSD inference and a fresh offline reload passed in isolated Chrome 155 with a licensed positive fixture. Synthetic-camera Start/Stop/restart completed real inference frames without uploads. A separate headful native-browser PiP check verified live hidden preview, inference pause, foreground resume and camera release; that lifecycle check uses a deterministic detector adapter. The integrated iOS source also compiled unsigned for generic iOS. These local checks do not establish physical-phone acceptance. Separate hosted preview checks and exact deployment identity are recorded above; the production API remains unchanged.

The current COCO adapter also completed a **900.173-second synthetic-camera run**, with **34 Start/Stop or navigation cycles and 8,707 successful inferences**. There were zero observed model failures, page errors or uploads, at most one active inference, and zero live camera tracks after every stop. A separate deliberately injected model error correctly failed the harness. Runtime source hashes were unchanged throughout the run. The reported JS heap proxy was 188 MB throughout, but this does not establish absence of leaks or physical-device thermal/battery behavior.

The [current COCO cadence measurements](DETECTOR_RESPONSIVENESS.md#current-coco-measurements) are separate from the historical YOLOX results. More frequent fresh results did not change scores or thresholds and do not establish improved accuracy.

To reproduce the optional real-browser checks, use an existing Playwright installation and an appropriately licensed positive fixture outside the repository:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
MODEL_FIXTURE=/absolute/path/to/cat-lossless.png \
node scripts/browser-model-smoke.mjs

PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
SOAK_SECONDS=900 node scripts/camera-soak.mjs
```

These scripts use isolated synthetic cameras, not your physical camera or personal browser profile. The soak uses real inference but not the fixture, and does not require every synthetic frame to contain a supported object. The separate native-window PiP check is documented in the [frontend guide](../frontend/README.md#live-camera-picture-in-picture).
