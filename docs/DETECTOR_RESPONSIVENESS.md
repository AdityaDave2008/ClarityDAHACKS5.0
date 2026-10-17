# Detector responsiveness audit, issue #30

## Current integration status: upstream COCO retained

Upstream commit `7be09a5` intentionally restored the browser's packaged **COCO-SSD lite_mobilenet_v2** through TensorFlow.js WASM and removed the experimental YOLOX candidate assets. The merge preserves that decision: the exported COCO `loadModel`, default confidence threshold **0.6**, and **640 px maximum capture side** remain unchanged from upstream. Only scheduling and cancellation safeguards are ported. No candidate assets or imports are restored.

Current COCO measurements are reported separately below. The retained historical YOLOX section cannot establish COCO speed, confidence or accuracy. The generic benchmark uses the exported `loadModel`, shares one warmed model between both detector variants, records actual inference thresholds and fingerprints served runtime/model assets. Its current-COCO browser execution passed on October 17, 2026.

## Change and boundaries

The local detector previously slept **90 ms after every inference**, so capture starts were separated by inference time plus 90 ms. The backend already subtracts work time from its target interval. The local loop now targets **90 ms between capture starts**, while always yielding at least **16 ms after a successful result**. Stale, failed or unavailable-video iterations retain the previous full retry delay. The 16 ms timer is an opportunity for UI work, not a promise of a displayed frame.

Scheduling still happens only after the current inference and result callbacks complete. There is no interval timer or captured-frame queue: the next iteration draws the then-current video. Existing cancellation, 2500 ms result freshness, streak breaking, two-observation confirmation and cooldown rules remain unchanged. A follow-up review reproduced an existing cross-start race with deferred asynchronous inference: five rapid PiP hide/show or Stop/Start cycles created six simultaneous calls, although old results were correctly suppressed. A per-adapter inference promise now serializes **all starts of the same adapter**, waits before timestamping or capturing a fresh frame, skips aborted/stopped waiters, and releases the slot on success or rejection. Stop remains synchronous and never waits for the model. Distinct adapter instances sharing the singleton model are not globally serialized. The app uses one adapter. A hung model can still prevent future inference on that adapter until it settles, but cannot delay camera Stop.

Only `frontend/local-detector.js` changes production behavior. The scheduling port does not alter upstream camera/PiP code, COCO model, threshold, capture resize, supported class set, network path, financial configuration, training data or training process. No deployment or push was performed by this task.

## Current COCO measurements

Measured at 08:33 UTC on October 17, 2026, on Apple M4/macOS arm64, Node 24.16.0 and isolated headless Chromium 131.0.6778.33. The actual packaged **COCO-SSD lite_mobilenet_v2**, TensorFlow.js **4.22.0**, and single-threaded **WASM** backend ran through the production detector and policy. Both variants shared one model loaded through the current exported `loadModel`, with five warmups before ABBA. The before variant was the exact upstream `7be09a5` detector source. Neither model, threshold nor capture preprocessing changed between variants.

**80 frames × four runs = 320 real COCO inferences.** Source was the existing lossless 224×224 cat PNG, not a physical camera. All times are milliseconds.

| Run order | Mean capture-start interval | p95 interval | Mean capture/inference processing | Mean scheduled idle | rAF gap mean / p95 |
|---|---:|---:|---:|---:|---:|
| Before A | 139.9 | 142.4 | 48.0 | 90.0 | 19.3 / 33.4 |
| After B | 91.4 | 92.2 | 38.8 | 51.1 | 18.1 / 33.3 |
| After B | 91.6 | 92.4 | 35.7 | 54.3 | 17.6 / 33.3 |
| Before A | 136.2 | 141.6 | 44.4 | 90.0 | 18.3 / 33.3 |

The pooled mean capture-start interval was **138.0 ms before versus 91.5 ms after**, approximately **33.7% shorter** in this controlled-fixture run. This supports a current-COCO **scheduling/cadence improvement on this host**, not a model-compute speedup or universal phone latency claim. Processing time also varied across runs despite the identical shared model. CPU frequency, browser scheduling and thermal state were not controlled. The rAF p95 remained approximately **33.3 ms** in all runs: there is **no established preview/PiP smoothness improvement**. Higher inference frequency may increase power use.

All 320 outputs were exactly equal, including cat confidence **0.927932858467102**, normalized box and zone membership. Every actual inference used threshold **0.6**, and every run had at most one pending frame timer. The benchmark observed no page errors or external/non-GET requests. These assertions passed without changing scores or thresholds. This positive fixture is runtime/geometry compatibility evidence, not accuracy evaluation.

