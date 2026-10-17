# Clarity native iPhone sample

**System notifications:** Scan settings now includes opt-in notifications, a five-second test, permission status, an iOS Settings shortcut, and five permissions FAQ answers. See [notification setup and Critical Alerts approval requirements](NOTIFICATIONS.md). Critical Alerts are intentionally gated off in the standard build.

**Judges: [start with the native demo and source guide](JUDGES.md).** The current `main` contains **Clarity V2 Test**, an experimental offline YOLOX-Nano candidate, not the older StepSense/COCO-SSD build. The directory is `MyEyes`, the Xcode project is `MyEyes.xcodeproj`, and the target, scheme and built product are **Clarity**. These historical names do not identify different build targets.

## Current model and identity

- Display name: **Clarity V2 Test**. Bundle identifier: `com.dahacks.clarity.v2testing`.
- Packaged model: `MyEyes/OfflineDetector/candidate.onnx`, with ONNX Runtime Web **1.20.1** and its bundled WASM runtime. No model-download, Node server or Swift package step is required for the native app.
- [Model provenance](MyEyes/OfflineDetector/PROVENANCE.md), [asset hashes](MyEyes/OfflineDetector/ASSETS.json), and [V2 verification and limitations](../../docs/v2-testing/README.md) describe this candidate. Earlier COCO-SSD model paths, confidence measurements and bundle identifiers in historical records below do **not** describe current main.
- Candidate mAP is worse than baseline. The default confidence threshold is approximately **0.7875** and may yield sparse detections. JPEG preprocessing parity is not established. This is experimental testing, not an accuracy improvement or a safety device.
- Native images and LiDAR data stay on-device. Optional hardware depth is approximate axial depth, not collision prediction or clearance.

## Build and run

1. Open `samples/ios/MyEyes.xcodeproj` in Xcode and select the **Clarity** scheme. Minimum deployment target is iOS 16. A leftover `StepSense.xcodeproj/project.xcworkspace/xcuserdata` directory is not a buildable project and must not be submitted as source.
2. For a compilation check without signing or touching a phone, run the unsigned build below. For a physical demonstration, prefer the team's already-installed app. Installing a new build requires compatible hardware, appropriate signing and explicit device-owner consent. Do not overwrite an existing app or change its preferences merely to try this sample.
3. Tap **Start scanning** and allow camera access if requested. Denied permission must be changed by the device owner in Settings. Do not reset permissions or uninstall the app as a test step.
4. The preview starts before model initialization. Initialization failure remains **Preview only**, with no object alerts. Stop then Start retries.
5. Configure confidence, cooldown and sound/haptics/speech in Scan settings. No backend address is required. The app is portrait-only and uses the rear camera.

From the repository root on a Mac with Xcode and the iPhoneOS SDK:

```sh
xcodebuild -project samples/ios/MyEyes.xcodeproj -scheme Clarity \
  -configuration Debug -destination 'generic/platform=iOS' \
  -derivedDataPath "${JCODE_SCRATCH_DIR:-$HOME/Library/Caches}/clarity-unsigned" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
node --test samples/ios/tests/*.test.mjs
```

An unsigned `.app` proves compilation only. It is not an installable judge distribution, an IPA, TestFlight access, or physical camera acceptance. See [the judge guide](JUDGES.md) for the verified source revision and results.

## Frame and alert behavior

The camera captures a fresh JPEG only after the previous local inference completes, capped near three analyses per second. Frames retain the existing maximum 640-pixel long edge and JPEG quality 0.65. WebKit's WASM process performs inference without blocking the capture queue.

`OfflineDetector.swift` serves packaged files over the private `stepsense://offline/` scheme. It rejects other navigation and uses a restrictive page Content Security Policy. JPEGs are passed to JavaScript in memory and never uploaded. There is no local HTTP listener. `APIClient.swift` retains the shared response/preferences types and legacy unused backend client, but `ScanModel` no longer constructs or calls that client.

