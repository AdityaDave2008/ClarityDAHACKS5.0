# Shared-LiDAR automatic floor mode

Status: approved by the user at 19:20 UTC on 2026-10-17 (approval19:20). Implementation planning is authorized; root review of the implementation plan is required before runtime changes. This document is not a delivered floor detector or a physical-device validation result.

## Goal and limits

When the rear camera points downward, use the existing synchronized LiDAR capture stream to identify persistent raised surfaces that need not belong to a trained object class. Keep supported trained-model detections and route eligible fresh geometry through the same distance-band/selected-alert policy introduced in #38.

Geometric outputs are labeled **Unclassified floor obstacle**, not invented semantic names or classifier confidence. This is supplemental awareness, not a promise to detect every obstruction, verify clear passage, or replace mobility aids. Small/flat objects, transparent/reflective surfaces, occlusion, bright outdoor conditions and unsupported geometry can be missed. Missing returns never establish potholes or drop-offs. Reliable depression/drop-off detection is out of scope for this first version.

## Chosen approach

Reuse AVFoundation + AVDepthData + the current RGB/depth synchronizer. Add CoreMotion gravity and bounded geometric analysis. Do not create a second camera session or migrate capture to ARKit. ARKit would change session ownership, PiP behavior and depth contracts close to submission. Image-only classification cannot provide this requested out-of-class geometric capability.

Initially expose **Automatic floor mode (experimental)** as an opt-in native setting. After enabled, switching is automatic. Do not change the browser's unknown-distance behavior. Ordinary trained-model scanning remains available when floor mode is off or geometry is unsupported.

## Data path and isolation

1. Existing model-first startup remains unchanged: fully initialize the bundled detector before camera construction/access.
2. Start a bounded CoreMotion provider with the active LiDAR camera. Store at most one second of timestamped gravity/rotation-rate samples in memory; no telemetry or recording.
3. Extend the existing immutable depth snapshot with optional copied calibration metadata. Existing object-ROI estimates continue when floor-specific calibration is unavailable. Never tighten or weaken their existing acceptance gates accidentally.
4. Deliver the same matched snapshot to a separate single-flight floor-analysis lane, capped at 5 Hz. Reuse already-copied depth data. No frame queue, extra JPEG encoding, second capture session, concurrent geometric jobs or dependence on neural inference completion.
5. A floor-mode gate selects normal, confirming floor, active floor or unavailable state. A pure geometric detector returns only fresh timestamped candidate boxes/cluster depths plus a reason when unavailable.
6. A small source-aware detection coordinator holds neural and geometric observations separately. Invalidating one lane does not replay old observations from the other. Generation, timestamp and lifecycle checks apply before publication.
7. Fresh geometric candidates enter the same #38 tracking, confirmation, closest-target routing and selected-alert scheduler. Both main and PiP overlays identify their source and avoid a fabricated classifier percentage.

## Tilt and motion gate

Initial configurable prototype thresholds: enter at least 45° below horizontal for 300 ms; exit when downward tilt decreases to 35° or less for 300 ms. The 10° hysteresis avoids rapid mode switching. Invalid/stale motion immediately disables geometric output rather than preserving the last tilt.

For the supported upright portrait, unmirrored rear-camera convention, camera-axis gravity is `(device.x, -device.y, -device.z)` and downward tilt is `asin(-device.z)`. This convention requires an executable known-pose test and a physical flat/vertical check before hardware acceptance. Do not guess an extra rotation from device model names.

Choose the closest motion sample within 50 ms of the matched depth capture time. Validate finite unit gravity, monotonic timestamps and the relationship to system uptime. Reject excessive motion provisionally above 0.8 rad/s rotation or 0.2 g user acceleration. These values are engineering defaults to test, not safety-certified thresholds. Stop/background suspension/interruption clears motion history and floor confirmation.

## Calibration and unprojection

The current `LiDARCapture.snapshot` only validates calibration and then discards it. Its distorted depth map is aligned to delivered RGB. Therefore **direct K-inverse unprojection of the raw distorted pixel is not valid**.

Retain focal lengths, principal point, intrinsic reference dimensions, distortion center, both distortion tables and explicit delivered orientation/mirroring metadata. Validate finite positive focal lengths, canonical intrinsic structure, plausible principal point, bounded finite tables and positive radial scale. Require a documented same-aspect reference-to-delivered-image transform. Unknown rotation, crop, mirroring or absent required calibration produces `floor unavailable`, not a guessed transform. Do not rotate already-adjusted calibration twice.

For a delivered depth pixel center: map it into intrinsic reference coordinates using the explicit transform, correct the distorted point into rectilinear coordinates, then compute the ray and multiply by its axial Z. Compute cluster boxes from their original distorted-map pixel coordinates, avoiding an unnecessary reprojection. Test both coordinate mappings for calibration round-trip consistency.

