# StepSense native iPhone sample

The SwiftUI camera app now runs **fully offline object detection** using the same pretrained COCO-SSD `lite_mobilenet_v2` graph as the backend. It bundles TensorFlow.js 4.22.0, its single-threaded WebAssembly backend, COCO-SSD 2.2.3, and all five weight shards. No server, Wi-Fi, mobile data, or runtime model download is required. This is not a custom-trained model or a different Core ML detector.

**Model path:** `samples/ios/StepSense/OfflineDetector/model/model.json`, with `group1-shard1of5` through `group1-shard5of5` alongside it. See [exact provenance, SHA-256 manifest, and Apache-2.0 notices](StepSense/OfflineDetector/PROVENANCE.md).

## Build and run

1. Open `samples/ios/StepSense.xcodeproj` in Xcode. Select your development team and connected iPhone. The minimum deployment target remains iOS 16.
2. Build/run the **StepSense** scheme. No Swift package installation, Node server, or model-download step is necessary for the checked-in app.
3. Tap **Start scanning** and allow camera access if iOS requests it. Existing permission is reused. Denied permission must be changed in iOS Settings; do not reset permissions to test this app.
4. The camera preview starts before model initialization. If initialization fails, the app explicitly remains **Preview only**, with no object alerts. Stop then Start retries.
5. Configure confidence, cooldown, and sound/haptics/speech in Scan settings. No backend address is required.

The app is portrait-only. It uses the rear camera and shows aspect-fit normalized boxes with class and confidence. Yellow means the object's bottom-center lies in the image zone; teal means outside it. Supported labels match `backend/alerts.js`.

## Frame and alert behavior

The camera captures a fresh JPEG only after the previous local inference completes, capped near three analyses per second. Frames retain the existing maximum 640-pixel long edge and JPEG quality 0.65. WebKit's WASM process performs inference without blocking the capture queue.

`OfflineDetector.swift` serves packaged files over the private `stepsense://offline/` scheme. It rejects other navigation and uses a restrictive page Content Security Policy. JPEGs are passed to JavaScript in memory and never uploaded. There is no local HTTP listener. `APIClient.swift` retains the shared response/preferences types and legacy unused backend client, but `ScanModel` no longer constructs or calls that client.

The exact existing JS alert policy is packaged as `policy.js`, with parity enforced by tests. Two nearby, same-label detections within 2.5 seconds confirm an alert. Cooldown suppresses repeated delivery. Preferences apply locally and invalidate in-flight UI results. Stop cancels pending work, releases the camera/WebKit, and invalidates late callbacks with both operation tokens and scan generations.

Initialization times out after 60 seconds and inference after 15 seconds. Results more than 2.5 seconds old never draw boxes or deliver alerts. Both main-view and PiP overlays expire if inference stalls. Model failure is never reported as a clear path.

**Limitations:** COCO categories do not include potholes, curbs, stairs, generic barriers, or every obstacle. The zone is an image-coordinate heuristic, not depth, collision prediction, or a measured walking corridor. An empty detection result is not evidence that travel is safe. Do not rely on this prototype for navigation or personal safety.

## Floating window

The existing video-call Picture in Picture camera implementation is retained. It requires an active PiP window, the declared `voip` background mode, and granted `AVCaptureSession.isMultitaskingCameraAccessEnabled`. Where background camera access is unavailable the camera pauses rather than implying live frames.

On launch the scanner is stopped and the floating window is closed. The PiP controller is prepared automatically, without a toggle or a saved opt-out preference. Tapping **Start scanning** arms automatic PiP entry once the camera starts, even if the model fails. Leaving the app can then open PiP when iOS permits. **Open floating window now** remains the explicit fallback (and can open an empty window before scanning). **Stop scanning** releases the camera and closes PiP. Dismissing PiP disarms automatic entry until a new scan or an explicit Open request, so returning to the app or finishing model loading does not force it open again. WebKit may suspend offline analysis while the app is backgrounded, even when the camera continues in PiP. Old boxes expire and the UI warns about this limitation. Background object alerts are **not guaranteed or verified**. The `voip` mode remains a hackathon prototype choice, not an assertion of App Store eligibility.

## Verification

### PiP runtime diagnostics

After installing a Debug build, launch with opt-in diagnostics and keep this command running:

```sh
xcrun devicectl device process launch --device YOUR_DEVICE_UDID \
  --terminate-existing --console \
  --environment-variables '{"STEPSENSE_PIP_DIAGNOSTICS":"1"}' \
  com.dahacks.stepsense.sample
```

