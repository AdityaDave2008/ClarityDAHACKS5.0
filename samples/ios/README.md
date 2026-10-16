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

The floating window is offered as soon as the camera runs, even if the model fails. WebKit may suspend offline analysis while the app is backgrounded, even when the camera continues in PiP. Old boxes expire and the UI warns about this limitation. Background object alerts are **not guaranteed or verified**. The `voip` mode remains a hackathon prototype choice, not an assertion of App Store eligibility.

## Verification

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
