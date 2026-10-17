# Experimental depth acceptance record

Implementation follows `docs/superpowers/specs/2026-10-17-capability-aware-depth-design.md`.

## What this version is intended to expose

- Native iPhone: automatically attempt synchronized hardware depth when the preference was never explicitly set. Preserve an explicit opt-out. Unsupported sensors/formats fall back to RGB detection.
- Browser: calibrated optical-axis depth to a user-selected, explicitly declared visible ground-contact point. This is a level-ground geometric estimate, not automatic ranging of every detected object.
- Optional browser monocular model: relative scene structure only. Its heatmap is not metres, and there is no automatic model-to-metric conversion in the initial UI. The tested pure fitting module is not a claim that reliable scene references have been found in a live image.
- Existing v1 detections remain separate from experimental depth. No safety-critical alert threshold is changed by estimated depth.

## Evidence recorded during implementation

| Requirement/public output | Check | Observed outcome |
| --- | --- | --- |
| Existing Clarity/v1 still starts | Isolated Chromium, real onboarding clicks, synthetic camera, actual bundled v1 weights | PASS before depth integration: 640x480 video, readyState 4, running detector, no page errors; Stop cleared camera |
| Native missing vs explicit depth setting | Real Swift preference decoding and native regression suite | PASS: 50/50 tests including missing, true and false preferences; scoped independent review passed |
| Real camera-only model inference | Actual browser WASM inference on a real photo with pinned model/runtime | PASS: 67,840 finite raw values at 320x212; optimized 252px processor input took ~2.32 seconds in one host run. Worker kept 20ms UI timer responsive. Relative output only, not metric accuracy |
| Metric geometry rejects unsupported data | Pure geometry tests covering calibration, uncertainty, pose, stale frame and identity | PASS: 45 geometry tests after review-driven fixes in 2424e0f; independent scoped re-review passed |
| Large depth model is opt-in | Browser request observation before and after ordinary v1 Start | PASS: integrated local browser made no model/runtime requests until explicit model enablement |
| Uncalibrated/no-sensor states never show metres | UI formatting and controller tests plus browser controls | PASS in integrated local browser: uncalibrated state displayed unavailable, no metric range |
| Native app target compiles | Unsigned simulator target build | PASS: Xcode 27.1, Clarity arm64/x86_64 simulator build completed in ~30 seconds; no project signing changes. Simulator does not validate physical LiDAR |
| Freshness and stop/restart | Controller lifecycle tests and browser start/stop workflow | PASS: integrated browser start/stop/restart, actual v1 and depth snapshot inference, no page errors or frame uploads; disabling model hid its output |
| Optional snapshot public controls | Actual browser checkbox, real model download, Analyze action and rendered source/map | PASS: paired source image/map appeared with historical/not-live caption while v1 remained running |
| Calibration workflow and invalidation | Actual browser controls with explicitly synthetic rear-camera identity, granted permission and orientation | PASS: calibrated output 2.1–2.8 m for the declared fixture; changing camera height invalidated output and cleared contact declaration. Real headless motion permission denial separately produced unavailable, not metres |
| Public deployment and runtime asset availability | HTTPS public app and runtime/module endpoints | Pending final deployment |
| Real-world accuracy at 0.5/1/2/3 m | Tape-measure comparison on physical devices | BLOCKED: no physical device/reference measurements observed. No accuracy percentage is claimed |

## Physical measurement protocol

1. Use a level floor with visible object/floor contact, a fixed rear lens, and measured camera height. Keep the declared supported portrait pose.
2. Calibrate projection using a centered, perpendicular reference with measured height and measured camera-axis distance. Select its top and bottom in the captured calibration image. Enter measurement uncertainty honestly.
3. Place a visible ground-contact target at 0.5, 1, 2 and 3 metres of optical-axis depth. Do not confuse floor distance or diagonal tape range with optical-axis depth. Use a fixture/aligned measurement where possible.
4. For each distance, record five repeated accepted/rejected readings and their displayed intervals, lighting, phone model, camera pose and estimated latency. Repeat with plain and textured backgrounds and at least two representative objects.
5. Record the true source (`LiDAR measured` vs `camera estimated`). Rejections count toward availability; do not omit them to improve the apparent error distribution.
6. Compute median and p90 relative error only for accepted estimates, separately reporting rejection rate. Check interval coverage separately. The provisional camera target is median <=20% and p90 <=30% under declared calibrated conditions, not a current achieved result.
7. Repeat after rotation, lens/zoom change, camera stop/restart, app hiding and bad calibration. Old depth must not survive invalidation. On native hardware, repeat interrupted/PiP capture and missing-depth cases.

## Reproducible automated commands

```sh
node --test frontend/*.test.js worker/tests/*.test.mjs samples/ios/tests/*.test.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  DEPTH_APP_URL=http://127.0.0.1:8788/?detector=local \
  node scripts/depth-browser-smoke.mjs
```

The browser harness uses an isolated synthetic camera, never the user's actual camera or browser profile. This tests the real app interfaces and runtime, but not physical distance accuracy.

## Final automated suite

`node --test frontend/*.test.js worker/tests/*.test.mjs samples/ios/tests/*.test.mjs`: **251 passed, 0 failed, 0 skipped** after opt-out lifecycle fix `6cea7a9`. This includes 50 native tests and real Swift execution. It does not establish physical accuracy.

Enable `DEPTH_TEST_MODEL=1` for actual optional-model UI inference, and `DEPTH_TEST_GEOMETRY=1` for explicitly simulated permission/pose/camera-identity calibration coverage in the browser harness. Sensor fixtures are not real hardware evidence.
