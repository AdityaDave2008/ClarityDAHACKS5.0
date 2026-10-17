# V2 experimental iPhone testing

## Build and rollback

Branch `v2-testing` starts at fresh main `b1bbc49`, isolated in a separate clone. Native source on this main is `samples/ios/MyEyes`, product `Clarity`.

Testing bundle `com.dahacks.clarity.v2testing`, icon **Clarity V2 Test**. Original installed **StepSense** (`com.dahacks.stepsense.sample`) and its preferences remain untouched. Switch back to that app to roll back. No uninstall, reset, or permission changes were performed. The separate testing app will request its own camera permission on first scan. Its own settings persist normally.

## What is and is not verified

- Exact fine-tuned ONNX SHA and every deployed runtime/adapter asset pass hash checks.
- 56 native regression/contract tests pass, including camera, PiP, LiDAR and alert-policy checks. Native camera/depth/PiP implementation is unchanged.
- Actual **macOS** WKWebView production bridge smoke passes cancellation/restart, native default negative, default positive lossless image and reference geometry, low-threshold confirmation/cooldown, stale suppression, malformed-image recovery, single-flight, 15-second timeout and denied remote fetch. See `macos-wk-smoke.log`. Timings are Mac timings, not iPhone performance claims.
- Actual WebKit output versus Python ONNX CPU on identical input: all **301,665** values satisfy `rtol=1e-4, atol=.002`. Maximum absolute difference .0022583 on coordinate values. Cat confidence difference ~5e-8.
- JPEG preprocessing equivalence is **not** established. WebKit and OpenCV decoded pixels differ by max31/mean1.1516. OpenCV cat score .794304 versus WebKit .743190 straddles the .787498 default. Lossless decoded pixels match exactly, score .793143 versus .794304, normalized geometry within .01. Uint8 resize rounding can differ by 1. This limitation is disclosed in-app and accepted only for experimental testing.
- Candidate mAP is worse than baseline. `candidate-tune-metrics.json` preserves original candidate metrics. No quality, safety, clear-path, or reliable-distance claim is made. Default may yield sparse results. Lowering threshold changes operating point.
- Physical camera/LiDAR/PiP/alert acceptance requires on-phone testing. Signed compilation, installation and launch alone do not establish that acceptance.

## Reproduce

```sh
node --test samples/ios/tests/*.test.mjs
swiftc -parse-as-library samples/ios/MyEyes/{APIClient,DepthEstimate,OfflineDetector}.swift samples/ios/tests/OfflineInferenceSmoke.swift -o "$SCRATCH/smoke"
# cat.jpg is the existing known 224x224 cat fixture. Optional positive PNG is cv2-decoded cat re-encoded losslessly.
"$SCRATCH/smoke" "$PWD/samples/ios/MyEyes/OfflineDetector" "$CAT_JPEG" "$CAT_LOSSLESS_PNG"
swiftc -parse-as-library samples/ios/MyEyes/{APIClient,DepthEstimate,OfflineDetector}.swift samples/ios/tests/RuntimeParity.swift -o "$SCRATCH/parity"
"$SCRATCH/parity" "$PWD/samples/ios/MyEyes/OfflineDetector" "$CAT_JPEG" "$SCRATCH/boundaries.json"
python3 samples/ios/tests/yolox-reference.py samples/ios/MyEyes/OfflineDetector/candidate.onnx "$CAT_JPEG"
python3 samples/ios/tests/verify-runtime-parity.py samples/ios/MyEyes/OfflineDetector/candidate.onnx "$CAT_JPEG" "$SCRATCH/boundaries.json"
xcodebuild -project samples/ios/MyEyes.xcodeproj -scheme Clarity -configuration Debug -destination 'id=00008130-001475E60E04001C' -derivedDataPath "$SCRATCH/v2-build" -allowProvisioningUpdates build
xcrun devicectl device install app --device 00008130-001475E60E04001C "$SCRATCH/v2-build/Build/Products/Debug-iphoneos/Clarity.app"
xcrun devicectl device process launch --device 00008130-001475E60E04001C com.dahacks.clarity.v2testing
```
Python reference uses existing NumPy, OpenCV 4.13.0 and ONNX Runtime 1.23.1. Runtime version differs from browser1.20.1, deliberately providing an independent CPU comparison. No paid compute was used for deployment.