**Apple SDK direction matters:** `AVCameraCalibrationData.h` reference implementation, lines 121–124 in the installed iPhoneOS 27.1 SDK, says a *distorted point → undistorted point* mapping uses **inverseLensDistortionLookupTable**. The forward table maps an *undistorted destination point → distorted source point* when resampling an image. `AVDepthData.h` documents that `applyingExifOrientation` transforms both the depth map and calibration. Tests must cover both directions and the orientation mapping; property names alone are not sufficient evidence.

Use a consistent pixel-center convention and test scaling/rotation round trips. The capture adapter already translates the camera clock into system uptime; preserve that conversion for matching CoreMotion. Never replace it with an assumed clock epoch.

## Floor support and raised clusters

Bound computation to at most 4096 valid sampled points in the lower/central view. Only finite absolute 0.2–5 m returns are eligible. No interpolation across missing-depth holes.

Fit a deterministic robust candidate plane using at most 64 hypotheses, with its normal within 15° of gravity-up. Initial acceptance requires at least 300 valid points, 60% inlier support, spatial support in at least six cells of a 3×3 image grid, with normalized horizontal span at least 0.35 and vertical span at least 0.30. An inlier is within 0.025 m + 0.01 × axial depth of the plane; require median absolute residual no greater than 0.03 m. Reject an alternative admissible plane with at least 80% of the best support and an offset difference of at least 0.15 m, or an implausible camera-to-plane offset outside 0.3–2 m. A large tabletop can still resemble a supporting plane; this is a documented limitation, not verified floor semantics.

Cluster spatially connected returns at least max(8 cm, twice the measured plane residual spread) above the accepted plane, requiring at least eight samples and a provisional minimum 4 cm extent in two axes. Use 8-neighbor image-grid connectivity and a 3D neighbor gap no greater than 0.15 m + 0.05 × axial depth, so separated surfaces do not become one obstacle. These minimums deliberately do not promise shoelace/coin/small-hole detection. Candidate geometry and plane support must persist across distinct fresh frames.

Each candidate retains the source capture timestamp and a robust cluster axial-depth estimate. Do not feed a floor-containing bounding rectangle through the existing object-ROI estimator and call the two estimates identical. Geometry has its own validated support; both ultimately use the same physical LiDAR map and existing expiry/range limits.

## Fusion, feedback and UI

Keep source metadata separate from neural confidence. Deduplicate a geometric candidate only against a spatially overlapping neural detection with compatible fresh depth; otherwise retain an explicitly unclassified candidate. Never invent a neural label from a geometric blob. Continue ordinary neural detection, so this feature alone does not claim to fix all shadow misclassifications (#39).

The #38 policy remains authoritative: two distinct fresh in-zone observations before first proximity alert, immediate closer-band changes after confirmation, retreat hysteresis, deterministic closest eligible target, bounded selected channels, neutral unknown state and 0.75-second expiry. Missing floor/motion/calibration immediately clears geometric boxes and output eligibility. No geometry feedback survives stale depth or a stopped session.

Show a persistent textual mode/status: normal scan, confirming floor, floor mode, or floor unavailable with a concise reason. Retain non-color labels. If the neural detector fails while valid floor geometry continues, describe those capabilities separately rather than saying the whole screen is preview-only or claiming neural detection is still running.

## Required verification before merge/promotion

- Executable geometry tests: pixel centers, scaled intrinsics, documented distortion-table direction, round trips, portrait/mirror rejection, planar surfaces, raised blocks, multiple clusters, holes/NaN, walls/slopes, competing planes and out-of-range returns.
- Executable pose/mode tests: entry/exit hysteresis, timestamp skew, stale/future motion, rapid movement, missing motion permission/capability and stop/restart epochs.
- Integration tests: capture snapshot reuse, single-flight/no queue, no dependence on model throughput, independent lane expiry, no duplicate alerts, generic model fallback, source-aware labels and #38 modality/rate behavior.
- Actual unsigned iOS build and published CI. Synthetic maps do not establish sensor calibration or real obstacle detection.
- Physical judging-phone checks: upright/downward poses, level floor with known reference objects/heights/distances, tilted motion, shadows without raised geometry, sensor coverage loss, PiP and interruption. Keep the phone stationary and move objects during testing.
- Retain the feature as experimental/opt-in and the PR as draft if the physical phone or necessary calibration is unavailable. Never turn a failed calibration check into a guessed floor.

## Non-goals

No ARKit migration, training job, paid resource, critical-alert entitlement, web depth model, camera/signing reset, unsafe walking trial, universal obstacle guarantee or silent reinterpretation of unknown depth as safe space.