Separate compact evidence: [`scripts/measurements/detector-cadence-coco-2026-10-17.json`](../scripts/measurements/detector-cadence-coco-2026-10-17.json). Raw starts, latency, delay and rAF arrays are preserved in the local overnight validation artifact `detector-cadence-coco-30.json`. The JSON records ten actual served asset hashes, including all five model weight shards; those hashes were independently checked against the packaged files after the run.

- Graph `/vendor/model/model.json`: SHA256 `3770b2528339b1e3340cb74360e1e40401816b009779aeb8d0cce3a4353ea3a9`.
- Served detector source: SHA256 `74db3eb2d8d845c8476c6bb14871c457988e459ab9c369c05084d5d173d2044b`.
- Upstream before source: SHA256 `5b58e11c6e00f8d1893f4754669167f291754db84222b00b647fc8434d587677`.
- Existing fixture: SHA256 `216d581e709e29c03197a9f30f5656676dfe91672f3f873b91ceef64ca6d14d0`. Source/license notes are retained in the fixture section below; no image was newly distributed.

## Historical YOLOX candidate measurements (not current COCO)

Measured on an Apple M4, macOS arm64, isolated headless Chromium 131.0.6778.33. The repeated run used Node 24.16.0. The first exploratory run used Node 22.22.3, which is below the project's declared Node minimum. The same Chromium runtime performed inference in both runs.

Each measurement uses the actual bundled ONNX Runtime WASM and production candidate adapter, decoder, assessment policy and local loop. It compares the baseline detector source from commit `6f811f2` with the changed source via a same-origin test-only route. Service workers and all non-local/non-GET requests are blocked. Five real inference warmups precede an ABBA sequence. Results are from a static image source with video dimension properties, not a physical video camera.

**Historical candidate code, including the cross-start gate: 40 frames per run, 160 real inferences.** All timing values below are milliseconds. The two before/after samples remain separate rather than suggesting a controlled hardware benchmark.

| Run order | Mean capture-start interval | p95 interval | Mean capture/inference processing | Mean scheduled idle | rAF gap mean / p95 |
|---|---:|---:|---:|---:|---:|
| Before A | 129.7 | 131.3 | 37.7 | 90.0 | 18.4 / 33.3 |
| After B | 91.7 | 92.8 | 37.9 | 52.1 | 18.2 / 33.3 |
| After B | 91.3 | 92.3 | 39.9 | 50.1 | 18.3 / 33.3 |
| Before A | 140.4 | 142.4 | 48.1 | 90.0 | 19.0 / 33.3 |

The mean capture-start interval across these equally sized final-code samples went from **135.0 ms to 91.5 ms**, about **32% shorter**. This demonstrates a scheduling improvement on this host, **not a model-compute speedup or phone-performance guarantee**. Inference times varied, and the machine was not a controlled thermal/CPU-frequency environment. Earlier cadence-only runs also improved capture intervals: a 160-frame run measured 166.4/175.5 ms before versus 91.1/91.6 ms after, and a 320-frame repeat measured 169.6/183.4 ms before versus 99.9/91.3 ms after (46% shorter in aggregate). Another 40-frame run verified source-hash metadata before the cross-start follow-up. All four runs are preserved separately in the measurement JSON.

Across all **680 measured inferences**, the positive fixture's output was identical, including cat confidence **0.7931427443873815**, normalized box and zone membership. At most one future timer existed in every run. No page errors or external/upload requests occurred. These assertions fail the benchmark on violation.

The rAF heartbeat is only a main-thread scheduling proxy. Its mean gap worsened in one earlier after run even though cadence improved. The final-code p95 rAF gap was unchanged at 33.3 ms. **No claim of improved preview/PiP smoothness is supported.** Initial rAF maximum gaps also include browser scheduling/startup effects. The model still performs single-threaded WASM on the main thread. More frequent inference may increase power/thermal load.

Compact machine-readable summaries, exact model/fixture/source hashes and quantiles are in [`scripts/measurements/detector-cadence-2026-10-17.json`](../scripts/measurements/detector-cadence-2026-10-17.json). Raw timestamp arrays are preserved in the local overnight run's validation artifacts, not committed.

### Historical model and fixture identity

