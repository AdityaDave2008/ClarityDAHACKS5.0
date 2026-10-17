# Model-first startup (#37)

The native scanner now presents its model-loading screen before constructing the camera session. The browser scanner reports accessible loading status before requesting a media stream. Neither scan-start path hides an already-running camera behind a loading overlay. Explicit browser Settings camera-permission/test actions and the retained backend demo remain separate utilities; this change gates the local scanner’s Start flow.

## Requirement-to-evidence map

| Requirement | Check and observed result | Boundary |
| --- | --- | --- |
| Model and runtime ready before camera | Executable `ModelFirstStartupTests.swift` holds readiness unresolved and observes no authorization/capture calls; release produces model → permission → capture. Browser deferred-model unit tests assert zero `getUserMedia` calls until readiness. | Production orchestration with controlled dependencies; physical camera acceptance is separate. |
| Honest loading, Cancel and Retry | Native view wiring checks loading text, progress indicator and controls. Real hosted browser assertions and screenshots verify loading/error panels, status and Cancel/Retry inside desktop and mobile viewports. | Native visual/VoiceOver behavior requires a reachable phone. |
| Failure and permission denial keep capture off | Native executable coordinator covers throwing loader and denied authorization. Browser controller tests cover failure, timeout and retry. | Does not simulate Apple's actual permission dialog. |
| Cancellation, background and stale completion | Native executable coordinator checks cancellation/superseding generations before permission and capture. Browser lifecycle tests cover cancel, background and navigation. Native callback publication is generation-fenced. | Device suspension timing remains a physical check. |
| Safe warm reuse and no concurrent initialization | Ten actual lightweight WebKit lifecycle cases pass, including warm acknowledged reset, concurrent-start rejection, canceled/failed cleanup and retry. JS reset behavior tests pass. | Built-app WebKit also preserved the exact WK and ONNX model identities across a warm reset, with confirmation/cooldown reset. |
| Missing/corrupt/offline model | Built-app WebKit smoke passed missing/corrupt model rejection, repaired-asset retry and blocked remote fetch. Real browser smoke passed offline fresh COCO inference. | No claim based only on source inspection. |
| Installed web clients receive new startup | Service-worker v13 precache and migration test removes v12/v11 while preserving unrelated caches. | Existing HTTPS preview redeployed as `f555a245-6631-4e80-b63a-6b4b101b21e6`; hosted startup, source parity, cache migration and online/offline real-model acceptance all passed. |

## Validation status

Integrated tests pass: **27 backend, 243 frontend and 39 Worker**, with zero failures/skips, plus JavaScript syntax checks. All **68 native tests pass with zero skips**, including compiled app-icon validation. The actual `MyEyes.xcodeproj` / `Clarity` target builds successfully for generic iOS with signing disabled. Final compiler output has no Swift source warnings (only the expected unused AppIntents metadata extraction notice).

The WebKit smoke used assets from that built `Clarity.app`, not an alternate model copy. Cold readiness took 0.484 seconds and acknowledged warm reset 0.001 seconds on this Mac. These are host measurements, not promised phone startup times. It also passed a real 15-second inference timeout followed by recovery and 120 fresh inferences. Model weights, confidence threshold and class support were not changed.

Initial real browser startup checks held the actual model JSON request, observed zero camera requests, canceled loading and released the request without activating capture. A subsequent Start reused the loaded model and completed inference. Aborting the real model request showed Retry/Cancel with the camera off; retrying after restoring the request succeeded. Visual review then caught that the loading status and controls were below the viewport; a fixed loading/error panel now keeps status and Cancel/Retry inside both 390×844 and 1280×800 viewports. Real-model local smoke asserts these bounds and no active camera behind the panel. The corrected mobile loading and desktop error screenshots were visually reviewed. Final hosted startup and real-model checks passed on Chrome 155 under Node 24.16.0, including the same desktop/mobile viewport assertions. Seven served files matched checkout bytes: `camera.js`, `standalone.js`, `index.html`, `homePage.css`, `local-detector.js`, `logic.js` and `sw.js`. Real COCO cat confidence remained 0.927932858 online and offline; Start/Stop/restart completed inference without uploads. These checks use synthetic camera input, not a physical phone.

## Device limitation

At 18:18 UTC on October 17, 2026, `xcrun devicectl list devices` reports both paired physical phones unavailable. No signed install, actual camera-permission dialog, VoiceOver interaction or on-device LiDAR behavior is claimed. The existing wireless setup instructions are in [WIRELESS_TESTING.md](../samples/ios/WIRELESS_TESTING.md).

## Reproduction

```sh
npm run check
npm test
CLARITY_BUILT_APP=/path/to/Clarity.app npm run test:native
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
  node scripts/model-startup-browser-smoke.mjs
```

Native runtime reproduction uses `samples/ios/tests/OfflineInferenceSmoke.swift` with the built app's `OfflineDetector` directory and the documented licensed cat fixtures. Retained local logs are under `~/.jcode/scratch/issue37-20261017/` and `~/.jcode/scratch/issue37-runtime/`.

## Published browser

[Open the HTTPS judging preview](https://stepsense-yolox-v2-preview.stepsense-dahacks.workers.dev/). Deployment `f555a245-6631-4e80-b63a-6b4b101b21e6` uses cache `myeyes-pwa-v13-model-first-screen`. The initial hosted harness timed out at 45 seconds while HTTP-200 model shard bodies were still downloading. A diagnostic rerun passed unchanged; the final harness bounds model readiness at the same 120 seconds as the application, retains 45-second UI/navigation bounds, and passed. The red log is preserved rather than counted as a pass. No production timeout, confidence threshold or weights were changed.
