# Prototype 1 — Alpha (α)

Integration verified October 16, 2026 (PDT). This release combines native work from `popup-new-system` at `664ac4c` with the fetched team `main` at `2fd573a`, preserving both without merge conflicts. The release name identifies the main merge commit, not a separate tag or deployment.

## Implemented architecture

- **Native Swift app:** `samples/ios/StepSense.xcodeproj`, target/scheme **StepSense**, entrypoint `StepSenseApp`. The historical sample directory contains the actual Swift app. Camera frames, bundled pretrained COCO-SSD inference, alert decisions, local preferences, PiP and optional LiDAR remain on-device. `ScanModel` does not construct the legacy network client. No native camera or LiDAR upload is added by this merge.
- **Website/browser:** `frontend/` retains the team's website and browser camera UI. Its production adapter uploads frames through the same-origin frontend proxy to the existing Fastify detection API. This browser flow is not offline.
- **Existing backend:** health, model readiness/metadata, ephemeral detection sessions, session preferences and frame inference. Sessions are in-memory bearer capabilities, not accounts, and disappear on restart.

## Intended architecture and explicit blocker

For the native app, only app/account features are intended to use a backend. Camera detection and LiDAR must remain offline. **Account integration is not implemented in this Alpha.** There are no account, login, authentication, durable profile or account-preference APIs in the current backend. See [the API contract](api.md) and [backend scope](../backend/README.md). The existing Swift app has scanner settings, not an account flow.

Connecting native account features requires an approved identity/authentication and account API contract, plus the corresponding backend implementation. This merge adds neither invented authentication nor a health-only connection presented as account integration.

## Verification on the merged tree

| Check | Result |
| --- | --- |
| `npm run check` | Passed backend/frontend/script syntax checks |
| `npm --prefix backend test` | 27 passed |
| `npm --prefix frontend test` | 41 passed |
| `node --test samples/ios/tests/*.test.mjs` | 50 passed, including executed production Swift depth estimator and diagnostics tests; other checks include source wiring and asset integrity |
| Release iOS build, generic iOS destination, `CODE_SIGNING_ALLOWED=NO` | Build succeeded; AppIntents metadata extraction warning because there is no AppIntents dependency |
| Production Swift bridge/WKWebView/WASM smoke | Passed real bundled-model inference, confirmation/cooldown, stale suppression, cancellation/restart, malformed-image recovery, single-flight, 15-second timeout and blocked remote fetch; cat confidence 0.9304 |
| `npm --prefix backend run smoke:model -- /path/to/cat.jpg` | Real WorkerDetector/API inference passed; cat confidence 0.9279, second frame triggered |
| Production browser adapter → actual HTTP frontend proxy → Fastify → real COCO-SSD | Confirmed alert, abort cleanup DELETE and deleted-session 404 passed using the existing non-camera cat fixture instead of live canvas capture |
| `git diff --cached --check` | Passed |

The one-off HTTP smoke initially failed because its `node --input-type=module` invocation propagated an incompatible flag into file-based workers (`ERR_INPUT_TYPE_NOT_ALLOWED`). Removing that test-runner flag passed without changing production code. The HTTP check substitutes camera capture and does not establish a live browser/device-camera acceptance result. Native runtime smoke instructions are in the [iOS README](../samples/ios/README.md).

## Limitations

- LiDAR sensor accuracy, physical alignment and object-associated depth remain **unverified**. Numeric center-surface samples are not reference-distance acceptance. No pending calibration redesign is included.
- Models are pretrained; there is **no custom-trained model**. Supported classes do not cover every obstacle. No alert does not establish a safe path.
- PiP camera behavior depends on platform support and permissions. Background object alerts are not guaranteed. The `voip` background mode is a prototype choice, not an App Store eligibility claim.
- No phone installation, physical sensor retest, account integration, deployment or release tag was performed for this merge.
