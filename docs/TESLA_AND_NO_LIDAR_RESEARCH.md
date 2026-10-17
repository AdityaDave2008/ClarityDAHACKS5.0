# Tesla open source and non-LiDAR depth: research and build plan

Research checked October 16, 2026 for the StepSense prototype. Deadline is October 17, 2026 at 2:00 PM PDT. Everything below builds on the existing code: the Fastify backend workers, the browser PWA, the learning sample's ground-plane distance estimate, and the Swift and Android samples. Nothing is rewritten.

## 1. What Tesla has actually open-sourced

Tesla's GitHub organization ([github.com/teslamotors](https://github.com/orgs/teslamotors/repositories), 67 repos) contains no Autopilot, FSD, HydraNet, or occupancy-network code. No weights and no datasets are public. Licenses were read from the GitHub API.

| Repo | What it is | License | Use for StepSense |
| --- | --- | --- | --- |
| [fleet-telemetry](https://github.com/teslamotors/fleet-telemetry) | Go server; vehicles stream protobuf telemetry over WebSocket | Apache-2.0 | Pattern only: a small telemetry schema for session events |
| [vehicle-command](https://github.com/teslamotors/vehicle-command) | Signed vehicle command SDK | Apache-2.0 | None |
| [react-native-camera-kit](https://github.com/teslamotors/react-native-camera-kit) | React Native camera component | MIT | None for a vanilla JS PWA |
| [informed](https://github.com/teslamotors/informed), fixed-containers, liblithium | React forms, C++ containers, crypto | MIT / Apache-2.0 | None |
| linux, buildroot, coreboot | 2018 GPL-compliance releases for Autopilot boards; Autopilot application stack excluded | GPL-2.0 | None |
| dashcam, light-show, ttpoe, roadster, custom-wraps, LVCS | Viewer, light shows, Dojo protocol, Roadster CAN files | **No license file** | Do not copy anything; all rights reserved |

Tesla's **Patent Pledge** is not a license. It is a promise not to sue good-faith users of Tesla patents for electric-vehicle activity, expressly "not a waiver, licence, covenant not to sue." A pedestrian phone app is outside its scope and nothing in this plan needs it. Do not cite it as permission.

### What is usable: Tesla's published approach (concepts, not code)

| Idea | Where Tesla described it | StepSense version | Effort |
| --- | --- | --- | --- |
| Vision-only depth, no radar or LiDAR | [Karpathy, CVPR 2021 WAD keynote](https://www.youtube.com/watch?v=NSDTZQdo6H8) | Monocular depth model fused with the ground-plane estimate (section 3, Tier 2) | 4 to 6 h |
| Temporal fusion ("video module") | [Tesla AI Day 2021](https://www.youtube.com/watch?v=j0z4FweCy4M) | Extend the two-frame confirmation in `backend/alerts.js` to k-of-N agreement with consistent distance | 1 to 2 h |
| Class-agnostic occupancy network | [Elluswamy, CVPR 2022 WAD](https://www.youtube.com/watch?v=jPCV4GKX9Dw), [AI Day 2022](https://www.youtube.com/watch?v=ODSJsviD_SU) | Top-down walkway grid: project every SegFormer pixel that is not walkable onto the ground; alert when occupied cells enter the corridor. Unknown objects count as obstacles. | 3 to 6 h |
| Data engine: triggers, shadow mode | Karpathy, CVPR 2021 | "Wrong alert" / "missed hazard" buttons that post frame + detections + pitch + distance; a few automatic triggers (alert flicker, distance jumps); run a candidate config silently and count disagreements | 1 to 2 h each |
| Multi-task heads (HydraNet) | AI Day 2021 | Already true in spirit: COCO-SSD and SegFormer run on one frame. Fuse both into the grid above. Do not claim HydraNet. | 0.5 h |
| Telemetry schema | fleet-telemetry repo (Apache-2.0) | Define `stepsense_telemetry.proto` following their conventions. The one place "uses Tesla open source" is literally true. | 1 to 2 h |

Permissively licensed analogs worth citing: [comma.ai openpilot](https://github.com/commaai/openpilot) (MIT, vision-only driving, tiered alert escalation), [TPVFormer](https://github.com/wzzheng/TPVFormer) and [SurroundOcc](https://github.com/weiyithu/SurroundOcc) (Apache-2.0, occupancy reimplementations, reference only; not phone-runnable). "Pseudo-LiDAR" is a Cornell CVPR 2019 technique, not Tesla's.

## 2. Which phones have hardware depth

iPhone LiDAR is Pro-only: 12 Pro through 18 Pro and Pro Max ([Apple's list](https://support.apple.com/guide/iphone/aside/iphc07537a89/ios)). Base iPhone 12 through 17 have no LiDAR. iPhone Air, 16e, and SE have a single rear camera, so no stereo path either. Most Android phones have no time-of-flight sensor, but [ARCore's Depth API](https://developers.google.com/ar/develop/depth) computes depth from motion on about 88% of active devices ([device list](https://developers.google.com/ar/devices)).

LiDAR is not exposed to web pages at all, and WebXR AR is unsupported in iOS Safari. So the PWA never gets hardware depth on any phone; it needs the model and geometry tiers below.

## 3. Tiered depth architecture

Every tier produces the same per-detection fields: `distanceM`, `band` (very close / close / ahead / far), `source` (`lidar`, `arcore`, `fused`, `ground`, `prior`), and `confidence`. Alerts key off `band`. The backend still owns `alert.triggered`; distance is additive metadata.

### Tier 3: geometry only (every phone, both clients, no model) — do this first, 2 to 4 h

The sensor side of this tier (gravity-vector pitch, step gating, gyro ego-motion compensation, FOV calibration) is specified with code in [SENSOR_FUSION.md](SENSOR_FUSION.md).

- Keep the ground-plane estimate in `frontend/sample/index.html` (`estimateDistance`, lines 274 to 282).
- Add class-height priors: `Z = f_px * H_real / h_px`. Person 1.7 m, bicycle 1.0, car 1.45, chair 0.9, bench 0.45, suitcase 0.6, backpack 0.45. Use the prior when the box touches the image bottom (ground anchor unreliable); otherwise take the more conservative of the two when they agree within 2x.
- Add time-to-contact: the backend already pairs same-label boxes across frames for confirmation. Compute `tau = dt / (h2/h1 - 1)`; if tau is under 2 s and the box is in the zone, escalate one band. Treat it as an escalation signal, not a distance.
- Walk gating: alert only while the user is walking. Browser: `devicemotion` accelerometer periodicity at 1.5 to 2.5 Hz (iOS needs `DeviceMotionEvent.requestPermission()` inside a tap over HTTPS). Android native: `Sensor.TYPE_STEP_DETECTOR`. iOS native: `CMMotionActivityManager`.
- Suppress alerts when pitch says the camera points at the ceiling or the user's face.

### Tier 2: monocular depth model fused with the ground plane (every phone via the backend) — 4 to 6 h

- Model: [onnx-community/depth-anything-v2-small](https://huggingface.co/onnx-community/depth-anything-v2-small) (Apache-2.0). `onnx/model_quantized.onnx` is 27 MB, `model_fp16.onnx` 50 MB, `model_q4f16.onnx` 19 MB. Only the Small variant is Apache-2.0; Base, Large, and Giant are CC-BY-NC-4.0 and must not ship.
- Backend: new `backend/depth-worker.js` cloned from `backend/surface-worker.js` (same `onnxruntime-web` WASM plus `sharp` pattern, same ImageNet `MEAN`/`STD`). Resize so both sides are multiples of 14; start at 266 or 322 px for speed. Output is relative inverse depth, not meters. Run it trailing and non-blocking exactly like `surface`, 2 to 4 Hz, with its own `sequence`, and gate with a `DEPTH_MODEL` env flag. Report `depth.state` in `GET /api/v1/model`. Benchmark first with `backend/scripts/smoke-model.js`; single-thread WASM on a 25M-param ViT may exceed 1 s per frame, in which case switch this worker to `onnxruntime-node` or use `@huggingface/transformers` in Node, which wraps the same model behind `pipeline('depth-estimation', ...)`.
- Response additions: per detection `relDepth` (median disparity in the lower 40% of the box) and `groundSamples: [{y, rel}, ...]`, about 16 samples down the image center column restricted to pixels SegFormer labeled walkable (`WALKABLE_LABELS` in `backend/surface.js`).
- Scale fit on the client, no new headers or preferences: for each ground sample compute `Z_geo(y)` with `estimateDistance(y)`, fit `rel = a * (1/Z_geo) + b` by least squares (at least 4 samples, reject if R-squared under 0.8), then object distance `= 1 / ((relDepth - b) / a)`. Clamp to 0.3 to 15 m and smooth with the existing 0.8/0.2 filter. Fall back to Tier 3 when the fit is rejected (no floor visible, phone at the horizon, stairs).
- Why this beats ground plane alone: works for objects whose box bottom is occluded or above ground (poles, steps, overhangs), and a depth gradient across the floor exposes curbs that COCO-SSD has no class for.
- Optional native variants: iOS `apple/coreml-depth-anything-v2-small` (`DepthAnythingV2SmallF16.mlpackage`, 50 MB, about 31 to 34 ms on the Neural Engine, Apache-2.0, Swift sample in [huggingface/coreml-examples](https://github.com/huggingface/coreml-examples)); Android `litert-community/MiDaS-small` (MIT, 33 MB, GPU delegate required, about 20 ms on Pixel 8a).
- Optional browser variant: transformers.js with WebGPU (`device: 'webgpu'`, `dtype: 'q4f16'`), guarded by `navigator.gpu` and a one-shot latency probe. Chrome Android 121+ and iOS Safari 26+ only; frame rate on mid-range phones is unverified and iOS 26 has reported WebGPU bugs. Stretch goal, not the main path.

### Tier 1: hardware depth (native only, optional) — 4 to 10 h

- iPhone Pro: replace `AVCaptureDevice.default(.builtInWideAngleCamera ...)` in `samples/ios/StepSense/CameraCapture.swift` (line 111) with an `ARSession`, `frameSemantics = [.sceneDepth]` when `supportsFrameSemantics(.sceneDepth)`; send `frame.capturedImage` to the existing `/frames` endpoint and sample `sceneDepth.depthMap` at the returned anchor (median window, ignore low confidence). Non-LiDAR iPhones can still use ARKit plane detection plus raycast for a metric floor distance and real `ARCamera.intrinsics`, but planes need motion and texture and are flaky at first.
- Android: ARCore `Config.DepthMode.AUTOMATIC` and `frame.acquireDepthImage16Bits()`, sampled at the box bottom-center in millimeters. ARCore must own the camera, which conflicts with the Camera2 foreground service in `ScannerService.java`; run it in the Activity (foreground) and keep the service as the fallback tier. Needs device motion before depth is valid.

### Skip

- WebXR depth sensing: shipped in Chrome Android but only inside an `immersive-ar` session that replaces the page camera preview and upload loop. No iOS. Not for this deadline.
- Apple Depth Pro: 952M params, custom license, desktop GPU only.
- Depth Anything V2 Metric checkpoints: no license tag, no ready ONNX export.

## 4. Build plan by role

| Order | Task | Owner | Hours |
| --- | --- | --- | --- |
| 1 | Benchmark Depth-Anything-V2-Small on the laptop CPU (decide WASM vs onnxruntime-node) | Backend | 0.25 |
| 2 | Tier 3: class priors, time-to-contact escalation, walk gating in the sample and main PWA | Frontend | 2 to 4 |
| 3 | Tier 2: `depth-worker.js`, response fields, `depth.state` in `/api/v1/model`, `docs/api.md` update | Backend | 3 to 4 |
| 4 | Tier 2: client scale fit, `band`/`source` display, fallback to Tier 3 | Frontend | 2 |
| 5 | Temporal k-of-N confirmation with distance consistency | Backend | 1 to 2 |
| 6 | Walkway occupancy grid from SegFormer plus detections; draw it as a mini map | Backend + Frontend | 3 to 6 |
| 7 | "Wrong alert" / "missed hazard" report buttons and trigger logging | Frontend + Backend | 1 to 2 |
| 8 | Attribution, pitch slides, demo video; state limits plainly | Pitch lead | 2 |
| 9 | Optional: ARCore depth in the Android Activity, or Core ML depth in the Swift sample | Whoever is free | 4 to 10 |

Do steps 1 to 4 before anything else. Steps 5 to 7 are the Tesla story. Step 9 only if steps 1 to 8 are demoable.

## 5. What to say and not say to judges

Say: "StepSense is camera-only, like the approach Tesla described publicly at CVPR 2021 and AI Day. It estimates distance from a single camera by fusing a monocular depth model with ground-plane geometry, confirms obstacles across frames, builds a top-down walkway occupancy grid so unknown objects still count, and collects false-alert reports as a data flywheel."

Do not say: StepSense uses Tesla code, Tesla's occupancy network, FSD, HydraNet, a Tesla dataset, or Tesla weights. Do not cite the Patent Pledge. Do not display meters from an unfused depth map. Do not claim background scanning on iOS: camera use is prohibited in the background and the PWA stops when the page is hidden. Android's foreground service is the differentiator. Detection recall is the real ceiling: COCO-SSD has no curb, pothole, cone, or stair class; depth improves distances to detected things, it does not find new hazards.

## 6. Attribution block for ATTRIBUTION.md

```
Concepts (no code used): vision-only depth, data engine, shadow mode, and triggers
(A. Karpathy, Tesla, CVPR 2021 WAD keynote, youtube.com/watch?v=NSDTZQdo6H8);
multi-camera and temporal fusion, multi-task heads (Tesla AI Day 2021,
youtube.com/watch?v=j0z4FweCy4M); class-agnostic occupancy grid (A. Elluswamy,
Tesla, CVPR 2022 WAD keynote, youtube.com/watch?v=jPCV4GKX9Dw; Tesla AI Day 2022,
youtube.com/watch?v=ODSJsviD_SU). Occupancy grids themselves are a long-standing
robotics technique (Moravec and Elfes, 1985).

Models: Depth Anything V2 Small (Apache-2.0), ONNX conversion
onnx-community/depth-anything-v2-small, pinned revision <fill in>.
[Optional] Telemetry schema conventions adapted from teslamotors/fleet-telemetry
(Apache-2.0); NOTICE retained.

Tesla's Autopilot and FSD software is proprietary and is not used. Tesla's Patent
Pledge is not relied upon.
```

Sources for the depth findings: [ARCore Depth](https://developers.google.com/ar/develop/depth), [ARCore camera sharing](https://developers.google.com/ar/develop/java/camera-sharing), [WebXR depth sensing spec](https://immersive-web.github.io/depth-sensing/), [ARKit sceneDepth](https://developer.apple.com/documentation/arkit/arframe/scenedepth), [Core ML Depth Anything V2](https://huggingface.co/apple/coreml-depth-anything-v2-small), [Depth Anything V2 licenses](https://github.com/DepthAnything/Depth-Anything-V2), [transformers.js WebGPU](https://huggingface.co/docs/transformers.js/en/guides/webgpu), [Safari 26 WebGPU](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26/), [iOS background camera](https://developer.apple.com/documentation/avfoundation/avcapturesession/interruptionreason/videodevicenotavailableinbackground), [MiDaS small](https://huggingface.co/litert-community/MiDaS-small), [time-to-contact](https://pmc.ncbi.nlm.nih.gov/articles/PMC3390210). Latency figures for the backend model are estimates until benchmarked.