On the phone tap **Start scanning**, then **Open floating window now**, wait three seconds,
swipe Home, wait five seconds, and return to StepSense. Launch alone does not start the camera
or explicitly request PiP. Look for `scan.start`, `camera.started`,
`scan.pipButton`, `pip.start.invoke`, and `pip.delegate.didStart` or `pip.delegate.failed`.
`pip.start.timeout` means readiness never became true during the existing two-second wait.
Compare `camera.frames` with `display.frames`, scene transitions, and interruption reason codes.
Enqueued frame counts do not prove pixels appeared on screen.

`[PiPDiag]` logs contain readiness, source geometry/window membership, audio category/mode and
activation outcomes, camera/frame counts, inference timings, and NSError domains/codes.
They do not contain camera images, detections, speech, or error descriptions. The app does not
persist these logs. They are off unless the launch environment opts in. `--console` also captures
Apple framework messages, which are outside this logger's control. A normal icon relaunch does
not retain the diagnostic environment, so rerun the command if the process exits.

Initial physical-iPhone diagnostic launch on October 16 confirmed `supported=true`,
`possible=true`, `sourceWindow=true`, source bounds approximately 349×230 points, and successful
Playback/SpokenAudio setup and activation. That launch ended after toggle changes and backgrounding
with `phase=idle`, `camera=false`, and no PiP start request. It does **not** establish the cause of
the reported failure or prove PiP works. The instrumented scan/start/background sequence is still
required. No background mode, audio mode, or PiP behavior was changed for this diagnostic build.

The logger privacy/opt-in test compiles and executes Swift on macOS. Other platforms skip that
test, while the remaining structural tests run normally.

Run structural, bundle integrity, and exact-policy tests:

```sh
node --test samples/ios/tests/*.test.mjs
npm --prefix backend test
```

Run actual offline inference using the production Swift bridge, WKWebView, JS runtime, model, and policy on macOS. Supply a licensed 224×224 cat photograph whose bottom-center is in the image zone (the fixture is not packaged in the application):

```sh
swiftc -parse-as-library \
  samples/ios/StepSense/APIClient.swift \
  samples/ios/StepSense/OfflineDetector.swift \
  samples/ios/tests/OfflineInferenceSmoke.swift \
  -o "$JCODE_SCRATCH_DIR/offline-inference-smoke"
"$JCODE_SCRATCH_DIR/offline-inference-smoke" \
  "$PWD/samples/ios/StepSense/OfflineDetector" /absolute/path/to/cat.jpg
```

The smoke asserts a high-confidence cat and normalized box, confirming → triggered → cooldown, stale suppression, stale/error streak breaking, canceled startup replacement, malformed-image recovery, blocked remote fetch, single-flight rejection, a real 15-second hung-frame timeout, and shutdown. This exercises real production WebKit inference, not mocked detections. It is a macOS runtime test, not proof of iPhone camera/thermal/background behavior.

Signed iPhone build:

```sh
xcodebuild -project samples/ios/StepSense.xcodeproj -scheme StepSense \
  -configuration Debug -destination 'id=YOUR_DEVICE_UDID' \
  -derivedDataPath "$JCODE_SCRATCH_DIR/stepsense-device-signed" build
```

### Observed October 16, 2026

- Real WKWebView WASM inference: cat confidence **0.9304017425**, box `(x: 0.006709, y: 0.093559, width: 0.871384, height: 0.899779)`, in-zone. Representative macOS inference times **34–51 ms**, not iPhone performance measurements.
- Same bridge passed confirmation/cooldown, stale/error recovery, restart cancellation, and CSP-blocked remote fetch checks.
- Signed Debug iPhone build succeeded with team `MB3Z8QW8ML`.
- Installed and launched `com.dahacks.stepsense.sample` on the connected iPhone 15 Pro at 21:59:33Z and again with final verified sources at 22:03:13Z. Camera permissions were not reset.
- Live-camera detection accuracy, sound/haptic delivery, airplane-mode use on the physical phone, thermal/battery behavior, and PiP background inference still need on-device acceptance. Build/install/launch alone does not establish those results.

## Optional LiDAR axial depth

**Settings → Optional LiDAR → LiDAR depth estimates** is persisted and **OFF by default**, including when upgrading older saved settings. Stop scanning before changing it, then tap Apply and Start. The toggle, Apply, and Start remain disabled while capture is stopping. Changing alert settings does not restart capture. The model independently rejects capture-mode changes during an active scan.

On supported hardware, the existing AVFoundation session uses `builtInLiDARDepthCamera`, `AVCaptureDepthDataOutput`, and a video-primary `AVCaptureDataOutputSynchronizer`. No ARSession competes for the camera. A compatible 4:3 RGB/depth pair runs at 30 fps with unit zoom, portrait orientation, no mirroring, and stabilization off. Unsupported hardware/formats/orientation fall back to the ordinary wide-camera detector with an explicit capture status. PiP still uses the same video frames and the existing multitasking support check. LiDAR does not guarantee background camera access or background inference.