The exact existing JS alert policy is packaged as `policy.js`, with parity enforced by tests. Two nearby, same-label detections within 2.5 seconds confirm an alert. Cooldown suppresses repeated delivery. Preferences apply locally and invalidate in-flight UI results. Stop cancels pending work, releases the camera/WebKit, and invalidates late callbacks with both operation tokens and scan generations.

Initialization times out after 60 seconds and inference after 15 seconds. Results more than 2.5 seconds old never draw boxes or deliver alerts. Both main-view and PiP overlays expire if inference stalls. Model failure is never reported as a clear path.

**Limitations:** COCO categories do not include potholes, curbs, stairs, generic barriers, or every obstacle. The zone is an image-coordinate heuristic, not depth, collision prediction, or a measured walking corridor. An empty detection result is not evidence that travel is safe. Do not rely on this prototype for navigation or personal safety.

## Floating window

The existing video-call Picture in Picture camera implementation is retained. It requires an active PiP window, the declared `voip` background mode, and granted `AVCaptureSession.isMultitaskingCameraAccessEnabled`. Where background camera access is unavailable the camera pauses rather than implying live frames.

On launch the scanner is stopped and the floating window is closed. The PiP controller is prepared automatically, without a toggle or a saved opt-out preference. Tapping **Start scanning** arms automatic PiP entry once the camera starts, even if the model fails. Leaving the app can then open PiP when iOS permits. **Open floating window now** remains the explicit fallback (and can open an empty window before scanning). **Stop scanning** releases the camera and closes PiP. Dismissing PiP disarms automatic entry until a new scan or an explicit Open request, so returning to the app or finishing model loading does not force it open again. WebKit may suspend offline analysis while the app is backgrounded, even when the camera continues in PiP. Old boxes expire and the UI warns about this limitation. Background object alerts are **not guaranteed or verified**. The `voip` mode remains a hackathon prototype choice, not an assertion of App Store eligibility.

## Historical verification and implementation notes

The records below preserve earlier baseline work. Their COCO-SSD smoke results, old bundle identifiers, installation commands and device observations are historical evidence, not instructions to deploy current main. Use the current build commands above and the [V2 guide](../../docs/v2-testing/README.md) for the candidate. No physical acceptance is established by the October 17 read-only audit.

**October 17 follow-up Mac verification:** the integrated native source from upstream `7be09a5`, including the explicit `ScanPreferences` initializer, passed a fresh unsigned generic-iOS Debug build at 08:31 UTC and all 56 native regression tests under Node.js 24. The build used an external snapshot and DerivedData, with signing disabled and no installation or settings changes. This supersedes the earlier Windows-only check for compilation, not physical camera/LiDAR/PiP acceptance. The GitHub Actions workflow itself must still be checked on the published revision.

Windows checks for the integrated update: JavaScript syntax checks passed, and the browser/native-source regression suite passed 231 tests with zero failures. Two tests that compile and execute Swift were skipped because they require macOS. These results do not replace the Mac/Xcode checks below.

On a Mac with Node.js 24+ and Xcode, run:

```sh
node --test samples/ios/tests/*.test.mjs
xcodebuild -project samples/ios/MyEyes.xcodeproj -scheme Clarity \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/clarity-simulator-validation \
  CODE_SIGNING_ALLOWED=NO build
```

Confirm both commands pass, or confirm the `iPhone PiP build` workflow passes for the new commit, before marking these fixes verified. An earlier failure email describes an earlier run.

### PiP runtime diagnostics

After installing a Debug build, launch with opt-in diagnostics and keep this command running:

```sh
xcrun devicectl device process launch --device YOUR_DEVICE_UDID \
  --terminate-existing --console \
  --environment-variables '{"STEPSENSE_PIP_DIAGNOSTICS":"1"}' \
  com.dahacks.myeyes.sample
```

On the phone tap **Start scanning**, then **Open floating window now**, wait three seconds,
swipe Home, wait five seconds, and return to Clarity. Launch alone does not start the camera
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
  samples/ios/MyEyes/APIClient.swift \
  samples/ios/MyEyes/OfflineDetector.swift \
  samples/ios/tests/OfflineInferenceSmoke.swift \
  -o "$JCODE_SCRATCH_DIR/offline-inference-smoke"
