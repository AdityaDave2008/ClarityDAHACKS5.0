# Native proximity feedback (#38)

Uses the existing matched object-ROI LiDAR estimate. Values are approximate camera optical-axis surface depth, not person-to-object clearance, collision risk or a safe-path guarantee. Neither confidence, bounding-box size nor the unrelated center-pixel sensor test supplies distance.

## Behavior

| Default depth band | Box / text | Selected sound and haptic cadence |
| --- | --- | --- |
| ≤1 m | Red / Near | 2 pulses per second |
| 1–2 m | Amber / Intermediate | 1 pulse per second |
| 2–3 m | Green / Far | 1 pulse every 2 seconds |
| >3 m | Muted blue / Out of range | No proximity pulses |
| Missing, invalid, mismatched, stale or disabled | Gray / Unknown | No proximity escalation |

Thresholds are editable in native settings, strictly ordered within the existing 0.2–5 m sensor validity range. Old saved preferences retain defaults. Green means relatively farther, never clear or safe.

A newly tracked object needs two distinct, fresh, spatially matched, in-zone depth frames before its first proximity alert. Replaying one frame does not confirm it. Once confirmed, approaching a closer band changes cadence without the unrelated generic detector cooldown. Retreat requires 0.15 m beyond the boundary and two distinct observations, reducing flicker without retaining stale measurements. Depth loss resets object confirmation and hysteresis. Slow inference or poor sensor coverage can therefore leave proximity unavailable rather than inventing distance.

The closest valid in-zone object drives one feedback loop; deterministic tie breaking prevents multiple overlapping loops. Target changes do not reset the global pulse-rate bound. Sound/haptics/speech selections are respected. Haptics use discrete impacts, not an unsupported intensity promise. Speech changes are bounded to at least one second and repeats to three seconds, without interrupting the same unfinished utterance. Beeps do not restart speech.

Every pulse rechecks the 0.75-second depth expiry. Stop, interruption, invalidation and settings changes cancel feedback. Known out-of-range-only scenes stop old generic output too. Unknown-depth objects retain the existing generic confirmed detection warning when no valid in-range target owns feedback. Main and PiP overlays both check freshness and include non-color band/depth labels.

No Apple Critical Alerts entitlement, signing change, new browser distance model, classifier retraining, confidence-threshold change or floor detector is included.

## Requirement-to-evidence map

| Requirement | Concrete check and observed result |
| --- | --- |
| Valid matched object depth only | `proximity-depth-pipeline.test.mjs` executes actual DepthSnapshot estimator → policy → routing → cadence. Synthetic uniform maps produce the correct near/far response. Missing, mixed, stale, disabled and mismatched maps stay unknown. This is not physical calibration. |
| Boundaries/settings/hysteresis | Executable `ProximityPolicyTests.swift` checks default and custom thresholds, invalid settings fallback, approach/retreat, duplicate/out-of-order frames, matching and stable identities. |
| Independent confirmation/closest policy | Policy and routing tests verify two distinct in-zone frames, closest-object selection, no first-frame escalation, generic-cooldown independence and unknown-object fallback. |
| Selected channels and bounded cadence | Executable Swift 6 `ProximityFeedbackTests.swift` tests all modality combinations, 0.5/1/2-second intervals, speech timing and target changes. |
| Stop/depth expiry cannot emit later | Actual async controller tests use injected monotonic time/output/sleep to exercise cancellation, expiry and reentrant stop, not a copied scheduler. |
| No overlapping old generic output | Regression guards cover generic→proximity ownership and known-out-of-range/invalidated-display stops. Actual audio/haptic hardware still requires a phone. |
| Main/PiP text and color | UI wiring tests cover shared fresh-band palette, band/axial-depth text, periodic expiry, bounded label positioning and editable settings. Unsigned app compiles. No physical screenshot/VoiceOver acceptance is claimed. |
| Preserve browser/no new distance model | No frontend files changed for #38. Existing frontend/backend/Worker suites remain green. |

## Verified locally

Actual `MyEyes.xcodeproj`, scheme `Clarity`, generic-iOS unsigned build passed. **80 native tests passed, zero failures/skips**, including the compiled app icon. Backend **27**, frontend **243**, and Worker **39** tests and JavaScript syntax checks passed. Controlled fixtures establish software behavior, not physical accuracy or safety.

Evidence logs: `~/.jcode/scratch/issue38-20261017/`. Red/green logs retain the first-frame escalation, out-of-range old-audio and lifecycle-clear regressions discovered during review.

## Remaining phone acceptance

Both paired physical phones remain unavailable to Xcode. Do not claim installation, measured distance accuracy, actual audible/haptic cadence, VoiceOver readability or physical LiDAR acceptance from these tests.

When the owner makes the judging phone reachable, use the existing signing/pairing and [wireless guide](../samples/ios/WIRELESS_TESTING.md). Keep the phone stationary and move a reference object, not a person into hazards. Measure axial distances at 0.5, 1, 1.2, 2, 2.2, 3 and 3.3 m, approach/retreat boundaries, multiple objects, missing/covered sensor, each modality, Stop/interruption and PiP. Record reference-versus-reported depth and actual pulse timing. Missing distance is an explicit unsupported/unknown result, never a passing clearance check.
