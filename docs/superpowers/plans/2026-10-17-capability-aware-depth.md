# Capability-Aware Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add calibrated experimental browser depth and native automatic LiDAR selection without replacing v1 detection.

**Architecture:** Pure geometry and validity logic are separated from browser motion collection, optional model inference, and UI. Native changes reuse synchronized AVFoundation capture. All unsupported or unreliable depth paths fail closed while RGB detection continues.

**Tech Stack:** ES modules, Node test runner, Swift/AVFoundation, pinned Transformers.js with Depth Anything V2 Small subject to model/runtime validation, Cloudflare static assets.

**Spec:** docs/superpowers/specs/2026-10-17-capability-aware-depth-design.md

## Global Constraints

- Camera frames stay on device; model downloads are permitted but require explicit enablement.
- Existing v1 object detection and PiP camera ownership remain unchanged.
- Relative model output never becomes metres without valid same-frame metric references.
- Hardware-unavailable, denied permissions, stale data and invalid calibration never invent distances.
- Preserve existing explicit LiDAR opt-out and all teammate uncommitted work.
- Accuracy acceptance requires physical measurements; automated tests cannot establish it.
- Provisional target: accepted camera estimates median error <=20%, p90 <=30% in declared calibrated conditions; label this unverified until measured.

### Task 1: Native automatic hardware depth

Files: samples/ios/MyEyes/APIClient.swift, CameraCapture.swift, ScannerView.swift; samples/ios/tests/lidar-depth.test.mjs and focused capability tests.
Interfaces: retain `isLidarEnabled: Bool`, `start(lidarEnabled:onFrame:)`, and existing synchronized DepthSnapshot contract.

- [ ] Extend actual Swift preference decoding tests: missing field => automatic enabled, explicit false => false, explicit true => true. Run native tests to observe current missing-field false failure.
```swift
let legacy = try JSONDecoder().decode(Preferences.self, from: Data("{}".utf8))
assert(legacy.isLidarEnabled)
```
Use the actual existing preference type and required JSON fields from its current test harness rather than creating copied production types.
- [ ] Change only the missing preference default to true; preserve explicitly stored values. Verify hardware probing and configuration rollback already catch unsupported devices, improve source diagnostics if necessary.
```swift
get { lidarEnabled ?? true }
```
- [ ] Label the toggle automatic hardware-depth preference and document fallback. Run `node --test samples/ios/tests/*.test.mjs`, including real Swift tests; commit only native paths.

### Task 2: Pure browser depth geometry and contracts

Files: frontend/depth-geometry.js, frontend/depth-geometry.test.js.
Interfaces: `estimateGroundDepth({anchor, calibration, attitude, frame, now})` returns `{kind, source, reason, meters?, lowerMeters?, upperMeters?}`. `fitInverseDepth(anchors)` and `estimateModelDepth(relative, fit)` reject insufficient references/poor fits. Calibration binds to width, height, deviceId and orientation.

- [ ] Write tests for missing calibration, frame mismatch, stale attitude, near-horizon rays, false ground-contact declaration, finite output and known ray/plane geometry.
```js
assert.equal(estimateGroundDepth({anchor:{x:.5,y:.8}, now:1000}).kind, 'unavailable');
```
- [ ] Run `node --test frontend/depth-geometry.test.js` and observe failure.
- [ ] Implement calibrated image-ray/flat-ground intersection. Compute uncertainty over bounded camera-height/pitch/FOV perturbations, reject invalid bounds, report rounded interval and optical-depth semantics explicitly.
- [ ] Implement inverse-depth fit with positive slope/domain checks, reference spread, residual/hold-out checks. Never expose metric output without valid accepted fit.
- [ ] Run tests for geometry, mixed invalid references and out-of-range extrapolation; commit module/tests.

### Task 3: Optional real model and browser sensor adapter

