# iOS repair verification, October 17, 2026

## Changes and scope

The repair starts from fetched main `cda3b5e`. It does not replace model weights, inflate confidence, alter signing or claim to fix all real-world recognition errors.

- **Independent LiDAR center reading:** sensor observations no longer wait for model startup or a requested inference frame. Delivery is capped at ten starts/second with one outstanding callback. It carries a scalar measurement, not uploaded images. Start/stop/interruption boundaries and the existing 0.75-second expiry reject old samples.
- **Object depth stays conservative:** object labels still require the original synchronized RGB/depth pair and a fresh validated ROI. The independent center reading is not substituted for object distance. Missing, mixed or stale depth remains unavailable.
- **LiDAR fallback retry:** a subsequent explicit Start retries depth setup after RGB fallback instead of indefinitely caching a transient configuration failure.
- **Detector recovery:** destroyed/timed-out WebKit receives at most two reload attempts between healthy fresh frames. Background/camera interruption defers recovery without consuming attempts. Foreground resume uses the same capture session. Stop and generation fencing prevent stale restart results from appearing.
- **App icon:** the existing footprints artwork is packaged as the native AppIcon asset. This does not update an already-installed phone until a newly signed build is installed.

## Observed checks

| Requirement | Check and observed result | Limit |
| --- | --- | --- |
| Native runtime recovery | Actual production WKWebView bridge/model was forced into its real 15-second timeout, then the production recovery helper reloaded it and completed 120 fresh fixture inferences. Existing stale, malformed input, cancellation, single-flight and network-block checks passed. | Executed on macOS WebKit with a known fixture, not an iPhone camera. |
| Bounded recovery and suspension | Executable Swift regressions cover persistent failure, healthy-frame budget reset, cancellation, and suspension before/during backoff and after successful load. | Orchestration source guards supplement the executable helper tests. Full physical scene transitions remain unverified. |
| Independent sensor validity | Executable Swift tests cover throttle/backpressure, old completion tokens, invalid/future/stale samples, pause boundary, and unchanged object-depth expiry. | Synthetic depth maps do not establish physical LiDAR calibration or object association. |
| Icon integration | Tests inspect the built app Assets.car, generated icon declarations and icon PNG resources. | Home-screen appearance on the judging phone is not yet observed. |
| Native compilation/regressions | Unsigned generic-iOS Debug build succeeded. Native suite: 65 passed, zero failed/skipped, with actual built-app icon validation enabled. | Unsigned builds are not installable iPhone IPAs. |
| Web compatibility | Current production browser model workflow passed locally and on the existing HTTPS preview after redeployment: exact `sw.js`/detector/logic parity, v11 cache migration, actual COCO inference, Start/Stop/restart, no uploads and fresh offline inference. Preview version: `182af37b-3703-42e2-8108-52e55112259e`. | Chrome with synthetic camera input, not physical iPhone/Safari acceptance. |

The open Xcode workspace on the development Mac still pointed to the older checkout's `StepSense.xcodeproj/project.xcworkspace`, not this checkout's repaired `samples/ios/MyEyes.xcodeproj`. The tool environment blocked automatically opening the repaired project. Open the correct project explicitly and select scheme **Clarity** before building for the phone. Do not assume a build in the old workspace contains these repairs.

Local validation logs are retained under `$HOME/.jcode/scratch/ios-repair-20261017/`; browser logs under `$HOME/.jcode/scratch/alert-browser-audit/`. These local paths are not public downloadable artifacts.

## Remaining acceptance and limitations

At the latest device check, both remembered physical Pro iPhones were **unavailable** to Xcode. No phone was installed, launched, paired, or remotely reconfigured. Follow [wireless testing](WIRELESS_TESTING.md), identify the installed build, and use a stationary controlled scene to verify distance against a reference, sustained inference, interruption/recovery, alerts and the icon. A simulator cannot establish LiDAR behavior.

The experimental native model remains unchanged and is known to underperform the retained evaluation baseline. Potholes are not a supported class. Shadow/person false positives and field accuracy remain unresolved; see [issue #39](https://github.com/AdityaDave2008/DAHacks26-AD-BW-YT-NQ-DK/issues/39). Do not use this prototype as proof that a path is safe.

The app currently uses in-process audio, speech and haptics. It has no approved Apple Critical Alerts entitlement or notification authorization, so this repair does not claim Critical Alerts/Focus bypass. Existing confidence, confirmation and repeat-cooldown safeguards remain in place.

Requested separately, not implemented here:
- [#37: Load the model before camera initialization](https://github.com/AdityaDave2008/DAHacks26-AD-BW-YT-NQ-DK/issues/37).
- [#38: Distance-scaled selected alerts and accessible box colors](https://github.com/AdityaDave2008/DAHacks26-AD-BW-YT-NQ-DK/issues/38).