- Model at measurement time: experimental fine-tuned YOLOX-Nano, then bundled as `frontend/vendor/yolox-51661711/candidate.onnx`. Upstream has since removed this asset.
- SHA256: `516617114420ce3c2bac545869ee91bac8ff7a63e148a73afdb12f126433fab4`.
- Unchanged threshold: `0.7874982953071594`.
- Fixture source: TensorFlow tfjs-models [COCO-SSD demo cat photograph](https://github.com/tensorflow/tfjs-models/blob/master/coco-ssd/demo/cat.jpg), already used by this repository's real-model validation. Upstream repository license is Apache-2.0. No separate photographer/license assertion is made, and no image is newly bundled or redistributed.
- Exact tested fixture: existing OpenCV-decoded lossless 224×224 PNG, SHA256 `216d581e709e29c03197a9f30f5656676dfe91672f3f873b91ceef64ca6d14d0`.
- A native browser JPEG decode is not an interchangeable positive fixture: rounding can shift this borderline example below threshold. A different transform/fixture must be identified separately rather than lowering the threshold to pass.

## Confidence and training audit

The historical YOLOX scores were model objectness multiplied by class probability. The current COCO adapter preserves the upstream detector scores without transformation. They are not calibrated safety probabilities, training accuracy or the likelihood of a clear path. No score inflation or threshold reduction was used for these timings.

[`training/RESULTS.md`](../training/RESULTS.md) reports that the fine-tuned candidate underperformed the pretrained baseline on the same tuning split: mAP50:95 **25.296% versus 26.657%**, and recall at their separately selected high-precision operating points **18.664% versus 21.865%**. The selected baseline's final test achieved **93.230% precision and 20.794% recall**, not the requested 93.5% target. The final test is separate from this project's tuning/fine-tuning data but not necessarily independent of upstream pretrained model selection.

At the time of those measurements the browser packaged the underperforming **experimental candidate**, as its then-present provenance stated. This task did not select or promote it. The subsequent upstream revert restores the established COCO-SSD model, not the separately evaluated pretrained YOLOX baseline; the YOLOX training precision/recall table must not be attributed to COCO-SSD. These fixture tests measure runtime compatibility, not general accuracy. Existing 16-class filtering further limits available detections. No stairs/curbs/potholes/hazard-coverage claims are warranted. No training, test-set tuning, RunPod resources or spending occurred.

## Current COCO reproduction and checks

Use Node 24+ and an existing Playwright installation with Chromium. No dependency installation or paid service is required by the script. Supply the exact previously prepared licensed fixture outside the repository.

```sh
# Terminal 1
PORT=5191 node frontend/server.js

# Terminal 2. Save original source outside the repository.
git show 7be09a5:frontend/local-detector.js > "$JCODE_SCRATCH_DIR/detector-before-coco-30.js"
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
DETECTOR_FIXTURE=/absolute/path/to/cat-lossless.png \
BASELINE_DETECTOR="$JCODE_SCRATCH_DIR/detector-before-coco-30.js" \
CADENCE_FRAMES=80 \
node scripts/detector-cadence-benchmark.mjs > "$JCODE_SCRATCH_DIR/detector-cadence-coco.json"

node --test frontend/local-detector.test.js
npm --prefix frontend test
npm --prefix frontend run check
git diff --check
```

Historical pre-merge validation: three new cadence cases first failed against the old implementation (90 ms observed instead of expected 70/16/16 ms), then passed after the change. The local suite has 25 passing tests, including pending-inference serialization, latest-frame capture, stop suppression, stale/error full retry delay, tuned confidence and alert behavior. The four cross-start tests also failed before the gate, including maximum concurrent calls of six instead of one, then passed. They exercise the real CameraFeature controller with deferred model inference, rapid PiP hide/show and Stop/Start, rejection release, cancelled waiters and capture timestamps after waiting. The full frontend suite passed 217 tests at final verification. The real packaged-model browser smoke also passed after the gate: prior-cache removal, positive inference/policy, fake-camera UI restart, offline reload, corrupt-model rejection/retry and no uploads. A peer independently reviewed the gate and passed 66 detector/camera/PiP tests.

The merged COCO detector currently passes all **25 focused unit tests**, including a new preservation check that confidence 0.59 is excluded, confidence 0.6 is retained, and a 1280×720 source captures at 640×360. The combined detector/camera/PiP unit run passed 66 tests. Current COCO browser timing and asset identity verification also passed as described above. Complete integrated-suite and extended-soak validation are coordinator-owned. The 217-test and candidate real-model smoke results above describe the earlier candidate revision only.

## Remaining physical-device acceptance gaps

1. Actual iPhone Safari and Android Chrome live camera, typical 720p/1080p frame sizes, motion, orientation and low light. This fixture is only 224×224 and excludes capture/decode latency.
2. Real video/PiP presentation timestamps, user input latency, background/foreground, Stop/restart during slow inference and OS interruptions. The benchmark does not validate the app's full camera lifecycle.
3. Sustained thermal and battery behavior with faster cadence, and concurrent opt-in depth processing. A 16 ms yield prevents a tight loop but does not bound main-thread inference cost.
4. Field detection accuracy, misses, false positives, alert accessibility and independent licensed evaluation scenes. Identical output on one cat image is not evidence of improved accuracy or safe navigation.
