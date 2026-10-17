# Shared-LiDAR Automatic Floor Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in experimental, automatically tilt-gated raised-floor geometry using the existing matched LiDAR stream without weakening ordinary object depth, sensor independence, or #38 feedback policy.

**Architecture:** Keep calibration mathematics, motion history/gating, plane fitting, clustering, and source coordination pure and executable on macOS. A thin AVFoundation/CoreMotion adapter supplies immutable, calibrated snapshots to one bounded floor worker independently of neural inference and the existing center sensor. ScanModel merges fresh source-owned observations into the existing proximity policy and selected-alert scheduler, while both overlays expose source and capability status honestly.

**Tech Stack:** Swift/Foundation/SIMD, AVFoundation/AVDepthData, CoreMotion, existing SwiftUI/PiP, existing Node-driven `swiftc` executable tests and Xcode project. No added package or service.

**Spec:** `docs/superpowers/specs/2026-10-17-shared-lidar-floor-mode-design.md` on `origin/feat/shared-lidar-floor-mode`, inspected at `3c5726f754d1bf12ca8ddd4c9c8e26d503dc5178`. Read with `git show`, not checkout. User explicitly authorizes planning for #40. The spec is copied alongside this plan with only its status updated to approval19:20 as requested by root. Approval is not a claim that implementation or phone validation exists.

## Global Constraints

The following are copied requirements from the spec. All tasks inherit them.

- “Reuse AVFoundation + AVDepthData + the current RGB/depth synchronizer.”
- “Do not create a second camera session or migrate capture to ARKit.”
- “Initially expose **Automatic floor mode (experimental)** as an opt-in native setting.”
- “Existing model-first startup remains unchanged: fully initialize the bundled detector before camera construction/access.”
- “Store at most one second of timestamped gravity/rotation-rate samples in memory; no telemetry or recording.”
- “Existing object-ROI estimates continue when floor-specific calibration is unavailable. Never tighten or weaken their existing acceptance gates accidentally.”
- “Deliver the same matched snapshot to a separate single-flight floor-analysis lane, capped at 5 Hz.”
- “No frame queue, extra JPEG encoding, second capture session, concurrent geometric jobs or dependence on neural inference completion.”
- “Invalid/stale motion immediately disables geometric output rather than preserving the last tilt.”
- “Choose the closest motion sample within 50 ms of the matched depth capture time.”
- “Unknown rotation, crop, mirroring or absent required calibration produces `floor unavailable`, not a guessed transform.”
- “Bound computation to at most 4096 valid sampled points in the lower/central view.”
- “Only finite absolute 0.2–5 m returns are eligible. No interpolation across missing-depth holes.”
- “Fit a deterministic robust candidate plane using at most 64 hypotheses, with its normal within 15° of gravity-up.”
- “Candidate geometry and plane support must persist across distinct fresh frames.”
- “Missing floor/motion/calibration immediately clears geometric boxes and output eligibility.”
- “No geometry feedback survives stale depth or a stopped session.”
- “Do not change the browser's unknown-distance behavior.”
- “Retain the feature as experimental/opt-in and the PR as draft if the physical phone or necessary calibration is unavailable.”
- “No ARKit migration, training job, paid resource, critical-alert entitlement, web depth model, camera/signing reset, unsafe walking trial, universal obstacle guarantee or silent reinterpretation of unknown depth as safe space.”

Additional exact numeric requirements: entry ≥45° for 300 ms, exit ≤35° for 300 ms; reject rotation >0.8 rad/s or user acceleration >0.2 g; plane ≥300 points, ≥60% support, ≥6 cells of a 3×3 grid, horizontal span ≥0.35, vertical span ≥0.30; inlier distance ≤0.025 m + 0.01 × axial depth, median absolute residual ≤0.03 m; competing admissible plane ≥80% best support with offset difference ≥0.15 m rejects the frame; camera-plane distance 0.3–2 m; raised height ≥max(0.08 m, twice residual spread); ≥8 samples with ≥0.04 m extent in two axes; 8-neighbor sampled-grid connectivity and neighbor distance ≤0.15 m + 0.05 × axial depth; expiry at capture +0.75 s; #38 requires two distinct fresh in-zone observations, closer-band immediacy after confirmation and existing retreat hysteresis/selected-channel rate bounds. These are prototype engineering thresholds, not safety-certified limits.

---

## Scope, inspected baseline and non-negotiable seams

Work in `/Users/yashthakur/github/deanza-hacks-5.0/DAHacks26-AD-BW-YT-NQ-DK`, the actual shared repository. Parent directory is another repository and does not contain the remote spec reference. Inspected shared baseline: branch `main`, `d6c34a2`. Do not switch branches or reset other workers' changes. Only this plan and the exact approved spec copy with its status updated are authorized in this planning pass. No build/test execution or implementation is part of this pass.

Exact existing seams inspected:

- `LiDARCapture.configure(in: AVCaptureSession) throws -> (AVCaptureVideoDataOutput, AVCaptureDepthDataOutput)` configures both connections portrait/unmirrored, disables filtering and stabilization, selects unit zoom and matched aspect formats.
- `LiDARCapture.snapshot(_: AVDepthData, rgb: CVPixelBuffer, capturedAt: TimeInterval, onRejection: (String) -> Void = { _ in }) -> DepthSnapshot?` already rejects absent basic calibration, relative accuracy, low quality, filtering, invalid focal lengths/time, invalid map size/aspect. It copies Float32 rows once and discards calibration. **Keep those existing rejection gates exactly.** Optional new floor calibration can fail without failing an otherwise accepted object snapshot.
- `DepthSnapshot(width:height:meters:capturedAt:)`, `estimate(in:now:onRejection:)`, `centerSurface(now:onRejection:)`, `DepthSnapshot.maximumAge == 0.75`, and `Detection.addingDepth(from:enabled:matchingFrame:now:onRejection:)` are existing contracts. Preserve initializer call sites via a defaulted new parameter, not a required new argument.
- `DepthFrameMatch.select(depthTime:currentRGBTime:previousRGBTime:)` matches current/one previous RGB within 1 ms and rejects previous-frame retention ≥0.1 s. Neither tolerance changes. Current RGB always feeds PiP; matched RGB feeds neural JPEG/depth.
- `CameraCapture.start(lidarEnabled:onFrame:onPreview:onDepthSample:onInterruption:onFailure:)` delivers `CapturedFrame` and a separate async `CenterDepthSample`. `process` currently copies one snapshot only when neural or center delivery reserves work. Extend this admission OR with floor reservation, not the neural request path. `CenterDepthDeliveryGate` remains independent at 10 Hz.
- `process` converts synchronized camera time via `CMSyncConvertTime(..., to: CMClockGetHostTimeClock())`, computes host-clock age, then `now - age` in system uptime. **Keep this conversion.** Motion timestamps are compared to the resulting `DepthSnapshot.capturedAt`, not JPEG completion, callback wall clock or raw CMTime seconds.
- `ScanModel` currently overwrites `detections` on neural completion and calls `clearDisplayedResult()` on neural error/staleness/expiry. Floor support requires source-specific clears and source-specific expiration. `phase == .scanning` is currently a neural gate, not a valid floor capability gate. `reloadDetector`'s “Preview only / No obstacle alerts” text becomes false when floor still works.
- `Detection.confidence` is currently nonoptional `Double`. The only production Swift arithmetic uses found were `ScannerView` percentage and `ProximityPolicy` ordering. Prefer a genuinely absent geometry confidence, not 0%, 100% or plane fit masquerading as model confidence.
- Xcode source registration is explicit `PBXBuildFile`/`PBXFileReference`/group/sources entries. It is not folder-synchronized. Existing Node harnesses compile explicit production Swift lists, so adding a type dependency requires updating their compile lists too.

