# Judge guide: StepSense / Clarity

A camera-based object-alert prototype exploring how everyday phones can provide visual, spoken, sound, and supported haptic cues. This is **not a navigation aid certified for safety**. Demonstrate it stationary, not while walking into obstacles or traffic.

## Fastest way to inspect it

1. Open the [experimental browser preview](https://stepsense-yolox-v2-preview.stepsense-dahacks.workers.dev/).
2. Select **Camera**, press **Start**, and allow camera permission. Wait for model loading before interpreting results.
3. Show an ordinary supported object, such as a chair, bottle, or person, in good light. The model may miss it. Explain observed results rather than promising a detection.
4. Inspect the overlay/status and try the available alert preferences. Move the object in and out of the displayed image zone. That zone is a screen-coordinate heuristic, not measured free space.
5. Press **Stop** and confirm camera capture stops. If permission is denied, restore it through browser settings rather than repeatedly pressing Start.

The preview URL and [existing hosted app/API origin](https://stepsense-detection.stepsense-dahacks.workers.dev/) each returned HTTP 200 during a link check on **October 17, 2026 (UTC)**. This verifies reachability only, not deployment parity with current `main`, model quality, camera permissions, or device acceptance. No deployment was performed for this documentation update. The preview intentionally has no `/api/v1` inference service, so do not select its backend detector mode.

For the iPhone app already opened in Xcode, use the **[native judge guide](../samples/ios/JUDGES.md)**. It explains the actual build, bundled model, install requirements, and outstanding physical-device checks. Source access is not an App Store or TestFlight distribution guarantee.

## Reproduce from this checkout

Use Node.js 24+ in the repository root:

```sh
npm --prefix frontend start
```

Open **http://127.0.0.1:5180/**. This path needs no npm installation or Node detection backend. Desktop loopback HTTP supports camera permission, while a phone requires trusted HTTPS. The first local-model start loads about 15 MB of bundled model/runtime assets. The browser's default detector is the experimental YOLOX candidate, not COCO-SSD. See [`standalone.js`](../frontend/standalone.js), [model loader](../frontend/candidate-model.js), and [model evaluation evidence](v2-testing/README.md).

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

- **Experimental model:** the fine-tuned YOLOX-Nano candidate underperforms its baseline on recorded evaluation. Sparse/default-threshold results and JPEG/runtime differences are documented in [V2 evidence](v2-testing/README.md). There is no general accuracy claim.
- **Not complete hazard detection:** selected object categories do not cover arbitrary obstacles, potholes, curbs, stairs, or safe routes. No alert does not mean clear path.
- **Depth:** experimental browser depth and optional native LiDAR have separate device/model constraints. Do not describe an image-zone overlay as measured distance. See [depth acceptance](DEPTH_ACCEPTANCE.md).
- **PiP/background use:** a floating live feed does not establish continuing inference or alerts. Browser/OS support varies and hidden pages may pause. Test the exact device and browser. Native PiP is a separate implementation with its own [acceptance guidance](../samples/ios/JUDGES.md).
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

For code navigation, use the [root runtime map](../README.md#which-runtime-am-i-using), [API contract](api.md), [native judge guide](../samples/ios/JUDGES.md), and [model provenance](../samples/ios/MyEyes/OfflineDetector/PROVENANCE.md). Older design notes may describe the COCO baseline or planned features rather than the current experimental entry points.
