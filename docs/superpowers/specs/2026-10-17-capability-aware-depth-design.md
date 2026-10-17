# Clarity capability-aware depth design

Date: 2026-10-17
Status: Approved by the user on 2026-10-17 at 06:52 UTC. Implementation decisions and supported-domain limitations are recorded in `docs/DEPTH_IMPLEMENTATION_LOG.md`. No accuracy claims have been established for the new non-LiDAR path.

## Goal and scope

Add useful distance information alongside the existing v1 COCO-SSD detector. Prefer validated hardware depth where the application can access it. Keep uncertain monocular output visibly distinct from physical measurements. Initial targets are the deployed Clarity webapp and the native iPhone app. Android-native ARCore support is not part of this implementation.

## Approaches considered

1. Geometry only: lightweight and auditable, but requires calibrated intrinsics/camera height, valid attitude and a flat ground contact assumption. Unsuitable for arbitrary floating or occluded objects.
2. Monocular depth model only: provides relative scene structure on ordinary cameras, but its output is not metres. Even metric models require physical validation and may have large domain-dependent errors.
3. Recommended: capability-aware hardware depth plus an optional relative-depth model, with calibrated geometry used only when its assumptions are established. Unknown must remain unknown rather than falling back to an invented object-size prior.

OpenCV is optional for camera calibration and geometric verification. Adding its full runtime is not justified for a few projection and robust-fit functions. If later multi-view estimation is needed, revisit it separately.

## Capability selection

### Native iPhone

Reuse `LiDARCapture`, `AVCaptureDepthDataOutput`, the synchronized RGB/depth delegate, and `DepthSnapshot`. Do not replace this with a second camera or ARKit session that competes with the PiP capture session.

On a fresh installation, enable automatic hardware-depth selection. Probe `.builtInLiDARDepthCamera` and supported format pairs at runtime. Preserve an explicitly stored user-disabled preference. A missing sensor, configuration failure, unsupported capture mode, interruption or stale map must fall back to RGB detection without fabricated distance. Display the actual selected source and reason when depth is unavailable. Stop/start rules remain intact when changing capture configuration.

Retain existing rejection gates for absolute quality, calibration, aligned frames, age, sample coverage and mixed surfaces. Report axial optical-axis depth as such, not Euclidean range or nearest-obstacle clearance. Existing native camera and PiP behavior must remain functional.

### Webapp

Ordinary `getUserMedia` does not expose native iPhone LiDAR maps. Do not infer sensor availability from the device name, user-agent, number of cameras or the presence of WebGPU. State this limitation explicitly in the UI.

Run a browser-local Depth Anything V2 Small adapter alongside, not in place of, v1 object detection. Use a pinned, license-verified Transformers.js/ONNX implementation after compatibility and latency testing. The checked upstream ONNX model card identifies Apache-2.0 licensing. Runtime/model versions and source hashes must be recorded before shipping. The ONNX repository currently points to a newer `-ONNX` repository, so compatibility must be checked rather than relying on historical documentation.

Load this optional model only after the user enables estimated depth. Inform the user of the measured download size. Prefer supported WebGPU after a successful probe, otherwise try WASM within a bounded latency/memory budget. If neither is usable, report unavailable and keep v1 detection running. Camera frames stay on device. Model downloads are network requests, not frame uploads.

## Estimation contract

Each result identifies `source`, `kind` (measured, estimated, relative, unavailable), frame sequence, capture timestamp, calibration revision, validity state and rejection reason. Metric estimates include an interval in metres. Relative results carry no metric fields. Intervals are model/geometry uncertainty bounds, not statistically calibrated confidence probabilities.

Never derive metres from visualization-normalized depth PNGs. Use raw predicted depth/disparity tensors and verify their conventions for the chosen model. Single-image relative-depth values may change scale and offset between images; a calibration of those values from an earlier scene cannot be reused as an unconditional metric conversion.

## Calibration and geometric constraints

Provide a small calibration workflow for camera height and camera projection/FOV, with a measured reference and a fixed capture configuration. Track lens, resolution, orientation and calibration revision. Changing these invalidates affected calibration. Motion/orientation access is requested from an explicit gesture where required. Permission denial disables dependent estimates, not the camera.