## Apple calibration evidence and blocking decision

Inspected installed Xcode 27.1 (27A9275), iPhoneOS SDK 27.1:

`/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS.sdk/System/Library/Frameworks/AVFoundation.framework/Headers/AVCameraCalibrationData.h`

- Intrinsic columns encode `[[fx,0,cx],[0,fy,cy],[0,0,1]]`; origin is upper left, values refer to `intrinsicMatrixReferenceDimensions`.
- Tables are NSData containing Float32 relative radial magnifications, evenly spaced from distortion center to farthest image corner. `point + magnification * (point-center)` is the mapping, not adding a radius in meters. Use linear table interpolation and the last entry outside the maximum radius exactly as the reference does.
- Reference implementation lines 121–124: **distorted point → undistorted point uses `inverseLensDistortionLookupTable`**; undistorted point → distorted point uses `lensDistortionLookupTable`. Image pull-resampling direction explains the apparently contradictory property prose.

`AVDepthData.h` lines 117–129: Objective-C `depthDataByApplyingExifOrientation:` (Swift `applyingExifOrientation(_:)`) applies orientation to **both** map and calibration. Lines 65–71 explain that depth is distorted to accompany RGB and must be rectified for 3D.

**Blocking proof, not an aspect-ratio guess:** connection portrait, unit zoom, equal aspect and canonical K are necessary but not sufficient to invent a reference orientation/crop. The adapter must document why calibration delivered by the selected AVFoundation pipeline is in the same delivered portrait coordinate space, with the relevant Apple contract and a real metadata/known-pose check. Store explicit provenance. Do not “fix” a landscape reference by silently swapping dimensions or rotating K a second time. If that contract cannot be established, return `calibrationUnavailable("unproven delivered transform")` and keep ordinary LiDAR/object depth working. A synthetic round trip alone does not prove sensor alignment. Root must accept this blocker before enabling real geometry on a phone.

## File ownership and execution graph

All paths below are repository-relative. Let `S = samples/ios/MyEyes` and `T = samples/ios/tests`; names prefixed by S/T below expand to those exact directories.

| Owner | Exclusive files | Responsibility |
|---|---|---|
| Pure geometry worker | Create `S/FloorCalibration.swift`, `S/FloorGeometry.swift`, `T/FloorCalibrationTests.swift`, `T/FloorGeometryTests.swift`, `T/FloorTestFixtures.swift`, `T/floor-calibration.test.mjs`, `T/floor-geometry.test.mjs` | Validated point mappings, bounded plane/clusters, synthetic executable fixtures |
| Motion/capture worker | Create `S/FloorMotion.swift`, `S/FloorMotionProvider.swift`, `S/FloorAnalysisLane.swift`, `S/FloorAnalysisWorker.swift`, `T/FloorMotionTests.swift`, `T/FloorDeliveryTests.swift`, `T/floor-motion.test.mjs`, `T/floor-delivery.test.mjs`; modify `S/LiDARCapture.swift`, `S/CameraCapture.swift`, `S/DepthEstimate.swift` | Calibration copy only, one snapshot/floor reservation, bounded CoreMotion, lifecycle invalidation |
| Root/integration owner | Create `S/FloorDetectionCoordinator.swift`, `T/FloorCoordinatorTests.swift`, `T/floor-coordinator.test.mjs`; modify `S/APIClient.swift`, `S/ScanModel.swift`, `S/ProximityPolicy.swift`, `S/PictureInPicture.swift`, `samples/ios/MyEyes.xcodeproj/project.pbxproj`, `.github/workflows/ios-pip.yml`, `samples/ios/REPAIR_VERIFICATION.md`; modify `T/DepthEstimateTests.swift` and narrowly update existing `T/*.test.mjs` Swift source lists | Shared data/source contracts, merging, policy and PiP, project/CI registration |
| Existing UI worker only | `S/ScannerView.swift`, `S/MyEyesApp.swift`, `T/clarity-ui.test.mjs`; add `T/floor-ui.test.mjs` if desired | Setting, persistent mode and source labels using agreed interfaces; coordinate overlapping current UI work |
| Existing detector scout | Read-only, no implementation ownership | Review generic fallback and neural startup/recovery assumptions |

`CenterDepthSensor.swift`, `OfflineDetector.swift`, model assets/runtime, browser/backend alert code and `AlertPlayer.swift` should not need changes. If a real blocker requires them, stop and reassign ownership explicitly rather than silently expanding scope. Root owns all shared project registration and test-list edits, avoiding concurrent PBX edits. Root must provide the source/geometry interfaces below before workers compile together. Geometry and motion work can run independently after interface approval. Capture depends on calibration+motion. Coordinator can be tested with synthetic candidates before capture. UI integrates only after root publishes its stable interface, not by editing the UI worker's files.

## Explicit data interfaces (declarations for planned code, not delivered implementation)

Use Foundation and standard-library SIMD in pure files. No AVFoundation, CoreMotion, SwiftUI, CVPixelBuffer or CMDeviceMotion crosses a pure boundary. Add `Sendable` to `NormalizedPoint`, `NormalizedBox`, `Detection`, and their stored enums as needed, using checked conformance, not unchecked escapes.

### Calibration and snapshot

`FloorCalibration.swift` defines these value types and signatures:

```swift
enum FloorCalibrationError: Error, Equatable, Sendable {
    case unavailable(String), invalidIntrinsics, invalidTable, invalidTransform
}
struct FloorImageMapping: Sendable {
    let referenceWidth: Double
    let referenceHeight: Double
    let deliveredWidth: Int
    let deliveredHeight: Int
    let portrait: Bool
    let mirrored: Bool
    let sameAspectNoCropVerified: Bool
    let calibrationAlreadyOriented: Bool
    // No free-form rotation angle and no inferred model-specific correction.
}
struct FloorCalibration: Sendable {
    let fx: Double; let fy: Double; let cx: Double; let cy: Double
    let center: SIMD2<Double>
    let forward: [Float]
    let inverse: [Float]
    let mapping: FloorImageMapping
    static func validated(intrinsicColumns: [SIMD3<Double>],
                          center: SIMD2<Double>, forward: [Float], inverse: [Float],
                          mapping: FloorImageMapping) throws -> FloorCalibration
    func referencePoint(delivered: SIMD2<Double>) -> SIMD2<Double>
    func deliveredPoint(reference: SIMD2<Double>) -> SIMD2<Double>
    func undistort(_ distortedReference: SIMD2<Double>) -> SIMD2<Double>
    func distort(_ rectilinearReference: SIMD2<Double>) -> SIMD2<Double>
    func unproject(x: Int, y: Int, axialZ: Double) -> SIMD3<Double>?
}
```

`DepthSnapshot` gains `let floorCalibration: FloorCalibration?` and `let floorCalibrationReason: String?`. Define an explicit initializer preserving `width:height:meters:capturedAt:` and defaulting both new arguments to nil. Arrays remain immutable Swift COW buffers, never mutate or duplicate `meters` to dispatch a lane. Basic calibration absence continues to reject the whole snapshot exactly as today. Absent distortion metadata only rejects floor calibration.

Capture-side new value `FloorCaptureGeometry` in `LiDARCapture.swift`: `portrait: Bool`, `mirrored: Bool`, `sameAspectNoCropVerified: Bool`, `calibrationAlreadyOriented: Bool`, all required initializer arguments. Extend `snapshot` with `floorGeometry: FloorCaptureGeometry? = nil` before the trailing rejection closure. Derive it from configured/delivered connection state plus the documented calibration provenance, not hard-coded `true` flags. Optional absent context means object snapshot succeeds with unavailable floor metadata. NSData parsing checks byte alignment/multiple-of-four, count 2...4096, finite entries, and `1 + entry > 0`; copy via safe unaligned loads if necessary. Canonical K off-diagonal/last-row tolerance 1e-6, principal point and distortion center within `[0, reference width/height]`, finite positive focal/dimensions; same-aspect tolerance 0.001 and positive portrait dimensions. These explicit tolerances are implementation defaults for root review, not new sensor guarantees.

