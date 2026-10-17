# Optional LiDAR Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Add conservative optional offline axial-depth labels with a persisted default-off toggle.

**Architecture:** Keep the existing AVFoundation session and detector. Pair RGB/depth with AVCaptureDataOutputSynchronizer and carry an immutable copied depth snapshot through single-flight inference. Estimate with a platform-independent Swift component and expire independently.

**Tech Stack:** Swift, AVFoundation, SwiftUI, existing WKWebView COCO-SSD, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-16-lidar-depth-design.md`

## Global Constraints
- Default OFF, Stop-first capture mode changes, iOS 16 minimum, no ARSession.
- Offline, no camera image recording, preserve detector policy and PiP support checks.
- Axial depth, never radial range or safety. Reject missing/stale/unreliable data.

### Task 1: Testable depth and preferences
Files: create `samples/ios/StepSense/DepthEstimate.swift`, `samples/ios/tests/DepthEstimateTests.swift`, `samples/ios/tests/lidar-depth.test.mjs`; modify `APIClient.swift`.
Interfaces: `DepthSnapshot(width:height:meters:capturedAt:)`; `estimate(in:now:) -> Double?`; `ScanPreferences.isLidarEnabled -> Bool`; `Detection.depthMeters: Double?`.
- [x] Add a Swift executable test compiled by Node with APIClient and DepthEstimate. Cases: constant 2 m returns 2, mixed 1/4 m unavailable, NaNs unavailable, stale/future time unavailable, tiny/out-of-bounds boxes unavailable, corner ROI mapping, old preference JSON defaults false, enabled preference round-trip true.
- [x] Run `node --test samples/ios/tests/lidar-depth.test.mjs`, observe missing implementation failure.
- [x] Implement finite/range/coverage/spread rejection and pure defaults. Example acceptance: `precondition(snapshot.estimate(in: box, now: 10.1) == 2)`.
- [x] Repeat tests and commit only new test/component/model files.

### Task 2: Synchronized capture
Files: modify `CameraCapture.swift`; create `LiDARCapture.swift`; register both new sources in `StepSense.xcodeproj/project.pbxproj`.
Interfaces: `CapturedFrame.depth: DepthSnapshot?`; `CameraCapture.start(lidarEnabled:onFrame:onPreview:onInterruption:onFailure:)`; diagnostics `depthStatus: String`.
- [x] Add structural assertions for synchronization, dropped-data guards, unfiltered data, paired snapshot, orientation, calibration and clock conversion.
- [x] Run tests to observe missing wiring failures.
- [x] Implement configuration and safe teardown/reconfigure while stopped, fallback wide camera on unsupported LiDAR format, timestamp/quality gates and bounded snapshot copying. Existing preview callback remains independent of valid depth.
- [x] Compile signed device build using `xcodebuild -project samples/ios/StepSense.xcodeproj -scheme StepSense -configuration Debug -destination id=00008130-001475E60E04001C -derivedDataPath "$JCODE_SCRATCH_DIR/stepsense-lidar" build`.

### Task 3: Settings, estimates and labels
Files: modify `ScanModel.swift`, `ScannerView.swift`, `PictureInPicture.swift`, and `samples/ios/README.md`.
- [x] Add tests for default-off persistence, active-mode rejection, Settings disabled while busy/applying, and depth expiry independent of boxes.
- [x] Wire `camera.start(lidarEnabled: preferences.isLidarEnabled, ...)`; estimate only exact frame snapshots and matching sequence/dimensions. Leave alert result untouched.
- [x] Add Stop-first Settings toggle and status. Show `depth ~N.N m` or `depth unavailable` only when requested. Add optional PiP text from the same detection value.
- [x] Expire distance values at capture time + 0.75 seconds and clear the timer on interruption/stop/preferences changes.
- [x] Document axial semantics, limitations, SDK geometry contract, tests and device checklist.

### Task 4: Regression and physical deployment
- [x] Run `node --test samples/ios/tests/*.test.mjs` and `npm --prefix backend test`.
- [x] Run the existing production OfflineInferenceSmoke against the existing licensed fixture if available. Report unavailable fixture rather than substituting mocks.
- [x] Review diff and signed build, fix verified defects, rerun affected tests.
- [x] Install with `xcrun devicectl device install app --device 00008130-001475E60E04001C "$JCODE_SCRATCH_DIR/stepsense-lidar/Build/Products/Debug-iphoneos/StepSense.app"`.
- [x] Report device acceptance separately, list observed build/install and unverified physical checks, make scoped commits.

## Completion evidence

Native suite 42/42, backend suite 27/27, and real WKWebView inference smoke passed. Signed device build and installation succeeded. Final launch was blocked by the phone's locked state; an earlier feature build launched successfully. Physical LiDAR reference-distance and PiP acceptance is explicitly pending, not replaced by synthetic tests. See samples/ios/README.md for the full observed-results checklist and rollback artifact.