Files: frontend/depth-model.js, frontend/depth-model.test.js, frontend/depth-sensors.js, frontend/depth-sensors.test.js, docs/DEPTH_MODEL_PROVENANCE.md; vendored pinned runtime files if needed.
Interfaces: `createDepthModel().load({onStatus})`, `.estimate(canvas)` returns raw `{data,width,height}` relative inverse-depth map; `.dispose()`. `createDepthSensors(platform).request()` requests motion permission inside the original gesture; `.snapshot()` returns timestamped attitude or unavailable; `.stop()` removes listeners.

- [ ] Tests first for unavailable platform, rejected permission, malformed model map, generation cancellation, bounded load failure and raw-output semantics.
```js
assert.equal(normalizeDepthMap({data:[NaN],width:1,height:1}), null);
```
- [ ] Record selected public runtime/model, versions, license, verified sizes and hashes. Pin model revision; avoid floating latest URLs.
- [ ] Use actual raw predicted tensor, not normalized visualization. Verify model output dimensions and finite values on a real image. Benchmark runtime on available host and record device/browser gaps without claiming phone latency.
- [ ] Prefer WebGPU after successful probe, use bounded WASM fallback; catch failures and report unavailable without stopping v1.
- [ ] Run tests and real inference smoke test; commit only owned adapter/provenance paths.

### Task 4: Browser calibration and frame-safe integration

Files: frontend/depth-controller.js, frontend/depth-controller.test.js, frontend/depth-ui.js, frontend/depth-ui.test.js, frontend/local-detector.js, frontend/standalone.js, frontend/index.html, frontend/homePage.css, frontend/server.js, frontend/sw.js.
Interfaces: controller captures no independent camera stream. Detector calls a synchronous `onFrame({canvas,sequence,capturedAt,sourceWidth,sourceHeight,detections})` extension only when needed; depth snapshot is copied before canvas reuse. UI owns enable, calibration and reset controls. Controller owns max one inference and invalidates on stop/hide/calibration change.

- [ ] Write tests proving disabled depth does not load model, depth failure leaves object results intact, no overlapping inference, no stale/post-stop outputs, and relative output never renders metres.
```js
assert.equal(formatDepth({kind:'relative',value:3}).includes(' m'), false);
```
- [ ] Add explicit experimental depth enablement, model-download notice, source indicator, calibration controls and assumption labels in current Clarity design. Reuse one existing video stream.
- [ ] Calibration collects camera height plus measured projection reference; motion samples are fresh and orientation conventions validated. Show unsupported or manual-calibration limitations honestly.
- [ ] Integrate optional raw model map visualization/relative status and same-frame reference fit only with validated reference anchors; geometry can operate independently under declared ground-contact conditions.
- [ ] On permission failure, no valid references, movement/configuration mismatch, or slow model, keep working v1 and show depth unavailable/relative-only. Do not escalate alerts using experimental depth.
- [ ] Register all local modules in dev static server/service worker, bump cache, preserve lazy model loading. Run all frontend/Worker tests and commit scoped paths.

### Task 5: Acceptance, review and deployment

Files: docs/DEPTH_ACCEPTANCE.md and automated public-interface/browser smoke checks as appropriate.

- [ ] Run `node --test frontend/*.test.js worker/tests/*.test.mjs samples/ios/tests/*.test.mjs` and inspect failures instead of relying only on aggregate counts.
- [ ] Review source/model license pinning, calibration assumptions, source labels, freshness rules and concurrency with an independent reviewer. Fix material issues and rerun affected checks.
- [ ] Exercise actual browser enable/load/error/start/stop/calibration controls through available browser automation. Attempt real model inference on a real image. Record unavailable hardware/permissions explicitly.
- [ ] Deploy from worker with `npx --yes wrangler@4 deploy`; verify live Clarity HTML, scripts, model dependencies, v1 default and cache version. Push branch commits.
- [ ] Record requirement-to-check table with observed pass/fail/blocked outcomes. Physical trials at measured 0.5/1/2/3 m remain unverified until actual device observations exist; no numerical accuracy claim substitutes for them.