Pixel centers are `(Double(x)+0.5, Double(y)+0.5)` in a continuous top-left image frame. Scaling to reference multiplies by reference/delivered dimensions; inverse scaling reverses it. Rectify with inverse table before `((u-cx)/fx * z, (v-cy)/fy * z, z)`. Do not resample/interpolate depth. Already-adjusted portrait calibration uses identity orientation plus scaling, not `applyingExifOrientation(.right)` again. Pure rotation round-trip tests may exercise explicit 90° transforms of coordinate fixtures, but unknown or mirrored runtime mappings are rejected for this version.

### Motion, gate and floor results

```swift
struct FloorMotionSample: Sendable {
    let capturedAt: TimeInterval // CMDeviceMotion.timestamp, seconds since boot
    let gravity: SIMD3<Double>  // device axes, g
    let rotationRate: SIMD3<Double> // radians/sec
    let userAcceleration: SIMD3<Double> // g
}
struct FloorMotionHistory {
    mutating func append(_ sample: FloorMotionSample, now: TimeInterval)
    func nearest(to capturedAt: TimeInterval, now: TimeInterval) -> FloorMotionSample?
    mutating func reset()
    var count: Int { get }
}
enum FloorModeStatus: Equatable, Sendable {
    case normal, confirming, active, unavailable(String)
    var text: String { get }
}
struct FloorModeGate {
    mutating func update(sample: FloorMotionSample?, capturedAt: TimeInterval,
                         now: TimeInterval, enabled: Bool) -> FloorModeStatus
    mutating func reset()
}
struct FloorCandidate: Sendable {
    let bbox: NormalizedBox // original distorted-map coordinates, normalized
    let axialDepth: Double // median axial Z of cluster, never ROI estimate
    let capturedAt: TimeInterval
    let sampleCount: Int
    let heightMeters: Double // median signed above-plane height, not confidence
}
struct FloorPlane: Sendable {
    let normal: SIMD3<Double> // oriented gravity-up
    let offset: Double // n dot p + offset = 0; positive below-camera floor
    let medianResidual: Double
    let residualSpread: Double // 1.4826 * MAD of signed inlier residuals
    let supportCount: Int
}
struct FloorAnalysis: Sendable {
    let capturedAt: TimeInterval
    let plane: FloorPlane?
    let candidates: [FloorCandidate]
    let unavailableReason: String? // nil with valid empty floor, never "clear passage"
}
enum FloorGeometry {
    static func analyze(snapshot: DepthSnapshot, gravityCamera: SIMD3<Double>,
                        now: TimeInterval) -> FloorAnalysis
}
```

`FloorMotionHistory` owns at most 1.0 s and 101 samples at requested 100 Hz (hard cap holds even if callback cadence exceeds request). Reject nonmonotonic/duplicate timestamps, future samples beyond `now`, nonfinite values, gravity norm outside 0.95...1.05. No interpolation/extrapolation. On backward clock or malformed fresh sample clear history and mark unavailable. `nearest` also checks snapshot age in `[0,0.75)`, sample age ≤1.0, absolute timestamp skew ≤0.050, norm and motion thresholds. Equal-distance ties choose earlier sample. Future relative to capture is allowed within 50 ms, but future relative to current uptime is not. These are different tests.

`FloorModeGate` uses capture timestamps, not number of callbacks: repeated capture cannot accumulate dwell. Require valid consecutive samples/frames throughout dwell, resetting a pending dwell on a timestamp gap >0.1 s or invalid sample; active state invalidates immediately on missing/stale motion. Camera gravity `(device.x, -device.y, -device.z)` and tilt `asin(-device.z)` in degrees. Normalize only after unit validation. Entry/exit 300 ms dwell and 45°/35° hysteresis; the hysteresis band retains active state and cancels pending exit/entry as applicable. Floor processing at 5 Hz cannot itself establish 100 ms continuity; gate dwell must consume the 100 Hz validated motion stream, and capture queries its state plus the closest sample. Implement `FloorModeGate.update` on the motion provider queue for each sample (`capturedAt = sample.capturedAt`) and validate its status again when reserving a frame. Do not count five-Hz gaps as motion discontinuities.

`FloorMotionProvider` is platform-only with `start()`, `stop()`, `state(for capturedAt: TimeInterval, now: TimeInterval) -> (FloorModeStatus, FloorMotionSample?)`. Own one `CMMotionManager`, serial OperationQueue, bounded history and gate under one lock. Use `startDeviceMotionUpdates(using: .xArbitraryZVertical, to:withHandler:)`, `deviceMotionUpdateInterval = 0.01`, `isDeviceMotionAvailable`, `stopDeviceMotionUpdates()`. Unavailable capability or callback error yields unavailable and empty history. This API has no invented camera-style motion authorization request; handle actual capability/error and any denied-service behavior. No sensor samples logged/persisted. Keep the gate status alongside each retained motion sample (same 101-entry/one-second bound), so `state(for:now:)` returns status at the matched sample, not a newer active state retroactively applied to an older depth frame. Current invalidation still overrides that historical status. A lightweight 50 ms freshness watchdog invalidates if motion callbacks cease; it never extrapolates gravity.

### Single-flight delivery and source coordinator

```swift
struct FloorDeliveryGate {
    mutating func reserve(now: TimeInterval) -> UUID?
    mutating func complete(_ token: UUID)
    mutating func reset()
}
struct FloorCaptureInput: Sendable {
    let snapshot: DepthSnapshot?
    let capturedAt: TimeInterval
    let diagnostic: String
    let epoch: UUID
    let revision: UInt64 // monotonic floor invalidation generation within this run
}
struct FloorLaneOutput: Sendable {
    let epoch: UUID
    let revision: UInt64
    let mode: FloorModeStatus
    let analysis: FloorAnalysis?
}
enum DetectionSource: String, Sendable { case neural, floor }
struct FloorDetectionCoordinator {
    mutating func reset(epoch: UUID, notBefore: TimeInterval)
    mutating func acceptNeural(_ detections: [Detection], capturedAt: TimeInterval,
                              epoch: UUID, now: TimeInterval)
    mutating func acceptFloor(_ output: FloorLaneOutput, zone: [NormalizedPoint],
                             now: TimeInterval)
    mutating func invalidate(_ source: DetectionSource)
    mutating func expire(now: TimeInterval)
    func observations(now: TimeInterval) -> [Detection]
    func policyObservations(now: TimeInterval) -> [Detection]
}
```

Extend `CameraCapture.start` with defaulted `floorEnabled: Bool = false`, `floorEpoch: UUID = UUID()` and `onFloor: @escaping @Sendable (FloorLaneOutput) async -> Void = { _ in }`. `FloorAnalysisWorker` owns motion provider and one serial worker, methods `start(epoch: UUID)`, `stop()`, `submit(_ input: FloorCaptureInput, completion: @escaping @Sendable (FloorLaneOutput) async -> Void)`, `invalidate(reason: String)`. ScanModel passes its current generation as `floorEpoch`; do not confuse that public run identity with CameraCapture's separate private captureToken. Admission reservation is on frameQueue **before** copying/scheduling. `submit` is only called with an acquired reservation. Complete reservation only after geometry and async consumer return, including rejection/cancellation. No second worker or queued pending frame. A token from an old epoch cannot release a new reservation.

