# Detector responsiveness audit, issue #30

## Change and boundaries

The local detector previously slept **90 ms after every inference**, so capture starts were separated by inference time plus 90 ms. The backend already subtracts work time from its target interval. The local loop now targets **90 ms between capture starts**, while always yielding at least **16 ms after a successful result**. Stale, failed or unavailable-video iterations retain the previous full retry delay. The 16 ms timer is an opportunity for UI work, not a promise of a displayed frame.

Scheduling still happens only after the current inference and result callbacks complete. There is no interval timer, frame buffer or queue: the next iteration draws the then-current video. Existing cancellation, 2500 ms result freshness, streak breaking, two-observation confirmation and cooldown rules remain unchanged. This is single-flight within each detector start, not a new global cross-session inference scheduler.

Only `frontend/local-detector.js` changes production behavior. No camera/PiP code, model, threshold, preprocessing, supported class set, network path, financial configuration, training data or training process was changed. No deployment or push was performed by this task.

## Actual packaged inference measurements

Measured on an Apple M4, macOS arm64, isolated headless Chromium 131.0.6778.33. The repeated run used Node 24.16.0. The first exploratory run used Node 22.22.3, which is below the project's declared Node minimum. The same Chromium runtime performed inference in both runs.

Each measurement uses the actual bundled ONNX Runtime WASM and production candidate adapter, decoder, assessment policy and local loop. It compares the baseline detector source from commit `6f811f2` with the changed source via a same-origin test-only route. Service workers and all non-local/non-GET requests are blocked. Five real inference warmups precede an ABBA sequence. Results are from a static image source with video dimension properties, not a physical video camera.

**Primary repeat: 80 frames per run, 320 real inferences.** All timing values below are milliseconds. The two before/after samples remain separate rather than suggesting a controlled hardware benchmark.

| Run order | Mean capture-start interval | p95 interval | Mean capture/inference processing | Mean scheduled idle | rAF gap mean / p95 |
|---|---:|---:|---:|---:|---:|
| Before A | 169.6 | 223.8 | 78.2 | 90.0 | 23.9 / 66.7 |
| After B | 99.9 | 148.0 | 73.4 | 24.7 | 29.1 / 66.7 |
| After B | 91.3 | 92.6 | 57.6 | 32.4 | 23.7 / 50.0 |
| Before A | 183.4 | 228.3 | 91.0 | 90.0 | 24.8 / 83.3 |

The mean capture-start interval across these equally sized samples went from **176.5 ms to 95.6 ms**, about **46% shorter**. This demonstrates a scheduling improvement on this host, **not a model-compute speedup or phone-performance guarantee**. Inference times varied, and the machine was not a controlled thermal/CPU-frequency environment. The earlier 160-frame run also improved cadence (166.4/175.5 ms before versus 91.1/91.6 ms after). A final 40-frame run verified the finished measurement script including source-hash metadata.

Across all **520 measured inferences**, the positive fixture's output was identical, including cat confidence **0.7931427443873815**, normalized box and zone membership. At most one future timer existed in every run. No page errors or external/upload requests occurred. These assertions fail the benchmark on violation.

The rAF heartbeat is only a main-thread scheduling proxy. Its mean gap worsened in one after run even though cadence improved. **No claim of improved preview/PiP smoothness is supported.** Initial rAF maximum gaps also include browser scheduling/startup effects. The model still performs single-threaded WASM on the main thread. More frequent inference may increase power/thermal load.

Compact machine-readable summaries, exact model/fixture/source hashes and quantiles are in [`scripts/measurements/detector-cadence-2026-10-17.json`](../scripts/measurements/detector-cadence-2026-10-17.json). Raw timestamp arrays are preserved in the local overnight run's validation artifacts, not committed.

### Model and fixture identity