For a ground-contact estimate, intersect a calibrated image ray with a level ground plane using measured camera height and current attitude. Reject near-horizon rays, excessive roll/uncertainty, missing attitude, stale sensor samples and out-of-domain geometry. A detection box bottom is not proof of floor contact. Require a declared/validated ground-contact use case and expose the assumption instead of silently applying it to every detection.

For model-assisted metric conversion, use same-frame ground/reference anchors only when their identity and metric geometry are established. Do not label arbitrary central image pixels as floor. Robustly fit the raw relative output to inverse metric depth using multiple spatially separated valid anchors. Reject poor residuals, inadequate depth spread, invalid denominators, inconsistent hold-out anchors or disagreement with direct geometry. If these conditions cannot be established, present relative depth only. No cached scale from an unrelated frame, class-average height, or assumed walking stride is a substitute for calibration.

## Scheduling and UI

Use one in-flight depth inference, downscaled input and an adaptive low duty cycle. Pair depth and detection by captured frame, not by whichever output arrived most recently. Discard results after stop, hidden-page transitions, lens/calibration changes and the result freshness limit. Depth work must not block v1 alerts or establish a second camera stream.

Show a source badge: `LiDAR measured`, `Camera estimated`, `Relative depth only`, or `Depth unavailable`. Show rounded ranges only for accepted metric estimates. Preserve the current Clarity design and object overlay. No `safe to walk` conclusion follows from an empty detection or depth result. Keep depth out of automatic safety-critical alert escalation until physical accuracy validation is recorded.

## Acceptance and evidence map

| Requirement | Concrete check and required evidence |
| --- | --- |
| Detect available LiDAR | Capability/format tests and native device diagnostic showing selected source; test missing and unsupported hardware paths |
| Use actual LiDAR measurements | Existing real Swift estimator tests plus synchronized captured-frame checks; retain stale/mixed/invalid rejection tests |
| Preserve preference choice | Decode legacy unset, explicit false and explicit true preferences; unset selects auto while explicit false remains disabled |
| Camera-only depth | Run the actual model on real image input; verify raw output shape, finite values and expected relative ordering, without claiming metric accuracy |
| Metric calibration | Analytic projection tests, independent held-out reference samples, orientation/crop invalidation and rejection tests |
| Relatively accurate distances | Physical tape-measure comparison at 0.5, 1, 2 and 3 m, repeated across representative objects, illumination and camera poses; record absolute/relative error, rejection rate and latency |
| Reliability target | Provisional target for accepted camera estimates: median error <=20% and 90th-percentile error <=30% over the declared calibrated test conditions; do not claim it is achieved until measurements exist |
| No misleading certainty | UI assertions ensure relative/invalid/stale output never displays metres; source and assumption labels remain visible |
| Integration | Start/stop/restart, permission denial, model failure, device rotation, app hiding and PiP regressions; one camera owner and bounded inference concurrency |
| Deployment | Verify current Clarity HTML, every new runtime/model asset or external model URL, licensing, response sizes, model load and depth UI on the public URL |

Physical acceptance requires actual devices and measured references. Synthetic geometry tests and a model heatmap are not evidence of real-world distance accuracy. If device access is unavailable, ship only clearly labeled experimental behavior and record the blocked checks explicitly.

## Implementation boundaries

Separate pure geometry/validation, browser sensor collection, model loading/inference, scheduling and presentation into small modules. Native changes should remain scoped to capability/default preference selection, diagnostics and tests while reusing the existing depth estimator. Do not retrain or replace v1, alter the ongoing v2 training, introduce a new cloud inference backend, or overwrite teammate changes.

## Sources inspected

- Existing `samples/ios/MyEyes/LiDARCapture.swift`, `DepthEstimate.swift`, `CameraCapture.swift`, `ScanModel.swift` and preference implementation.
- Existing historical `docs/SENSOR_FUSION.md` and `docs/TESLA_AND_NO_LIDAR_RESEARCH.md`, treated as ideas rather than verified current capabilities.
- https://huggingface.co/onnx-community/depth-anything-v2-small/raw/main/README.md (model card and browser runtime example, fetched 2026-10-17).