Immediate invalidation must not wait behind a busy geometry job or the 200 ms admission cadence: maintain a tiny epoch/revision and invalidation-status channel. Motion error, dropped/missing depth, invalid calibration, interruption, stop or background invalidates floor generation immediately, clears coordinator floor observations on MainActor and makes in-flight output ineligible. Increment `revision` on each distinct invalidation, tag every reserved job with the current revision, and accept only the newest revision at publication. An old completion must not be relabeled with a new revision. The coordinator records the largest seen revision for its run and drops older output. Only scalar status/epoch/revision crosses that path, no geometry work or retained frame queue. Coalesce repeated identical invalidations to one pending status delivery. New valid work resumes after the old job finishes, never simultaneously. Lifecycle invalidation must not call the center sensor's reset except in already-existing shared stop/interruption cleanup.

Root adds `Detection.source` native-only default `.neural`, excluded from JSON CodingKeys, and changes `confidence` to `Double?`. Explicit Decodable implementation requires a finite `Double` for incoming neural confidence and always sets source `.neural`; geometry is created locally with `confidence: nil`, exact label **Unclassified floor obstacle**, `.floor`, depthRequested true, expiry `capturedAt + 0.75`. Preserve all existing optional depth decoding and never decode native policy/source fields. Existing memberwise-style construction needs an explicit initializer with defaults for local fields if a custom initializer removes synthesis. `ProximityPolicy` uses source as association/ordering key and `confidence ?? -1` only as an internal total-order tie-breaker, never as probability. No confidence-slider filtering for geometry.

`ScanPreferences` gets private optional `automaticFloorModeEnabled`, public get/set `isAutomaticFloorModeEnabled` default false, preserving old JSON decoding and explicit false. Effective floor capture requires BOTH this opt-in and `isLidarEnabled`; do not override a user's LiDAR-off setting. Changing either capture setting requires Stop, including `cameraStopping`. UI explains the dependency instead of silently enabling LiDAR.

Public UI contract: `ScanModel.floorModeStatus: FloorModeStatus` published private(set), `ScanPreferences.isAutomaticFloorModeEnabled`, and `Detection.confidence: Double?`/`source`. `FloorModeStatus.text` is exactly `Normal scan`, `Confirming floor`, `Floor mode`, or `Floor unavailable · <reason>`. Main and PiP source label is `Unclassified floor obstacle` with geometry/axial-depth text, no `%`; neural label keeps actual model confidence. Mode/status persists even with no candidates.

## Executable verification conventions

Use the existing `node:test` → `swiftc -parse-as-library` → executable pattern, scratch under `$JCODE_SCRATCH_DIR` or `~/.jcode/scratch`. New suites compile **production source**, not copied algorithms or mock replacements. A minimal new runner takes the existing `lidar-depth.test.mjs` structure, replaces the source list with the task list below, invokes its named Swift `@main` test file, asserts compiler/run exit status zero and the explicit success string. Do not assert only that source text contains a keyword.

For each task: write assertions first; run the named Node test and record the expected absent-symbol/assertion failure; implement the smallest production change; rerun until green; run stated regressions; commit only the task-owned paths. Individual checklist actions are intended as 2–5 minute units. When a fixture matrix takes longer, run its rows separately with a CLI case argument on the same Swift executable. The plan is not permission to skip unimplemented rows because one smoke fixture passes.

`FloorMotion.swift` owns motion samples/history/mode types. `FloorGeometry.swift` owns plane/candidate/analysis types. `FloorAnalysisLane.swift` owns pure delivery gate/input/output and the injected admission/dispatch helper. `FloorAnalysisWorker.swift` owns platform orchestration only. `DetectionSource` lives in `APIClient.swift`.

Common pure compile list: `APIClient.swift`, `FloorCalibration.swift`, `DepthEstimate.swift`; geometry adds `FloorGeometry.swift`; motion adds `FloorMotion.swift`; coordinator adds `FloorMotion.swift`, `FloorGeometry.swift`, `FloorDetectionCoordinator.swift`, `ProximityPolicy.swift`, `ProximityAlertRouting.swift`. Delivery and coordinator suites also compile `FloorAnalysisLane.swift` for the shared input/output types. The platform worker is a separate `FloorAnalysisWorker.swift` owned by the capture worker and registered by root. Do not conditionally substitute a fake worker implementation for production pure delivery tests. No pure test imports the iOS app entry point.

### Task 1: Calibrated pixel mappings and unchanged object depth

**Files:** Geometry owner creates `S/FloorCalibration.swift`, `T/FloorCalibrationTests.swift`, `T/floor-calibration.test.mjs`. Capture owner then modifies `S/DepthEstimate.swift` only after type handoff. Root updates explicit source lists in existing runners which compile DepthEstimate, and source registration. This is a coordinated two-file handoff, not concurrent edits.

**Consumes:** Raw copied calibration fields and `FloorImageMapping`.
**Produces:** Validated `FloorCalibration`, optional snapshot fields/default initializer, unprojection functions above.

- [ ] Write failing tests using concrete 100×200 reference / 50×100 delivered mapping, `fx=fy=100`, `cx=50`, `cy=100`, distortion center `(50,100)`, verified portrait and already-oriented calibration. For pixel `(24,49)`, reference center is `(49,99)`, and zero-table axial `z=2` gives `(-0.02,-0.02,2)`. Compare each component within 1e-9.

```swift
let mapping = FloorImageMapping(referenceWidth: 100, referenceHeight: 200,
    deliveredWidth: 50, deliveredHeight: 100, portrait: true, mirrored: false,
    sameAspectNoCropVerified: true, calibrationAlreadyOriented: true)
let k = [SIMD3<Double>(100, 0, 0), SIMD3<Double>(0, 100, 0), SIMD3<Double>(50, 100, 1)]
let c = try FloorCalibration.validated(intrinsicColumns: k, center: SIMD2(50, 100),
    forward: [0, 0], inverse: [0, 0], mapping: mapping)
let p = c.unproject(x: 24, y: 49, axialZ: 2)!
precondition(abs(p.x + 0.02) < 1e-9 && abs(p.y + 0.02) < 1e-9 && p.z == 2)
let q = SIMD2<Double>(12.5, 35.5)
let roundTrip = c.deliveredPoint(reference: c.referencePoint(delivered: q))
precondition(abs(roundTrip.x-q.x) < 1e-9 && abs(roundTrip.y-q.y) < 1e-9)
```

- [ ] Add the direction trap: use inverse `[0.1,0.1]` and forward `[-1/11,-1/11]` Float values, point `(60,100)` must undistort to `(61,100)` and distort back within 1e-5. A forward/inverse swap must fail. Test center, farthest corner, last-bin interpolation and max-radius behavior. A varying table checks linear interpolation against independent hand-calculated radii.
- [ ] Add rejection rows: empty/one/4097 entries, NaN/Inf, radial factor zero/negative, noncanonical K, zero focal/dimensions, principal point outside frame, aspect mismatch, unknown crop, mirror true, unverified orientation, nonfinite axial Z, outside 0.2–5 m and out-of-map indices. Add explicit 90° coordinate fixture `(x,y)->(H-y,x)` and inverse `(x',y')->(y',H-x')` round trip with width/height swap to catch double-rotation assumptions; runtime rotated/unproven inputs remain rejected.
- [ ] Run `node --test samples/ios/tests/floor-calibration.test.mjs`. Expected red: missing production types, then assertions fail if table direction/half-pixel behavior is wrong.
- [ ] Implement validation and mapping exactly from Apple reference with the explicit pixel convention. Then add defaulted calibration fields to `DepthSnapshot`; do not edit `estimate`, `centerSurface`, `addingDepth`, or matcher acceptance logic.
- [ ] Extend `DepthEstimateTests.swift` via root handoff with two identical ordinary maps, one with floor metadata and one without. Both `estimate` and `centerSurface` results and rejection reasons must match for every existing matrix row. Missing inverse table cannot clear object depth. Use the already inspected unchanged constructor in the regression tests.
- [ ] Run the calibration suite and existing `lidar-depth`, `center-depth-sensor`, `proximity-depth-pipeline` suites. Commit owned files with `feat: add validated floor calibration mappings` after root integrates dependency lists. No acceptance claim about real camera coordinates yet.

