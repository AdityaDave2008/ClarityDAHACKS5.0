# Broad80 training result: 2026-10-17

## Outcome

A real 15-epoch YOLOX-Nano fine-tune completed on the authorized RTX A5000. **It did not improve the pretrained baseline**, so the baseline was retained as the preferred exported model. The trained checkpoint and its ONNX export are preserved separately. **The final 93.5% precision target was not met.** No app model or inference deployment was changed.

Training started at 06:11:22 UTC and completed at 06:44:28 UTC, including two checkpoint-preserving compatibility recoveries. Final evaluation and both export checks completed by 06:46:59 UTC. At the verified $0.284/hour GPU-plus-container rate, the approximate rental cost from 06:03 through 06:47 is **$0.21**, not a provider invoice. The coordinator owns verified artifact mirroring and early pod shutdown.

## Data and metrics

- Train: 12,000 class-balanced COCO train2017 images, 109,880 annotations.
- Tuning: 2,500 val2017 images, 18,282 annotations.
- Final test: separate 2,500 val2017 images, 18,499 annotations.
- All 80 categories occur in every split. Every selected image's annotations were retained.
- Zero overlapping image IDs or identical SHA256 image contents across splits. This does not rule out near-duplicate scenes.
- Seed 20261017. Original source URLs, individual image-license IDs and license table are preserved in `artifacts/data-provenance.json`.

All table entries are percentages. Precision and recall are micro-averaged at IoU 0.50, with crowd/ignored objects excluded.

| Evaluation | mAP50:95 | mAP50 | Precision | Recall | Confidence threshold |
|---|---:|---:|---:|---:|---:|
| Pretrained baseline, tuning | 26.657 | 42.407 | 93.510 | 21.865 | 0.705157 |
| Best fine-tuned candidate, tuning | 25.296 | 41.156 | 93.507 | 18.664 | 0.787498 |
| Selected baseline, final test | 25.586 | 41.115 | **93.230** | **20.794** | **0.705157, frozen** |

Model selection used tuning mAP50:95 only. The selected threshold was frozen before the single final-test evaluation. No final-test retuning occurred. Final counts: **3,801 true positives, 276 false positives and 14,478 false negatives**, against 18,279 nonignored objects. High precision here misses roughly four-fifths of annotated objects. This is not 93.5% overall detection accuracy or a safety-performance claim.

The final split was held out from **our fine-tuning**, not a pristine external benchmark: official pretrained weights may already have been selected using COCO validation. Real classroom, construction and busy-street camera performance remains unvalidated.

## Relevant class regressions on the identical tuning split

AP is COCO AP50:95. Recall is measured at each model's independently tuning-selected global precision operating point, so the confidence thresholds differ. Support excludes ignored/crowd objects.

| Class | Support | Baseline AP | Candidate AP | Baseline recall | Candidate recall |
|---|---:|---:|---:|---:|---:|
| person | 5,534 | 38.92% | 37.75% | 34.24% | 28.21% |
| car | 902 | 19.70% | 18.51% | 12.86% | 9.53% |
| bicycle | 127 | 21.54% | 20.56% | 17.32% | 10.24% |
| truck | 180 | 22.64% | 20.96% | 11.67% | 11.11% |
| chair | 938 | 13.59% | 12.31% | 5.65% | 4.16% |
| book | 569 | 7.27% | 6.80% | 0.00% | 0.18% |
| traffic light | 294 | 13.30% | 12.21% | 10.20% | 6.80% |
| stop sign | 33 | 60.12% | 54.56% | 60.61% | 60.61% |

Full 80-class support, precision, recall, TP/FP/FN and AP tables are in the metric JSON files. These regressions are why the trained candidate was not promoted.

## Validation and preserved evidence

- 12 regression tests passed in the pinned GPU environment. Local standard-library/NumPy run passes 10 tests and skips the two environment-specific integration tests.
- Actual 32-image training / 8-image evaluation / atomic best-checkpoint cycle passed, separate from candidate selection.
- Real epoch-1 checkpoint reloaded successfully and had 538 changed state tensors versus pretrained weights. All 15 epochs subsequently completed.
- Trained candidate and selected baseline each passed fresh checkpoint reload, finite GPU forward/backward compatibility, ONNX checking and static CPU ONNX Runtime parity. Maximum absolute differences were 0.001159668 and 0.000976563 respectively.
- Atomic checkpoint publication protects periodic mirroring. `artifacts/completion-summary.json` records completion, model selection, class changes and critical hashes. `artifacts/model-contract.json` records the precise static input/output and class mapping.

| Artifact | SHA256 |
|---|---|
| Trained best PTH | `bd32c0a70780817fb9c3080f52564fb8e154a1968ff106c5967c1d436572484f` |
| Trained candidate ONNX | `516617114420ce3c2bac545869ee91bac8ff7a63e148a73afdb12f126433fab4` |
| Selected baseline PTH | `cd28f55fbbc1829f99d9ac9b38a16d259a22889739c8728ea877610201feff7b` |
| Selected baseline ONNX | `2f0f1eee1f4ea7cb07399925d8ee60cce2d5140fc6c62b7a5335cf55616246f3` |

## Remaining limitations

The unchanged COCO head does not detect stairs, curbs, potholes, cracks, uneven surfaces, traffic cones, helmets/PPE, cables, fire or smoke as dedicated classes. Adding these requires compatible, licensed, correctly annotated training data and a new label/head design, not relabeling arbitrary objects as hazards. The existing TensorFlow.js runtime cannot consume this ONNX model directly. No safety or broad hazard coverage is claimed.