- Model: experimental fine-tuned YOLOX-Nano, bundled `frontend/vendor/yolox-51661711/candidate.onnx`.
- SHA256: `516617114420ce3c2bac545869ee91bac8ff7a63e148a73afdb12f126433fab4`.
- Unchanged threshold: `0.7874982953071594`.
- Fixture source: TensorFlow tfjs-models [COCO-SSD demo cat photograph](https://github.com/tensorflow/tfjs-models/blob/master/coco-ssd/demo/cat.jpg), already used by this repository's real-model validation. Upstream repository license is Apache-2.0. No separate photographer/license assertion is made, and no image is newly bundled or redistributed.
- Exact tested fixture: existing OpenCV-decoded lossless 224×224 PNG, SHA256 `216d581e709e29c03197a9f30f5656676dfe91672f3f873b91ceef64ca6d14d0`.
- A native browser JPEG decode is not an interchangeable positive fixture: rounding can shift this borderline example below threshold. A different transform/fixture must be identified separately rather than lowering the threshold to pass.

## Confidence and training audit

Scores remain model objectness multiplied by class probability. They are not calibrated safety probabilities, training accuracy or the likelihood of a clear path. No score inflation or threshold reduction was used for these timings.

[`training/RESULTS.md`](../training/RESULTS.md) reports that the fine-tuned candidate underperformed the pretrained baseline on the same tuning split: mAP50:95 **25.296% versus 26.657%**, and recall at their separately selected high-precision operating points **18.664% versus 21.865%**. The selected baseline's final test achieved **93.230% precision and 20.794% recall**, not the requested 93.5% target. The final test is separate from this project's tuning/fine-tuning data but not necessarily independent of upstream pretrained model selection.

The browser already packages the underperforming **experimental candidate**, as its provenance explicitly states. This task neither selected nor promoted it, and did not replace it with the baseline without a separate validated integration. These fixture tests measure runtime compatibility, not general accuracy. Existing 16-class filtering further limits available detections. No stairs/curbs/potholes/hazard-coverage claims are warranted. No training, test-set tuning, RunPod resources or spending occurred.

## Reproduction and checks

Use Node 24+ and an existing Playwright installation with Chromium. No dependency installation or paid service is required by the script. Supply the exact previously prepared licensed fixture outside the repository.

```sh
# Terminal 1
PORT=5191 node frontend/server.js

# Terminal 2. Save original source outside the repository.
git show 6f811f2:frontend/local-detector.js > "$JCODE_SCRATCH_DIR/detector-before-30.js"
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
CANDIDATE_FIXTURE=/absolute/path/to/cat-lossless.png \
BASELINE_DETECTOR="$JCODE_SCRATCH_DIR/detector-before-30.js" \
CADENCE_FRAMES=80 \
node scripts/detector-cadence-benchmark.mjs > "$JCODE_SCRATCH_DIR/detector-cadence.json"

node --test frontend/local-detector.test.js
npm --prefix frontend test
npm --prefix frontend run check
git diff --check
```

TDD evidence: three new cadence cases first failed against the old implementation (90 ms observed instead of expected 70/16/16 ms), then passed after the change. The local suite has 21 passing tests, including pending-inference serialization, latest-frame capture, stop suppression, stale/error full retry delay, tuned confidence and alert behavior. The full frontend suite passed 212 tests at verification time, including concurrent PiP worker additions.

## Remaining physical-device acceptance gaps

1. Actual iPhone Safari and Android Chrome live camera, typical 720p/1080p frame sizes, motion, orientation and low light. This fixture is only 224×224 and excludes capture/decode latency.
2. Real video/PiP presentation timestamps, user input latency, background/foreground, Stop/restart during slow inference and OS interruptions. The benchmark does not validate the app's full camera lifecycle.
3. Sustained thermal and battery behavior with faster cadence, and concurrent opt-in depth processing. A 16 ms yield prevents a tight loop but does not bound main-thread inference cost.
4. Field detection accuracy, misses, false positives, alert accessibility and independent licensed evaluation scenes. Identical output on one cat image is not evidence of improved accuracy or safe navigation.