"$JCODE_SCRATCH_DIR/offline-inference-smoke" \
  "$PWD/samples/ios/MyEyes/OfflineDetector" /absolute/path/to/cat.jpg
```

The smoke asserts a high-confidence cat and normalized box, confirming → triggered → cooldown, stale suppression, stale/error streak breaking, canceled startup replacement, malformed-image recovery, blocked remote fetch, single-flight rejection, a real 15-second hung-frame timeout, and shutdown. This exercises real production WebKit inference, not mocked detections. It is a macOS runtime test, not proof of iPhone camera/thermal/background behavior.

Signed iPhone build:

```sh
xcodebuild -project samples/ios/MyEyes.xcodeproj -scheme Clarity \
  -configuration Debug -destination 'id=YOUR_DEVICE_UDID' \
  -derivedDataPath "$JCODE_SCRATCH_DIR/clarity-device-signed" build
```

### Observed October 16, 2026

- Real WKWebView WASM inference: cat confidence **0.9304017425**, box `(x: 0.006709, y: 0.093559, width: 0.871384, height: 0.899779)`, in-zone. Representative macOS inference times **34–51 ms**, not iPhone performance measurements.
- Same bridge passed confirmation/cooldown, stale/error recovery, restart cancellation, and CSP-blocked remote fetch checks.
- Signed Debug iPhone build succeeded with team `MB3Z8QW8ML`.
- Installed and launched `com.dahacks.myeyes.sample` on the connected iPhone 15 Pro at 21:59:33Z and again with final verified sources at 22:03:13Z. Camera permissions were not reset.
- Live-camera detection accuracy, sound/haptic delivery, airplane-mode use on the physical phone, thermal/battery behavior, and PiP background inference still need on-device acceptance. Build/install/launch alone does not establish those results.

## Automatic hardware depth (LiDAR)

**Settings → Hardware depth → Automatic hardware depth** is persisted and **enabled when no choice is saved**, on fresh installations and when upgrading settings without a LiDAR preference. Explicitly saved `false` remains disabled and explicitly saved `true` remains enabled. Automatic selection probes actual hardware and compatible formats, not the device name. Stop scanning before changing it, then tap Apply and Start. The toggle, Apply, and Start remain disabled while capture is stopping. Changing alert settings does not restart capture. The model independently rejects capture-mode changes during an active scan.

On supported hardware, the existing AVFoundation session uses `builtInLiDARDepthCamera`, `AVCaptureDepthDataOutput`, and a video-primary `AVCaptureDataOutputSynchronizer`. No ARSession competes for the camera. A compatible 4:3 RGB/depth pair runs at 30 fps with unit zoom, portrait orientation, no mirroring, and stabilization off. Unsupported hardware/formats/orientation fall back to the ordinary wide-camera detector with an explicit capture status. PiP still uses the same video frames and the existing multitasking support check. LiDAR does not guarantee background camera access or background inference.

Labels such as **`depth ≈2.0 m`** mean approximate **axial depth along the camera's forward optical axis**, not Euclidean/radial camera-to-object distance, closest surface distance, collision prediction, or a safe walking corridor. The existing detector and alert policy do not consume depth. `depth unavailable` is shown when enabled but a usable measurement cannot be made. With LiDAR off there is no depth label.

### Alignment and rejection contract

The installed iPhoneOS 27.1 SDK's `AVCaptureDevice.h` documents that LiDAR depth is perspective-corrected to its paired RGB image with the same field of view and aspect ratio. `AVDepthData.h` documents that the map is warped to the RGB lens distortion. Both outputs are rotated to portrait; the JPEG is uniformly resized without a crop. Normalized boxes therefore address the matching normalized depth pixels. The implementation requires camera calibration, positive finite focal lengths and principal point, matching actual portrait aspect ratios, absolute accuracy, high quality, and **unfiltered** data. It does not independently rectify one image or use intrinsics to mislabel axial depth as radial range.

Only the depth belonging to the requested RGB frame is copied, respecting row stride. The physical iPhone can deliver depth for the preceding RGB frame in the current synchronizer callback. Capture therefore retains exactly one previous RGB sample and selects it only when its capture timestamp matches the depth timestamp within 1 ms and its gap to current RGB is under 100 ms. It never subtracts a guessed latency or widens the 1 ms gate. The matched RGB sample, not current RGB, is encoded for inference; current RGB still feeds PiP immediately. The retained sample is cleared on Stop, interruption, runtime error, dropped/missing RGB, and reconfiguration. Dropped/missing depth and unmatched timestamps are rejected. Capture time is converted from the session synchronization clock to host-clock age and then system uptime. The representative value is the median in the central half of the box, with at least 3×3 pixels, at least 90% valid coverage (only NaN holes may be omitted), a 0.2–5 m working range, and total depth spread no greater than max(8 cm, 6% of median). Mixed surfaces and outliers are rejected, not silently trimmed. Boxes must be finite and fully inside the image. This is a conservative heuristic, not object segmentation: homogeneous background within a loose box can still be mistaken for object depth. Reflective/transparent surfaces, small objects, lighting, motion, and occlusion remain limitations.

Depth must be less than **0.75 seconds old**, including capture queue and inference time. Depth labels expire independently of the existing 2.5-second detection-box expiry. Stop, interruption, toggle changes, preference revisions, mismatched inference frame identity, and missing depth clear prior values. No latest-depth cache is reused. All images and depth remain transient in memory, with no recording or cloud processing.

### Verification and physical acceptance

`node --test samples/ios/tests/*.test.mjs` compiles and executes the production Swift estimator and native detection enrichment on macOS. Tests cover valid depth, NaNs/infinities/range, sparse coverage, mixed surfaces/outliers, invalid/tiny/edge boxes, portrait quadrant mapping, exact age cutoff, automatic missing-preference migration, explicit saved false/true decoding and persistence, mismatched frame rejection, and toggle-off clearing. Additional source-wiring guards cover synchronized capture, calibration, Stop-first UI/model checks and conditional cancellation cleanup. These tests do **not** simulate a real LiDAR sensor or prove physical alignment.

Before treating physical depth as accepted, use the connected LiDAR iPhone to:
1. Confirm fresh settings and older settings without a LiDAR choice enable automatic selection. Confirm an explicitly saved OFF choice stays OFF after upgrade and relaunch. Verify ordinary scanning/PiP behavior in both cases.
2. Stop, enable if previously disabled, Apply, Start. Check capture status and compare a broad, matte detected object at measured 0.5, 1, 2 and 3 m against axial reference distances. Repeat near all image edges in portrait. Off-axis radial tape measurements are not the same quantity.
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
- Pre-feature baseline is `aa2c7d4291db99098dcf5ae065ad8a274ec009b8`. A verified signed pre-LiDAR app is preserved outside the feature build directory at `$JCODE_SCRATCH_DIR/stepsense-pre-lidar-rollback/Clarity.app`, with restore instructions and binary checksum in `ROLLBACK.md`. No rollback was performed because no device regression was observed. A locked-device launch failure alone is not evidence of a regression.


### Physical LiDAR diagnosis and repair, October 17, 2026 UTC

Metadata-only console capture on the connected iPhone 15 Pro confirmed that LiDAR was **configured**, not falling back to RGB. Selected formats were RGB 640×480 and depth 320×240 at 30 fps, both portrait-capable, unit zoom, absolute/high-quality/unfiltered depth with calibration present. The original gate rejected every delivered map because depth lagged current RGB by one frame: `depthToRGBptsMs=-33.336417`, while `depthToPreviousRGBms=0.0`. RGB wrapper timestamp and raw sample PTS agreed. The fix pairs the actual matching retained RGB with depth, preserving the exact timestamp, freshness, geometry, calibration and object-ROI gates.

The fixed physical pipeline produced **real fresh center-surface measurements**: 0.855 m at 60 ms capture age, 1.468 m at 69 ms, and 1.489 m at 68 ms. Later counters showed 506 previous-RGB matches and 59 accepted snapshots. These are sensor observations, **not tape-measured accuracy or object-distance acceptance**. Observed object ROIs still rejected out-of-range surfaces; final classified telemetry reported `surface beyond 5 m` with matched inference frame identity. Raw center success does not establish that a whole detection ROI is valid, and the range/coverage/spread gates were not relaxed.

The scene and Settings now show a clearly labeled **Center-surface LiDAR test**. It reports one finite center pixel from an accepted absolute/unfiltered snapshot, independent of object boxes, and becomes unavailable when older than 0.75 seconds. It is axial surface depth, not object distance or a safe-path indication. Capture/ROI rejection reasons are visible alongside the readout. The opt-in `STEPSENSE_PIP_DIAGNOSTICS=1` console reports format metadata, rate-limited stage counters, timing comparisons, center numeric depth, and ROI reason counts. It does not log images or detection labels, and does not persist on the phone.

Tests-first regression coverage includes the actual observed timestamps, rejection of mismatches/old or future prior RGB, center expiry/nonfinite/range cases, exact ROI reasons, and lifecycle buffer clearing. **44/44** native sample tests pass. The real bundled WKWebView/WASM smoke also passed with the existing non-camera cat fixture (confidence 0.9304017425), including cancellation, single-flight, timeout, stale suppression and blocked remote fetch. Signed physical-device builds and installs succeeded. No model, PiP, settings, alert policy, camera permissions or rollback artifact was replaced.

Remaining manual acceptance: confirm the visible readout on the phone, compare axial center readings against measured matte surfaces at 0.5/1/2/3 m, verify detected-object association near image edges, and exercise PiP/backgrounding and stop/restart. No camera images need to be recorded.

### Depth-unavailable investigation (2026-10-16 follow-up)

The center test now distinguishes no sensor return (NaN), nonfinite values, values outside the supported 0.2–5 m interval, malformed maps and stale timestamps. This is separate from object ROI rejection. No distance acceptance gates, timestamp pairing, filtering, or object association were relaxed.

Opt-in `STEPSENSE_PIP_DIAGNOSTICS=1` adds `lidar.distribution` at the existing three-second center-log interval. It contains only raw center scalar and aggregate full-map / central 5×5 counts (valid, NaN, nonfinite, below/beyond range) and finite min/max. The log is evaluated lazily only when diagnostics are enabled. It does not save camera frames or depth maps. Neighbor statistics are diagnostic only, never substituted for object depth or center distance.

Regression verification: 50/50 iOS sample tests, signed physical-device build and strict code-signature verification passed. Production WKWebView/WASM inference with the existing non-camera cat fixture passed (confidence 0.9304017425), including stale/error recovery, cancellation, single-flight, timeout and blocked remote fetch. The diagnostic build installed and launched on the connected iPhone 15 Pro. The first live follow-up captured 58 inference frames. Center values 0.886 m and 1.063 m passed at ages 59–65 ms. Unavailable samples 0.184, 0.101, 0.121 and 0.094 m were below the retained 0.2 m limit, and every central 5×5 neighbor was also below it (no NaNs there). Thus a neighbor fallback would not fix these intervals. Logged ROI checks contained no objects, so object-associated depth remains unverified. This establishes range rejection for these observed center failures, not sensor accuracy or resolution of every reported missing object depth.

### Automatic hardware-depth preference verification

The preference migration is tested by compiling the actual `APIClient.swift` and decoding `ScanPreferences` with its existing required JSON fields, not a copied preference type. Missing preferences enable hardware-depth selection, while explicit false and true survive decoding and encoding. Existing synchronized capture, format probing, partial-configuration rollback to the wide camera, source/rejection diagnostics, estimator gates and PiP ownership are unchanged.

Physical acceptance of this default change remains **unverified**: fresh/legacy/explicit-off settings in the device UI, non-LiDAR and unsupported-format RGB fallback, start/stop/restart, interruptions, and LiDAR-enabled PiP/background behavior require real devices. Axial reference comparisons at 0.5, 1, 2 and 3 m and object association near image edges remain required. Automated tests and historical sensor observations above do not establish measured accuracy or acceptance of this change.
