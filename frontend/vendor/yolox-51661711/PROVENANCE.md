# Experimental browser YOLOX candidate

Actual fine-tuned YOLOX-Nano from training snapshot `20261017T064826Z-ed6a958c`, exported as `candidate-export/pretrained-static.onnx`. Packaged here as `candidate.onnx`, SHA-256 `516617114420ce3c2bac545869ee91bac8ff7a63e148a73afdb12f126433fab4`. Exact assets and ONNX Runtime Web **1.20.1** are pinned in ASSETS.json. Model integrity is checked before session creation.

Candidate default threshold: **0.7874982953071594**. This is not the selected baseline threshold. The fine-tuned candidate underperformed the pretrained baseline on evaluation. Experimental testing only, not a navigation aid or safety-certified model. Release grouping under v1 does not change the model's candidate identity.

The adapter uses direct video canvas RGBA without JPEG, explicit half-pixel bilinear resize, float32 BGR CHW `[1,3,416,416]`, top-left padding114, decoded `[1,3549,85]` output, objectness times class probability, class-aware NMS IoU0.65 and inverse geometry. Existing preserve16class policy, image-zone heuristic, two-frame confirmation, cooldown and stale/error streak breaking remain. Alerts and optional depth stay independent.

Pixel rounding differs from OpenCV fixed-point INTER_LINEAR by up to1 in tested pixels. Native JPEG decoding differed from OpenCV and could move a borderline example below threshold. Browser video avoids JPEG encode/decode, but cross-browser preprocessing equivalence is not established. A lossless cat fixture produced score0.7931427443873815 in Chromium and the native reference. This proves runtime/fixture compatibility, not field safety or improved accuracy. Empty detections never imply a clear path.

Runtime license: ONNX-RUNTIME-LICENSE.txt. YOLOX upstream architecture is Apache-2.0. Training dataset provenance and evaluation remain in the training artifact model contract. Camera frames never go to the model-download service. All object inference runs locally using single-thread WASM. First use caches about15MB of runtime/model assets for offline detection. Optional depth has its own opt-in download and availability limits.
