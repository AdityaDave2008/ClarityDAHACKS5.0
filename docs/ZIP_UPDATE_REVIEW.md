> Historical reference selectively preserved from `origin/feature/iphone-pip-test` (`8203fdb`). Descriptions and verification claims below refer to that branch at the time of writing, not acceptance results for the current app. Proposed features are not necessarily implemented.

# Supplied ZIP update review

Reviewed `DAHacks26-AD-BW-YT-NQ-DK-main (1).zip` on October 16, 2026. Comparison with the active working tree found 57 identical files, 31 differing files, and 46 files not present locally. File differences alone do not establish recency; changes were reviewed by behavior and dependencies.

## Integrated

- The complete native iPhone source/resource/project/test bundle: offline COCO-SSD inference using packaged TensorFlow.js/WASM and five model shards; a new network-independent camera startup and clearly labeled preview-only fallback.
- The archive's more developed PiP implementation with detection overlays, controller readiness handling, frame display recovery, dismissal handling, and opt-in diagnostics. This supersedes the smaller native PiP prototype previously added locally. Background analysis remains subject to iOS/WebKit suspension and is not guaranteed.
- Camera interruption recovery, capture-generation guards, stale-result expiry, and frame-loop watchdogs.
- Optional synchronized LiDAR capture, calibrated-depth validity checks, and preference migration with LiDAR off by default. Non-LiDAR iPhones still use RGB object detection; this does not give them measured LiDAR distances.
- Model provenance, hashes and upstream Apache-2.0 notices. Existing browser MediaPipe/ByteTrack/depth attributions are retained alongside these additions.

Two integration fixes were made: camera permission copy now describes offline processing, and native test paths use `fileURLToPath` so Windows can read them correctly. Xcode signing remains a per-developer setting; the archive's team ID is not copied into the shared project.

## Retained or excluded

The active browser's simple layout, first-run setup, saved preferences, immediate color-vision palettes, on-device MediaPipe/tracking and optional depth remain intact. The ZIP's browser HTML/CSS and replacement camera modules belong to a different browser architecture; copying them over would discard these changes. Its standalone overlay test targets that other architecture and was not copied as a disconnected test.

Identical backend files, Android code and duplicate assets were left alone. The Android wrapper difference only moves the same SHA-256 line; it does not update Gradle. Historical release notes and proposed implementation plans were read as reference, not executed or treated as new instructions.

## Verification

On Windows, all 48 runnable native tests pass, including model-file SHA-256 checks and alert-policy equivalence. Two Swift execution tests require macOS and are skipped locally. Many native tests inspect source wiring; passing them does not establish real-device camera, LiDAR or PiP performance. The archive's reported Mac builds/device sessions are historical claims, not independently repeated here.

The separate `feature/iphone-pip-test` branch is used for GitHub native testing. Its macOS workflow builds the iOS simulator app and runs all native tests, including the two Swift execution checks. Physical-iPhone signing and behavior checks remain necessary.