### Task 2: Bounded motion history and automatic-mode hysteresis

**Files:** `S/FloorMotion.swift`, `T/FloorMotionTests.swift`, `T/floor-motion.test.mjs`.
**Consumes:** `FloorMotionSample` and uptime.
**Produces:** `FloorMotionHistory`, `FloorModeGate`, `FloorModeStatus`.

- [ ] Write the known-pose executable assertions: upright vertical device gravity `(0,-1,0)` maps camera gravity `(0,1,0)`, tilt 0°; face-down horizontal device gravity `(0,0,-1)` maps `(0,0,1)`, tilt +90°; face-up maps tilt -90°. At 45° use `(0,-sqrt(0.5),-sqrt(0.5))`. Test finite norm before asin.
- [ ] Write gate tests with real timestamps, no sleeping. Feed 100 Hz samples from 10.00 through 10.29 at 50°: confirming, not active. At 10.30: active. 40° retains active. Feed 30° from 10.40 through 10.69: retain active pending exit; at 10.70: normal. A 40° sample cancels exit dwell. Missing sample clears active immediately. Test repeated timestamps do not confirm, 0.11 s gap resets dwell, and restart requires new dwell.

```swift
var history = FloorMotionHistory()
let s = FloorMotionSample(capturedAt: 10, gravity: SIMD3(0, -1, 0),
    rotationRate: .zero, userAcceleration: .zero)
history.append(s, now: 10)
precondition(history.nearest(to: 10.049, now: 10.05) != nil)
precondition(history.nearest(to: 10.051, now: 10.06) == nil)
history.reset()
precondition(history.nearest(to: 10, now: 10) == nil)
```

- [ ] Test 1,000 incoming samples over two seconds yields ≤101 samples, none older than 1 s; duplicate/backward/future timestamps, nonunit/NaN gravity and nonfinite acceleration reject. Test 0.8 rad/s and 0.2 g boundaries accepted, above either rejected, nearest tie earlier, no stale-history fallback after an invalid current sample. Sample timestamp 10.02 may match depth 10.00 at now 10.03, but not at now 10.01. Stale/future depth must reject even if motion itself is fresh.
- [ ] Run `node --test samples/ios/tests/floor-motion.test.mjs` red, implement the bounded pure ring/history and gate, rerun green. No CoreMotion or dispatch needed for this task.
- [ ] Commit `feat: add bounded floor pose and motion gate`. Hand exact status text to the UI worker.

### Task 3: Deterministic supporting-plane geometry

**Files:** `S/FloorGeometry.swift`, `T/FloorGeometryTests.swift`, `T/FloorTestFixtures.swift`, `T/floor-geometry.test.mjs`.
**Consumes:** Calibrated `DepthSnapshot`, camera-axis gravity, uptime.
**Produces:** `FloorAnalysis` with accepted `FloorPlane`, initially empty candidates.

- [ ] Create test-only `FloorTestFixtures.flat(z: Float = 1) -> DepthSnapshot`: 64×96 depth with matching 64×96 reference/delivered portrait calibration, zero tables, fx=fy=64, cx=32, cy=48, capturedAt 10, all z=1. Use `gravityCamera=(0,0,1)`, gravity-up `(0,0,-1)`. The floor is n·p+1=0. Never bypass portrait validation by flagging square dimensions as portrait.
- [ ] Write asserts that a level plane yields support, no obstacles, residual ≈0, offset ≈1; 299 valid samples reject; 300 samples with sufficient spread can pass; 59% support rejects; 60% and spans/cell requirements are tested at boundaries independently.

```swift
let flat = FloorTestFixtures.flat()
let result = FloorGeometry.analyze(snapshot: flat, gravityCamera: SIMD3(0, 0, 1), now: 10.1)
precondition(result.unavailableReason == nil && result.plane != nil)
precondition(result.candidates.isEmpty)
precondition(abs(result.plane!.offset - 1) < 1e-6)
```

- [ ] Add independent analytic sloped-plane ray intersections, not fixtures built using production fitting. For each ray `r=((x+.5-cx)/fx,(y+.5-cy)/fy,1)`, axial `z=-offset/dot(normal,r)`; reject nonpositive/out-of-range intersections. Normals at 14.9° and 15.1° from up exercise acceptance/rejection; vertical wall rejects. Offsets 0.29/0.3/2/2.01, residual medians 0.029/0.031, inadequate grid cells and narrow spans exercise conservative acceptance.
- [ ] Add competing planes: equal disjoint broad planes at offsets 1.0 and 1.2 must return unavailable because neither has 60% support. Separately exercise the actual ambiguity branch with intersecting admissible tilted planes whose inlier bands overlap: construct analytic planes at ±10° from gravity-up with offsets 1.0 and 1.15, assign points from each plane and the shared inlier region, and first assert independently that best support ≥60%, alternate support ≥80% of best, both spatial/residual gates pass, and offset separation ≥0.15. If that fixture cannot meet the inequalities, adjust point allocation, not production thresholds. Then require the specific competing-plane rejection. Test the ambiguity predicate directly with validated support summaries too, so an earlier insufficient-support failure cannot masquerade as ambiguity coverage. Test same plane duplicate hypotheses do not trigger ambiguity. Test all NaN, Infinity, negative and 0.19/5.01 m never create plane or depression output.
- [ ] Run geometry test red. Implement a fixed sampled lattice in normalized x `[0.1,0.9]`, y `[0.25,1.0]`, at most 64×64=4096 sites. Deduplicate integer pixel indices on smaller maps; never scan indefinitely looking for 4096 valid returns. Keep grid adjacency including invalid holes. Measure support cells/spans in full normalized image coordinates. These ROI bounds are explicit prototype defaults for root review.
- [ ] Implement deterministic 64 triple hypotheses, seeded reproducibly from lattice indices rather than wall-clock randomness, spread triples across grid cells; reject degenerate cross products, orient n to gravity-up, apply angle/offset constraints and all support checks. Score residuals with per-point axial tolerance, rank by inlier count then residual then stable coefficients. Refit accepted support using bounded least-squares/eigen solve only if numerically stable, revalidate every gate after refit. Retain alternatives and apply the 80%/0.15 m ambiguity rejection before returning. Interpret “alternative admissible” conservatively: it must pass angle, distance, residual and spatial gates, but its support threshold is 80% of the best, not an additional independent 60% of all points. Root must confirm this explicit interpretation of the spec before implementation; requiring two disjoint 60% planes would make ambiguity rejection largely vacuous. Surface inability to find support as unavailable, never “floor clear.”
- [ ] Assert inspected sample count ≤4096 and attempted hypotheses ≤64 via a small test-only/injected diagnostic result or internal counters exposed to the executable test, not a timing guess. Rerun plane matrix green twice and assert identical output. Commit `feat: fit conservative bounded floor support`.

### Task 4: Raised connected clusters

**Files:** Same geometry-owner files from Task 3. Coordinator owner consumes persistence inputs in Task 6.
**Consumes:** Accepted plane, original sampled pixel coordinates and unprojected points.
**Produces:** `FloorCandidate` with robust cluster axial depth, never a bounding-box ROI estimate.