Labels such as **`depth ≈2.0 m`** mean approximate **axial depth along the camera's forward optical axis**, not Euclidean/radial camera-to-object distance, closest surface distance, collision prediction, or a safe walking corridor. The existing detector and alert policy do not consume depth. `depth unavailable` is shown when enabled but a usable measurement cannot be made. With LiDAR off there is no depth label.

### Alignment and rejection contract

The installed iPhoneOS 27.1 SDK's `AVCaptureDevice.h` documents that LiDAR depth is perspective-corrected to its paired RGB image with the same field of view and aspect ratio. `AVDepthData.h` documents that the map is warped to the RGB lens distortion. Both outputs are rotated to portrait; the JPEG is uniformly resized without a crop. Normalized boxes therefore address the matching normalized depth pixels. The implementation requires camera calibration, positive finite focal lengths and principal point, matching actual portrait aspect ratios, absolute accuracy, high quality, and **unfiltered** data. It does not independently rectify one image or use intrinsics to mislabel axial depth as radial range.

Only the depth belonging to the requested RGB frame is copied, respecting row stride. The physical iPhone can deliver depth for the preceding RGB frame in the current synchronizer callback. Capture therefore retains exactly one previous RGB sample and selects it only when its capture timestamp matches the depth timestamp within 1 ms and its gap to current RGB is under 100 ms. It never subtracts a guessed latency or widens the 1 ms gate. The matched RGB sample, not current RGB, is encoded for inference; current RGB still feeds PiP immediately. The retained sample is cleared on Stop, interruption, runtime error, dropped/missing RGB, and reconfiguration. Dropped/missing depth and unmatched timestamps are rejected. Capture time is converted from the session synchronization clock to host-clock age and then system uptime. The representative value is the median in the central half of the box, with at least 3×3 pixels, at least 90% valid coverage (only NaN holes may be omitted), a 0.2–5 m working range, and total depth spread no greater than max(8 cm, 6% of median). Mixed surfaces and outliers are rejected, not silently trimmed. Boxes must be finite and fully inside the image. This is a conservative heuristic, not object segmentation: homogeneous background within a loose box can still be mistaken for object depth. Reflective/transparent surfaces, small objects, lighting, motion, and occlusion remain limitations.

Depth must be less than **0.75 seconds old**, including capture queue and inference time. Depth labels expire independently of the existing 2.5-second detection-box expiry. Stop, interruption, toggle changes, preference revisions, mismatched inference frame identity, and missing depth clear prior values. No latest-depth cache is reused. All images and depth remain transient in memory, with no recording or cloud processing.

### Verification and physical acceptance

`node --test samples/ios/tests/*.test.mjs` compiles and executes the production Swift estimator and native detection enrichment on macOS. Tests cover valid depth, NaNs/infinities/range, sparse coverage, mixed surfaces/outliers, invalid/tiny/edge boxes, portrait quadrant mapping, exact age cutoff, default-off migration, persisted on/off, mismatched frame rejection, and toggle-off clearing. Additional source-wiring guards cover synchronized capture, calibration, Stop-first UI/model checks and conditional cancellation cleanup. These tests do **not** simulate a real LiDAR sensor or prove physical alignment.

Before treating physical depth as accepted, use the connected LiDAR iPhone to:
1. Confirm the toggle is OFF on first upgrade and ordinary scanning/PiP behavior remains unchanged.
2. Stop, enable, Apply, Start. Check capture status and compare a broad, matte detected object at measured 0.5, 1, 2 and 3 m against axial reference distances. Repeat near all image edges in portrait. Off-axis radial tape measurements are not the same quantity.
3. Put different-depth surfaces inside one detection box, obscure the sensor, test reflective surfaces, and move rapidly. Unreliable/mixed/stale estimates must become unavailable. Pause/interruption must clear them.
4. Stop, disable, Apply, restart, and relaunch the app. Confirm no old depth labels and persisted preference. Verify non-LiDAR fallback on actual non-LiDAR hardware when available.
5. Exercise PiP entry, backgrounding, hiding/moving the window, return, and Stop in both modes. Observe real camera pixels and fresh labels, not only callback counters.

Signed build/install and automated tests are not reference-distance acceptance. No camera images need to be recorded for these checks.

### LiDAR implementation verification, October 16, 2026

