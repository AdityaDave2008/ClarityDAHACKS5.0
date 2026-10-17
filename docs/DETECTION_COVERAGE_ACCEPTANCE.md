# v2 detection coverage evidence (2026-10-17)

Real ONNX Runtime 1.31 CPU inference on the shipped
`samples/ios/MyEyes/OfflineDetector/candidate.onnx`, using the app's exact
preprocessing contract (BGR, [0,255], 416x416, top-left pad 114) and the app's
decode (objectness x class prob, class-aware NMS 0.65).

## Per-scene reproduction of the reported symptom

| image | model found @0.7875 | app showed @0.7875 |
|---|---|---|
| desk.jpg | stop sign:0.96 | nothing |
| kitchen.jpg | nothing (bear:0.78 at 0.60) | nothing |
| street.jpg | tv:0.90 | nothing |
| living-room.jpg | cat:0.82, bed:0.79 | cat only |
| people.jpg | bed:0.89, potted plant:0.81 | potted plant only |

## Threshold sweep, 300 COCO val2017 images, 1,990 ground-truth objects

Greedy per-class matching at IoU >= 0.50.

| threshold | scope | TP | FP | precision | recall | det/img |
|---|---|---:|---:|---:|---:|---:|
| 0.7875 | all 80 | 406 | 42 | 0.906 | 0.204 | 1.49 |
| 0.7875 | old 16 | 238 | 20 | 0.922 | 0.229 | 0.86 |
| 0.60 | all 80 | 665 | 137 | 0.829 | 0.334 | 2.67 |
| 0.50 | all 80 | 747 | 248 | 0.751 | 0.375 | 3.32 |
| **0.45** | **all 80** | **785** | **315** | **0.714** | **0.394** | **3.67** |
| 0.35 | all 80 | 866 | 489 | 0.639 | 0.435 | 4.52 |
| 0.25 | all 80 | 956 | 791 | 0.547 | 0.480 | 5.82 |

Selecting 0.45 with the full 80-class vocabulary raises recall from 0.204 to
0.394 and per-image detections from 1.49 to 3.67, at 0.71 precision. It matches
the browser app's long-standing 0.45 default, so the two surfaces agree.

## Class reachability

The shipped policy exposed 16 of the model's 80 trained classes. The 64 hidden
classes covered 7,969 of 18,056 tuning objects and 1,368 true positives that the
model had already found correctly at the old default.

## Honest limits

COCO domain only, not the app's real camera domain. Precision is not accuracy.
Lower thresholds admit more false positives: 315 versus 42 across 300 images.
The model still has no stairs, curbs, potholes, cables or generic-obstacle class,
and an empty result never means a clear path.

## Reproduce

Needs `onnxruntime`, `numpy` and `pillow` in a local virtualenv. No GPU, no
training, no model change: the shipped `candidate.onnx` is used as-is.

```sh
python3 -m venv .venv && .venv/bin/pip install onnxruntime numpy pillow
# Per-scene comparison across thresholds
.venv/bin/python scripts/probe.py samples/ios/MyEyes/OfflineDetector/candidate.onnx IMAGE.jpg
# Precision/recall sweep; downloads COCO val2017 annotations and images into scripts/
.venv/bin/python scripts/sweep.py samples/ios/MyEyes/OfflineDetector/candidate.onnx 300
```

## What changed

- `backend/alerts.js` `SUPPORTED_LABELS` now lists all 80 COCO classes, and the
  bundled native `policy.js` is regenerated verbatim from it, as its test requires.
- The native default confidence is `ScanPreferences.candidateConfidenceDefault`
  (0.45), matching `yolox.js`, `ASSETS.json` and `model-contract.json`.
- `samples/ios/tests/detection-coverage.test.mjs` fails if any trained class
  becomes unreachable again, if the decoder and policy vocabularies diverge, or
  if the default threshold returns to a suppressive value.

## Not verified

No physical iPhone run was performed for this change. On-device camera behavior,
alert rate in real scenes and user-perceived false-positive load still need
device testing. The web app already used the full label set and 0.45, so this
aligns the native app with it rather than introducing a new web behavior.