- [ ] Add `FloorTestFixtures.blocks(rects: [NormalizedBox], topZ: Float = 0.85) -> DepthSnapshot`, starting from flat z=1. Replace only finite pixels inside each specified rectangle. With down-looking camera this is a 15 cm raised block. Fixture rectangles `(0.25,0.45,0.2,0.2)` and `(0.6,0.7,0.15,0.15)` must yield two clusters with median z≈0.85 and boxes enclosing original distorted pixel cells. Make expected connected sample counts explicit from the fixture lattice.
- [ ] Test: 7 samples rejects / 8 accepts when extent supports it; 3 cm extent in either of the two largest camera-axis extents rejects / 4 cm accepts; height 0.079 rejects / 0.08 accepts when spread low; higher residual spread increases minimum. Fix the extent convention to the two largest of camera X/Y/Z ranges and document its conservative orientation dependence, not an arbitrary fitted object shape.

```swift
let boxes = [NormalizedBox(x: 0.25, y: 0.45, width: 0.2, height: 0.2),
             NormalizedBox(x: 0.6, y: 0.7, width: 0.15, height: 0.15)]
let raised = FloorGeometry.analyze(snapshot: FloorTestFixtures.blocks(rects: boxes),
    gravityCamera: SIMD3(0, 0, 1), now: 10.1)
precondition(raised.candidates.count == 2)
precondition(raised.candidates.allSatisfy { abs($0.axialDepth - 0.85) < 1e-5 && $0.capturedAt == 10 })
```

- [ ] Add disconnected blocks separated by one NaN lattice row, diagonally adjacent blocks, and depth jumps above/below `0.15+0.05*min(zA,zB)` (use nearer depth conservatively) to verify exactly 8-neighbor graph connectivity plus 3D-gap gate. Missing pixels are graph barriers, not zero-height points. A below-plane depression and a NaN hole produce **zero raised candidates**, never a pothole label. Dark/shadow semantics are not inferable from synthetic depth; reserve real shadow test for phone.
- [ ] Run geometry suite red, then implement bounded flood fill over sampled sites; height is signed `n dot p + offset` with n upward. Use medians of cluster axial Z and signed height. Box min/max refer to original pixel cell edges `(minX/width, minY/height, (maxX-minX+1)/width, ...)`, clamped only to valid image edges, not undistorted reprojection. Never call `snapshot.estimate(in:)` for a cluster.
- [ ] Rerun geometry/calibration suites green, assert no result carries classifier confidence, commit `feat: detect conservative raised floor clusters`. Persistence is separately tested in Task 6 and remains a release dependency, not optional polish.

### Task 5: Platform calibration copy, motion provider and independent floor lane

**Files:** Capture-worker files in ownership table including `S/FloorAnalysisWorker.swift`; root registers sources/project and updates affected existing harness lists.
**Consumes:** Task 1 calibration, Task 2 motion/gate and Task 4 pure geometry.
**Produces:** `CameraCapture.start` optional floor callback, same copied matched snapshot, epoch-tagged outputs and prompt invalidations.

- [ ] Write `FloorDeliveryTests.swift` executable gate tests: reserve at 10 succeeds, reserve while pending at 11 fails, complete first then 10.199 fails, 10.2 succeeds; old completion cannot release new epoch reservation; backward/nonfinite times reject. Test reset stops eligibility but does not permit a second geometric job while a previous job still physically runs. Keep physical busy ownership separate from epoch admission state.
- [ ] Add injected test executor/copy/JPEG counters around the **production admission/dispatch helper**: simulate 30 Hz capture for one second with neural handler stalled and center handler independently delayed. Assert floor starts ≤5, max concurrent jobs=1, queue length=0, one snapshot copy per admitted capture, no JPEG for floor-only/center-only capture, center delivery keeps its own gate, neural receives identical width/height/time/meters when admitted on the same capture. Do not claim a regex proves these runtime properties. Injection belongs at closure boundaries, not a second implementation in test code.
- [ ] Add tests for missing depth/mismatched timestamp, invalid floor calibration and motion error during busy geometry: invalidate publication immediately and suppress late result; a slow neural inference must not block floor; a slow floor must not block scalar sensor or PiP. Repeated invalidation coalesces, but a valid later epoch cannot be overwritten by a delayed old invalidation. Use deterministic fake uptime/executor, not sleeps.
- [ ] Run `node --test samples/ios/tests/floor-delivery.test.mjs` red. Implement gate and production dispatch helper, then thin platform worker/provider. Handle callback failure with unavailable reason; start only after active LiDAR setup and opt-in, stop/clear on stop, runtime restart, interruption and background suspension. In this deadline version suspend floor on every app background transition, including PiP, until foreground provides fresh motion and dwell. Keep neural/preview behavior unchanged and label floor unavailable in PiP. This is conservative lifecycle handling, not claiming live background geometry.
- [ ] Extend snapshot copying with optional bounded calibration. Do not force unwrap tables. Require measured/documented delivery provenance before setting `sameAspectNoCropVerified`/`calibrationAlreadyOriented`; unknown pipeline must still deliver ordinary snapshot with reason. Preserve all object gates and existing clock conversion.
- [ ] Extend admission `(wanted && handler != nil) || sensorReservation != nil || floorReservation != nil`, copy once and pass immutable value to each consumer. Dispatch floor before neural JPEG work, without routing through `onFrame` or `frameTask`. Invalid depth status bypasses work reservation to clear prior floor immediately. The synchronizer early return for missing/dropped RGB must also invalidate floor; do not wait for `process` when that callback is skipped. Keep synchronization/matched previous-RGB retention unchanged.
- [ ] Rerun new delivery/motion and existing `lidar-depth`, `center-depth-sensor`, `camera-interruption`, `model-first-startup` suites. Root performs one targeted unsigned build after integration, not each worker launching builds concurrently. Commit `feat: wire independent calibrated floor capture lane` only when lane race tests pass. Device calibration proof still gates promotion.

### Task 6: Source-aware fusion, distinct observations and existing alert policy

**Files:** Root-owned `S/FloorDetectionCoordinator.swift`, `S/APIClient.swift`, `S/ProximityPolicy.swift`, `S/ScanModel.swift`, coordinator tests/runner; source-list updates.
**Consumes:** Neural `Detection` arrays enriched by existing `addingDepth`; `FloorLaneOutput`; polygon zone; epoch and uptime.
**Produces:** Current merged observations with independent lifetime, unchanged #38 policy semantics and no generic-alert replay.

- [ ] Write preference migration tests: missing floor field false, saved true/false round-trip, LiDAR-off plus floor-on remains effectively off. Incoming detector JSON without confidence still rejects; normal confidence stays intact; incoming `source:"floor"` cannot impersonate native geometry. Locally built floor detection has confidence nil and correct expiry/source.
- [ ] Write coordinator executable cases with neural timestamp 10.00 and floor timestamps 10.10/10.30, epoch A. Same floor timestamp twice cannot confirm plane or obstacle. Require plane persistence on two distinct fresh frames with normal delta ≤5° and offset delta ≤0.05 m, plus candidate IoU ≥0.2 and depth difference ≤max(0.15 m,10% nearer depth). These persistence defaults supplement, not replace, every-frame geometry gates. Reset floor history on invalid support, changed epoch or invalid motion. Both plane and cluster must persist.
- [ ] Avoid counting the second geometric frame twice: retain first valid floor observation in a non-rendered pending state, then on second compatible frame replay neither old observation nor its time as new. Use `ProximityPolicy.update` for the first fresh pending observation internally (no public boxes or feedback), then second fresh observation for confirmation. Ensure only currently persistent candidates enter published observations. **Required mechanism:** coordinator returns first-frame candidates only to an internal policy input through a separate `policyObservations(now:) -> [Detection]`; `observations(now:)` returns persistent display/eligible candidates. Match policy outputs back by source+capture+box without assigning synthetic confirmation. The declared `policyObservations(now:)` method keeps policy state for both sources across those calls.
- [ ] Write these assertions using explicit source/timestamp sequences:

