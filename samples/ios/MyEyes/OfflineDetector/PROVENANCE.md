# Experimental YOLOX-Nano candidate

This testing branch runs the actual fine-tuned candidate, not baseline weights or TFJS COCO-SSD.

- Artifact: `candidate-export/pretrained-static.onnx` from training snapshot `20261017T064826Z-ed6a958c`.
- Bundled as `candidate.onnx`, SHA256 `516617114420ce3c2bac545869ee91bac8ff7a63e148a73afdb12f126433fab4`.
- Candidate threshold **0.7874982953071594**, not selected baseline 0.705. Native preferences pass it explicitly. User adjustments remain supported and change the evaluated operating point.
- Fine-tuned candidate had worse mAP than baseline. Experimental testing only, no safety certification or navigation reliability claim.
- ONNX Runtime Web **1.20.1**, npm distribution `ort.wasm.min.js`, `ort-wasm-simd-threaded.mjs`, `ort-wasm-simd-threaded.wasm`. MIT license in `ONNX-RUNTIME-LICENSE.txt`. Single-thread WASM, proxy disabled. No CDN or runtime/model downloads.
- Model architecture: YOLOX-Nano (upstream YOLOX Apache-2.0). Training uses COCO categories. Dataset provenance/evaluation remains in the training artifacts, not a new quality claim.
- `ASSETS.json` pins exact deployed runtime/model/adapter hashes.

## Contract and limitations

`model-contract.json` defines BGR float32 [0,255], CHW [1,3,416,416], aspect-preserving resize with floor dimensions and top-left pad114. Decoded [1,3549,85] output uses center xywh, objectness times argmax class probability, class-aware external NMS IoU .65, then inverse resize.

Canvas only decodes the full-resolution image; explicit half-pixel bilinear code performs resizing. Uint8 rounding differs from OpenCV fixed-point INTER_LINEAR by at most 1 on tested pixels. More importantly, **WebKit JPEG decoding differs from OpenCV JPEG decoding**. On the known-cat fixture, Python/OpenCV score .794304 is above the tuned threshold while WebKit score .743190 is below it. Thus full-image operating-point equivalence is **not established**. Identical WebKit input tensors produce Python ONNX .7431902885 versus WebKit ONNX .7431903384, confirming runtime agreement (~5e-8 score difference), not preprocessing equivalence. Do not lower the default to hide this limitation.

The unchanged policy exposes only 16 labels from the 80-class model: person, bicycle, car, motorcycle, bus, truck, bench, cat, dog, backpack, handbag, suitcase, bottle, cup, chair, potted plant. It retains two matching frames, cooldown, stale/failure streak breaking and the image-zone heuristic. The model does not recognize stairs, curbs, potholes or cables. Empty results do not mean a clear path.

The native camera, LiDAR sequence/age checks, depth enrichment, PiP and alert modalities are preserved. The bundled JavaScript policy remains image-based. Native #38 proximity routing separately uses fresh matched depth, with unknown-depth fallback and out-of-range suppression; see [proximity acceptance](../../../../docs/PROXIMITY_ACCEPTANCE.md). Nonpersistent WKWebView + custom bundled scheme + restrictive CSP prohibit remote inference/resources. Original StepSense app and its settings remain installed separately for rollback.
