# Branch integration record

As of October 17, 2026, all other fetched remote branches are integrated into `feat/cloudflare-worker`. Main and webpage were merged before `cf2e40f`, followed by the latest main update reported by the coordinator. This describes fetched refs, not future remote changes.

The seven-commit `origin/feature/iphone-pip-test` branch ends at `8203fdb` and has unrelated history. It was **selectively ported, not merged wholesale**. Its native offline detector, PiP, camera recovery, LiDAR, bundled models and regression tests already exist under `samples/ios/MyEyes`. Its older StepSense project and browser implementation are superseded by the current Clarity app, deployment and model pipeline.

## Retained additions

- `.github/workflows/ios-pip.yml`: native regression and unsigned simulator CI, adapted to `MyEyes.xcodeproj`, the actual `Clarity` scheme and `Clarity.app` product.
- `samples/ios/tests/lidar-depth.test.mjs`: portable URL-to-filesystem conversion, retaining current source paths.
- `frontend/tracking.js`, `frontend/tracking.test.js`, and `docs/TRACKING.md`: standalone tracker, tests and attribution. **Not imported by the live camera or alert pipeline.** No runtime behavior changes.
- `docs/IPHONE_PIP.md`, `docs/ZIP_UPDATE_REVIEW.md`, `docs/SENSOR_FUSION.md`, `docs/TESLA_AND_NO_LIDAR_RESEARCH.md`, `docs/HACKATHON_RESEARCH.md`, and `docs/REVIEW_CODEX_2026-10-16.md`: historical references with explicit provenance notes. Historical test counts, outdated architecture descriptions and research proposals are not current acceptance claims.

Existing frontend, backend, Android, native signing, Cloudflare worker and training code were preserved. The old MediaPipe/EfficientDet browser stack and replacement UI were not imported. Git history intentionally continues to show the unrelated native branch as unmerged.

## Validation

`node --test frontend/tracking.test.js samples/ios/tests/*.test.mjs`: 56 passed, zero failed or skipped on macOS, including real Swift depth and diagnostics checks. Project and shared scheme confirm the CI product paths. No simulator build was run for this port. Tests do not establish physical-iPhone camera, background inference, PiP rendering or LiDAR accuracy. The standalone tracker requires separate integration and acceptance before activation.