```swift
let epoch = UUID()
let box = NormalizedBox(x: 0.3, y: 0.5, width: 0.2, height: 0.2)
let zone = [NormalizedPoint(x: 0, y: 0), NormalizedPoint(x: 1, y: 0),
            NormalizedPoint(x: 1, y: 1), NormalizedPoint(x: 0, y: 1)]
func floorOutput(_ time: Double) -> FloorLaneOutput {
    let plane = FloorPlane(normal: SIMD3(0, 0, -1), offset: 1,
        medianResidual: 0, residualSpread: 0, supportCount: 1000)
    let candidate = FloorCandidate(bbox: box, axialDepth: 0.85,
        capturedAt: time, sampleCount: 30, heightMeters: 0.15)
    return FloorLaneOutput(epoch: epoch, revision: 0, mode: .active,
        analysis: FloorAnalysis(capturedAt: time, plane: plane,
            candidates: [candidate], unavailableReason: nil))
}
var coordinator = FloorDetectionCoordinator()
var policy = ProximityPolicy()
coordinator.reset(epoch: epoch, notBefore: 9.9)
coordinator.acceptFloor(floorOutput(10), zone: zone, now: 10.01)
precondition(coordinator.observations(now: 10.01).isEmpty)
let first = policy.update(coordinator.policyObservations(now: 10.01),
    settings: ProximitySettings(), now: 10.01)
precondition(first.count == 1 && first[0].proximityConfirmed == false)
coordinator.acceptFloor(floorOutput(10), zone: zone, now: 10.02)
let repeated = policy.update(coordinator.policyObservations(now: 10.02),
    settings: ProximitySettings(), now: 10.02)
precondition(repeated.count == 1 && repeated[0].proximityConfirmed == false)
coordinator.acceptFloor(floorOutput(10.2), zone: zone, now: 10.21)
precondition(coordinator.observations(now: 10.21).count == 1)
let second = policy.update(coordinator.policyObservations(now: 10.21),
    settings: ProximitySettings(), now: 10.21)
precondition(second.count == 1 && second[0].proximityConfirmed == true)
coordinator.invalidate(.neural)
precondition(coordinator.observations(now: 10.22).count == 1)
coordinator.expire(now: 10.2 + DepthSnapshot.maximumAge)
precondition(coordinator.observations(now: 10.2 + DepthSnapshot.maximumAge).isEmpty)
```

  For the complementary invalidation test, accept a neural detection outside the floor box at 10.25 with depth/expiry from its own snapshot, invalidate `.floor`, and require exactly that neural observation to remain. Run wrong epoch/revision and no-replay cases from fresh setups, not empty-array assertions which pass vacuously.
- [ ] Add dedup rows: IoU≥0.3 and both fresh depths within max(0.15 m,10% nearer depth) suppress only floor display/policy candidate in favor of neural label. Overlap without fresh compatible neural depth retains unclassified geometry. No semantic relabeling. Keep floor persistence history independent of dedup, so a neural disappearance does not resurrect an expired blob. Source-aware tracks do not inherit each other's confirmations. A source change can require reconfirmation, not a second simultaneous alert.
- [ ] Add out-of-order, stale/future capture, wrong epoch, pre-interruption result, invalidation→late result, neural error while floor remains, floor unavailable while neural remains, and floor-only expiry with no future callbacks. Check a lifecycle deadline task expiring nearest source boundary, not only expiration during new callbacks. Neural generic alert is consumed only on that new neural result and never stored/replayed on floor updates; floor-only updates call feedback with a neutral `FrameAnalysis.Alert(triggered:false, reason:"floor", modalities:[], message:nil, cooldownRemainingMs:0)`.
- [ ] Run `node --test samples/ios/tests/floor-coordinator.test.mjs` red. Implement native source/optional confidence and coordinator. Neural observations retain current 2.5 s box lifetime but only original 0.75 s depth freshness; floor boxes have 0.75 s maximum lifetime. Invalidate one source, never `clearDisplayedResult` globally except lifecycle reset or settings reset. Zone membership uses same bottom-center anchor and polygon containment semantics as existing neural output; copy no model classifier. Verify backend/native zone-edge convention read-only before implementing pure point-in-polygon; edge points need an explicit test matching existing behavior.
- [ ] Wire ScanModel without moving model-first construction/access. Keep one `ProximityPolicy` and one AlertPlayer selected-channel scheduler. Feed all current policy observations with immutable original capture-derived expiry, so other-lane updates cannot increase confirmation/retreat counts. Apply display/eligibility filter after policy update; routing receives only eligible output. Source invalidation cancels stale floor pulses immediately but recomputes any remaining fresh neural route rather than unconditionally silencing it. All callbacks check run epoch, floor revision, preferences revision, notBefore, camera state and freshness at MainActor publication.
- [ ] Rerun `proximity-policy`, `proximity-alert-routing`, `proximity-feedback`, `proximity-depth-pipeline`, `detector-recovery`, `model-first-startup`, and coordinator suites. Verify near/intermediate/far bounds, two distinct in-zone observations, immediate closer band after confirmation, +0.15 m/two-frame retreat, deterministic closest, single selected modality schedule, visual-only mode and generic unknown-depth fallback are unchanged. Commit `feat: fuse floor observations without replaying source state`.

### Task 7: Source-aware native setting and honest main/PiP status

**Files:** UI worker alone modifies ScannerView/MyEyesApp/its UI tests. Root modifies `S/PictureInPicture.swift`, `S/ScanModel.swift`, and `T/proximity-ui.test.mjs` only after coordinating current UI changes.
**Consumes:** `floorModeStatus`, optional confidence/source, opt-in preference, capability split.
**Produces:** Persistent textual status, non-color labels, unclassified geometry without neural percentage in both surfaces.