- **42/42** native sample tests and **27/27** backend tests passed.
- Real production WKWebView/WASM smoke passed with LiDAR preference both off and on: cat confidence **0.9304017425**, confirming → triggered → cooldown, stale/error recovery, cancellation, single-flight, timeout, blocked remote fetch. This is detector regression coverage, not physical LiDAR accuracy.
- Signed Debug build for the connected iPhone 15 Pro succeeded using the installed iPhoneOS 27.1 SDK. `codesign --verify --deep --strict` passed. No new Swift compiler warnings remain (Xcode reports only the unrelated absent-AppIntents metadata notice).
- Final app installed on the connected iPhone at approximately **23:53:16Z**. An earlier feature build launched successfully at **23:51:48Z**. Launch of the final tightened-outlier build was denied because the phone was locked (`FBSOpenApplicationErrorDomain`, `Locked`). No unlock, permission reset, or credential action was attempted.
- Physical depth/reference-distance accuracy, real on/off persistence UI, non-LiDAR hardware fallback, and LiDAR-enabled PiP/background behavior remain **unverified**. The physical acceptance checklist above is still required.
- Pre-feature baseline is `aa2c7d4291db99098dcf5ae065ad8a274ec009b8`. A verified signed pre-LiDAR app is preserved outside the feature build directory at `$JCODE_SCRATCH_DIR/stepsense-pre-lidar-rollback/StepSense.app`, with restore instructions and binary checksum in `ROLLBACK.md`. No rollback was performed because no device regression was observed. A locked-device launch failure alone is not evidence of a regression.


### Physical LiDAR diagnosis and repair, October 17, 2026 UTC

Metadata-only console capture on the connected iPhone 15 Pro confirmed that LiDAR was **configured**, not falling back to RGB. Selected formats were RGB 640×480 and depth 320×240 at 30 fps, both portrait-capable, unit zoom, absolute/high-quality/unfiltered depth with calibration present. The original gate rejected every delivered map because depth lagged current RGB by one frame: `depthToRGBptsMs=-33.336417`, while `depthToPreviousRGBms=0.0`. RGB wrapper timestamp and raw sample PTS agreed. The fix pairs the actual matching retained RGB with depth, preserving the exact timestamp, freshness, geometry, calibration and object-ROI gates.

The fixed physical pipeline produced **real fresh center-surface measurements**: 0.855 m at 60 ms capture age, 1.468 m at 69 ms, and 1.489 m at 68 ms. Later counters showed 506 previous-RGB matches and 59 accepted snapshots. These are sensor observations, **not tape-measured accuracy or object-distance acceptance**. Observed object ROIs still rejected out-of-range surfaces; final classified telemetry reported `surface beyond 5 m` with matched inference frame identity. Raw center success does not establish that a whole detection ROI is valid, and the range/coverage/spread gates were not relaxed.

The scene and Settings now show a clearly labeled **Center-surface LiDAR test**. It reports one finite center pixel from an accepted absolute/unfiltered snapshot, independent of object boxes, and becomes unavailable when older than 0.75 seconds. It is axial surface depth, not object distance or a safe-path indication. Capture/ROI rejection reasons are visible alongside the readout. The opt-in `STEPSENSE_PIP_DIAGNOSTICS=1` console reports format metadata, rate-limited stage counters, timing comparisons, center numeric depth, and ROI reason counts. It does not log images or detection labels, and does not persist on the phone.

Tests-first regression coverage includes the actual observed timestamps, rejection of mismatches/old or future prior RGB, center expiry/nonfinite/range cases, exact ROI reasons, and lifecycle buffer clearing. **44/44** native sample tests pass. The real bundled WKWebView/WASM smoke also passed with the existing non-camera cat fixture (confidence 0.9304017425), including cancellation, single-flight, timeout, stale suppression and blocked remote fetch. Signed physical-device builds and installs succeeded. No model, PiP, settings, alert policy, camera permissions or rollback artifact was replaced.

Remaining manual acceptance: confirm the visible readout on the phone, compare axial center readings against measured matte surfaces at 0.5/1/2/3 m, verify detected-object association near image edges, and exercise PiP/backgrounding and stop/restart. No camera images need to be recorded.

### Depth-unavailable investigation (2026-10-16 follow-up)

The center test now distinguishes no sensor return (NaN), nonfinite values, values outside the supported 0.2–5 m interval, malformed maps and stale timestamps. This is separate from object ROI rejection. No distance acceptance gates, timestamp pairing, filtering, or object association were relaxed.

Opt-in `STEPSENSE_PIP_DIAGNOSTICS=1` adds `lidar.distribution` at the existing three-second center-log interval. It contains only raw center scalar and aggregate full-map / central 5×5 counts (valid, NaN, nonfinite, below/beyond range) and finite min/max. The log is evaluated lazily only when diagnostics are enabled. It does not save camera frames or depth maps. Neighbor statistics are diagnostic only, never substituted for object depth or center distance.

Regression verification: 50/50 iOS sample tests, signed physical-device build and strict code-signature verification passed. Production WKWebView/WASM inference with the existing non-camera cat fixture passed (confidence 0.9304017425), including stale/error recovery, cancellation, single-flight, timeout and blocked remote fetch. The diagnostic build installed and launched on the connected iPhone 15 Pro. Live distribution validation still requires a foreground Start action, so this diagnostic/UI fix does **not** establish resolution of the reported missing depth or sensor accuracy.
