# Native iPhone guide for judges

## What you can access now

| Option | Access and limits |
| --- | --- |
| Public source | [Verified native source at `6f811f2`](https://github.com/AdityaDave2008/DAHacks26-AD-BW-YT-NQ-DK/tree/6f811f2ed7d964d07b1b0281ae49f054321c8088/samples/ios). Open `MyEyes.xcodeproj`, scheme **Clarity**. No missing native source or bundled model files were found in this revision. |
| Browser demo | [Open the HTTPS browser app](https://stepsense-detection.stepsense-dahacks.workers.dev/). This is a separate browser implementation, not the native app streamed to the web. Camera access requires browser permission. Browser depth is not iPhone LiDAR, and native PiP behavior does not transfer to the browser. |
| Native physical demonstration | Ask the team to demonstrate its already-installed app on its own iPhone. Identify the actual app/version before the demo, because the older StepSense baseline and **Clarity V2 Test** are different builds. No new phone installation or settings changes were performed for this audit. |
| Video fallback | A short team-recorded walkthrough is a useful backup, but no public native demo recording was verified in this audit. Record only with consent and avoid capturing bystanders or private material. A video illustrates the observed run, not general safety or accuracy. |

**Source availability is not installable distribution.** There is no verified public IPA, App Store listing, or TestFlight invitation in this guide. An unsigned build cannot simply be installed on a judge's phone. Signed device distribution requires the appropriate Apple provisioning and permissions. Do not change the team's signing settings, overwrite its installed app, or reset its preferences to make a demo work.

## Which app is in the repository?

At the audited main revision, the native source is `samples/ios/MyEyes/`, project `samples/ios/MyEyes.xcodeproj`, target/scheme/product **Clarity**, icon label **Clarity V2 Test**, and bundle identifier `com.dahacks.clarity.v2testing`.

It packages the experimental fine-tuned **YOLOX-Nano ONNX candidate** and **ONNX Runtime Web 1.20.1**. The candidate hash is `516617114420ce3c2bac545869ee91bac8ff7a63e148a73afdb12f126433fab4`. See [asset manifest](MyEyes/OfflineDetector/ASSETS.json), [provenance](MyEyes/OfflineDetector/PROVENANCE.md), and [candidate verification and limitations](../../docs/v2-testing/README.md).

The separately open original checkout at `fa44c550400060a80470c89bfd3a3f0deddee8b3` instead contains the older COCO-SSD/TensorFlow.js native implementation under the same MyEyes project path, with bundle `com.dahacks.myeyes.sample`. Its historical StepSense Xcode workspace directory contains only user-interface state, not a `project.pbxproj`. That workspace is not a missing app that needs to be copied into main. Both audited revisions have 43 tracked native files. The differing model/runtime assets represent two detector versions, not omitted files.

## Reproduce a compilation check

Requirements: macOS, Xcode with the iPhoneOS SDK, and Node.js for the native regression suite. The project declares iOS 16 as the minimum deployment target. No backend, Swift package resolution, or model download is needed for the native build.

From the repository root:

```sh
xcodebuild -list -project samples/ios/MyEyes.xcodeproj
xcodebuild -project samples/ios/MyEyes.xcodeproj -scheme Clarity \
  -configuration Debug -destination 'generic/platform=iOS' \
  -derivedDataPath "${JCODE_SCRATCH_DIR:-$HOME/Library/Caches}/clarity-unsigned" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
node --test samples/ios/tests/*.test.mjs
```

These command-line signing overrides do not edit project signing settings. Build output is outside the checkout. Do not install the resulting unsigned `.app` or present it as a distributable IPA. A simulator or unsigned compilation does not establish camera, hardware LiDAR, haptic or background behavior.

## Fresh audit evidence, October 17, 2026 UTC

- Anonymous GitHub access confirmed the repository is public. `git ls-remote` confirmed main at `6f811f2ed7d964d07b1b0281ae49f054321c8088` during the audit.
- `xcodebuild -list` reported the **Clarity** target and scheme, with Debug and Release configurations.
- Archived tracked source from main built successfully for generic iOS, Debug, with signing disabled, using Xcode **27.1 (27A9275)**. The separately archived original `fa44c55` native source also built successfully with identical unsigned options. Neither live checkout nor any phone was used as a build destination.
- Main native suite: **56 passed, 0 failed, 0 skipped**. This includes packaged model/runtime SHA-256 and byte-size checks, policy parity and native regression tests. This run is not a fresh WKWebView image-inference or physical-camera acceptance test.
- Both builds emitted only the observed AppIntents metadata-extraction warning about the absent AppIntents framework dependency. Both ended with `BUILD SUCCEEDED`.
- The public browser entry returned its page and `/ready` returned `{"ready":true,"modelState":"ready"}`. These HTTP checks alone do not prove live browser camera or detection behavior.
- No signing changes, installation, permission reset, app/settings overwrite, or physical acceptance run was performed. The original checkout remained clean.

## Suggested on-site demonstration

1. State which installed app is being shown. In a stationary, controlled scene, start scanning and show camera preview, detector state and supported objects. Do not use the prototype to navigate traffic or hazards.
2. Show a known object and explain confirmation, cooldown, sparse results and possible missed detections. The candidate mAP is worse than baseline, so do not claim improved accuracy. The default threshold is approximately 0.7875, and JPEG preprocessing equivalence is not established.
3. If supported and already configured, show optional LiDAR readouts. They are approximate axial surface depth, not nearest-object clearance or collision prediction. Reference-distance accuracy and object association still require physical validation.
4. Demonstrate PiP only if it actually works on that device. Background inference and alerts are not guaranteed. Old/failed results must not be described as a clear path.
5. Stop scanning. Use the browser URL or an explicitly labeled recording if the device demonstration is unavailable.

The prototype can miss hazards. No detection result, empty scene, successful build, or demonstration proves that travel is safe.