- [ ] UI worker writes tests first for old saved preferences opting out, exact setting title, Stop requirement, LiDAR dependency explanation, and all four mode strings. Test source label formatting with actual pure formatting helper or Swift view-model data, not just text search. Neural 0.82 renders 82%; floor nil renders no `%` and exact unclassified label.
- [ ] Test model failure + valid floor: shows `Neural detection unavailable` and `Floor mode`, not whole-app `Preview only` or `No obstacle alerts`; floor failure + healthy neural: supported neural detection still available. No candidate is not “safe/clear passage.” Unknown depth remains neutral. Off yields normal scan and ordinary behavior.
- [ ] Run failing `node --test samples/ios/tests/floor-ui.test.mjs samples/ios/tests/proximity-ui.test.mjs` (or incorporate assertions in UI worker's `clarity-ui.test.mjs` with its consent). UI worker implements toggle/status and `if let confidence` rendering, root updates PiP state/status and presentation consistently. Keep existing non-color band labels and no invented confidence.
- [ ] Run UI/proximity/PiP suites green and review main/PiP screenshots on phone during Task 8. Commit ownership-separated UI/PiP changes, not a mixed commit containing the other worker's unfinished files.

### Task 8: Acceptance, CI and physical gate before promotion

**Files:** Root owns project registration, `.github/workflows/ios-pip.yml`, `samples/ios/REPAIR_VERIFICATION.md`.
**Consumes:** All preceding green suites and root's reviewed implementation diff.
**Produces:** Recorded build/CI/device evidence or explicit draft blockers, never implied physical verification.

- [ ] Register each new production Swift file in PBX file/build references, app group and Sources phase using unique IDs; add explicit CoreMotion linkage only if automatic module linking does not suffice. Keep deployment target/signing unchanged. Update all existing explicit Swift compile lists referencing new types. Make the new tests discoverable through the current native test glob.
- [ ] Run `node --test samples/ios/tests/*.test.mjs` once after integration with scratch configured. Record passed/failed/skipped counts. Linux-skipped Swift tests are not green native verification. If existing UI tests fail due to another worker, coordinate a narrow fix, do not delete assertions.
- [ ] Run actual unsigned build, one owner/process:

```bash
xcodebuild -project samples/ios/MyEyes.xcodeproj -scheme Clarity \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$JCODE_SCRATCH_DIR/floor-ios-build" CODE_SIGNING_ALLOWED=NO build
```

  Existing workflow already runs native tests and unsigned simulator build on PRs. Publishing a PR will trigger it; root must record actual CI run URL/outcome, not infer success from YAML. If required for hardware API compilation, also run unsigned `-destination 'generic/platform=iOS'` using a separate derivedData path, with no signing/account/device reset. These builds are **implementation-stage only**, not authorized during this planning pass.
- [ ] Physical phone checklist, phone stationary and objects moved: vertical vs face-down gravity signs/tilt; known reference object heights and axial distances; level floor empty vs ≥8 cm raised block; two separated blocks; thin/small object documented miss; shadow with no raised geometry; tilted/rapid motion invalidation; reflective/coverage loss; floor/calibration unavailable preserves object/center sensor; neural recovery failure leaves fresh floor capability; stale expiry; Stop/restart epochs; foreground/PiP interruption/background clears floor then requires fresh dwell. Verify opt-in defaults off and setting change while stopping blocked.
- [ ] Inspect calibration provenance on judging phone without recording maps/images/motion. Document metadata/transform evidence and pass/fail, not raw sensor arrays. If orientation/aspect/table validation fails, retain unavailable reason. Do not weaken validation to get a demo.
- [ ] Record limitations: geometry is not floor semantics (tabletop ambiguity remains), no potholes/drop-offs from missing returns, no shoelace/coin guarantee, uncertain transparent/reflective/outdoor coverage, no mobility-aid replacement. Mark synthetic tests as synthetic and phone measurements as phone evidence separately.
- [ ] If all checks pass, root reviews implementation and decides promotion. If physical phone, calibration proof or CI is unavailable, retain experimental opt-in and draft status. Commit verification docs and CI/project changes only with accurately recorded results.

## Deadline21UTC execution budget and stop conditions

Planning inspected at approximately 19:22 UTC on 2026-10-17. About 98 minutes remain until 21:00 UTC at that point. This is a tight, conditional schedule, not a claim all calibration/physical work fits. Root reviews this plan before any implementation. No worker starts code on the strength of this document alone.

| UTC target | Deliverable / gate |
|---|---|
| 19:35 | Root review, freeze source interfaces and ownership, decide calibration provenance path. Geometry and motion workers may start only after approval. |
| 19:55 | Calibration/motion tests green; plane/cluster matrix substantially complete. Root's coordinator tests and UI handoff ready in parallel. If calibration proof is blocked, continue pure tests only and label runtime unavailable. |
| 20:15 | Pure geometry including ambiguity/NaN/persistence and bounded delivery tests green; single snapshot platform wiring reviewed. No deadline-based threshold reduction. |
| 20:35 | Source fusion/UI integrated, native regressions and unsigned build completed or failure explicitly blocking. Start CI early enough to complete its existing 20-minute timeout. |
| 20:50 | Stationary phone acceptance and calibration known-pose checks recorded, or explicitly unavailable. |
| 21:00 | Freeze. Root reviews evidence, keeps feature opt-in and PR draft if any mandatory gate remains. Ship existing reliable scanning rather than silently claiming unverified geometry. |

Three implementation roles plus existing UI worker are the upper useful bound; more agents increase shared-contract conflicts. If fewer than ~60 minutes remain after root approval, a reviewed pure core plus honest disabled/unavailable runtime/draft is the bounded result. It is **not** equivalent to completed #40. Never remove competing-plane rejection, pose proof, persistence, source isolation or tests to meet the clock. Do not start a heavy build concurrently with another worker's build.

## Risks and blockers for root review

1. **Delivered calibration transform proof is the principal blocker.** The inspected headers establish table direction and EXIF semantics, not by themselves the precise connection-delivered portrait provenance on the judging phone. Same aspect does not prove no crop/rotation. Fail closed without changing object ROI behavior.
2. **Real geometry robustness can exceed the time budget.** Root must confirm the explicit alternate-plane admissibility interpretation in Task 3. Disjoint 50/50 planes test insufficient support, not the separate ambiguity gate. 64 deterministic hypotheses may miss a supporting plane; false unavailable is acceptable, relaxing support/ambiguity gates is not. Tabletop-as-floor remains a limitation despite gravity and camera-height checks.
3. **Source fusion changes whole-result assumptions.** Neural error, display timer, depth timer and recovery strings currently clear/describe the whole screen. Partial conversion risks stale replay or false “preview only.” Source/epoch tests are mandatory before enabling floor output.
4. **Cross-source temporal policy is subtle.** First-plane/cluster persistence and #38 confirmation both need distinct capture observations; an unrelated callback must not count an old snapshot again. The internal policy-observations path must be reviewed and tested, not implemented via setting `proximityConfirmed = true` manually.
5. **Optional confidence impacts the active UI worker.** Coordinate the API change first. Existing UI files are not owned by this planner/capture/geometry worker. Detector scout stays read-only. Incoming neural JSON still requires real confidence.
6. **CoreMotion failure semantics are platform-specific.** Capability availability, service errors and foreground/background behavior need real device checks. No invented motion permission API or guessed timestamp epoch. Bounded history and stale checks remain enforceable even without hardware.
7. **Current tests mix executable Swift and source inspection.** New temporal/admission contracts need execution of production helpers. Regex-only tests cannot substantiate no queued work or a second session's absence at runtime. Unsigned simulator build cannot prove LiDAR correctness.
8. **Deadline and publication are external gates.** Plan author does not push/open/merge a PR or assert CI/device outcomes. Root owns review and publication after implementation. No password, signing, account or camera reset is authorized.

## Spec coverage / final plan self-review

| Spec requirement | Planned evidence |
|---|---|
| Matched AVFoundation, no ARKit, model-first, independent center sensor | Task 1 regressions, Task 5 runtime counters/clock/matching tests, Task 6 startup regression |
| Copied immutable metadata, no guessed crop/rotation, inverse-table semantics | Task 1 executable direction/center/scale/mirror tests; Task 5 platform provenance; Task 8 phone evidence |
| Bounded CoreMotion, known axes, skew/motion/hysteresis and epochs | Task 2 matrix, Task 5 lifecycle/invalidation, Task 8 poses |
| ≤4096 points/64 hypotheses, strict plane support/ambiguity | Task 3 bounded counters and analytic fixtures |
| Raised-only, connected clusters, no NaN potholes, cluster depth | Task 4 fixtures and no ROI substitution; Task 6 persistence |
| Single-flight ≤5 Hz, no queue/JPEG/inference dependence | Task 5 executable injected-production dispatch tests and phone behavior |
| Fresh independent lanes, dedup, no fake labels/confidence | Task 6 timestamps/expiry/fallback tests; Task 7 main/PiP labels |
| #38 confirmation/bands/routing/selected modalities | Task 6 existing and cross-source executable policy tests |
| Opt-in native setting, capability-specific status, unchanged web | Task 7 migration and main/PiP tests; no browser files owned |
| Unsigned build, published CI, actual stationary phone checks | Task 8 required acceptance evidence or explicit draft blockers |

This plan defines work, not successful implementation. Planning validation is source/header inspection, requirement mapping, exact spec-copy comparison excluding its status line, and document-only diff review. No runtime code, branch switch, heavy test run, device claim or implementation approval is included in this docs-only commit.
