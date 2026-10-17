# Broad 80-class detector training

This is an isolated YOLOX-Nano 416×416 experiment. It does **not** replace the app's TensorFlow.js detector. A PyTorch/ONNX model cannot be dropped into that runtime directly.

## Scope and honest limits

The standard COCO 80-class head covers people, common vehicles, animals, furniture, bags, bottles, books and other everyday objects. It does **not** label stairs, curbs, potholes, uneven ground, construction machinery, safety PPE, cables or general obstacles. A road/classroom image is not a dedicated road/classroom class. This model is not a safety-certified navigation system.

The requested 93.5% is a **target precision operating point at IoU 0.50**, not a guaranteed overall accuracy or mAP. Threshold is selected on tuning data, with recall and COCO mAP50/mAP50:95 reported alongside it. A high threshold may attain high precision while missing most objects. If no threshold meets the target, this is reported honestly. No threshold or checkpoint selection may use final-test results.

## Reproducibility

- Upstream YOLOX tag `0.3.0`, commit `419778480ab6ec0590e5d3831b3afb3b46ab2aa3`, Apache-2.0 source.
- Official `yolox_nano.pth` release `0.1.1rc0`, strict load into unchanged 80-class Nano head. SHA256 recorded in `artifacts/pretrained-sha256.txt`.
- Python 3.12, torch 2.8.0+cu128, torchvision 0.23.0+cu128. Isolated venv inherits the pod's existing CUDA torch installation. Exact freeze saved in `artifacts/environment-freeze.txt`.
- Dataset seed `20261017`: 12,000 class-balanced replay images from COCO train2017. Every annotation in selected images is retained, not only a selected class. No claim that classes have equal object counts.
- COCO val2017 is shuffled once into 2,500 tuning and 2,500 final-test images, disjoint by image ID. Train comes from the official separate train2017 source. This does not establish scene-level independence or a new external-domain test. Official pretrained weights may already have been selected using COCO validation, so this is a held-out fine-tuning test, not a pristine never-seen benchmark.
- `coco/manifest.json` contains exact IDs and annotation SHA256. `image-sha256.jsonl` records image URLs and hashes. COCO annotation JSON preserves each image's source URL and license ID plus the license table. COCO image licenses vary individually and may include noncommercial/sharealike conditions. Review before redistribution or commercial use. Do not assume the annotation license grants image rights.
- Source archive: <https://s3.amazonaws.com/images.cocodataset.org/annotations/annotations_trainval2017.zip>. Official bucket path-style HTTPS avoids a certificate mismatch at the historical custom image hostname.

## Commands on the existing authorized pod

Working root is `/workspace/broad80`. No deployment is performed by these scripts.

```bash
python -m venv --system-site-packages .venv
.venv/bin/python -m pip install -r requirements.txt
# Clone exact YOLOX revision into YOLOX and obtain the official Nano checkpoint.
export PYTHONPATH="$PWD/YOLOX"
.venv/bin/python prepare_coco.py --root "$PWD/coco" --count 12000
.venv/bin/python smoke_export.py --checkpoint yolox_nano.pth --output artifacts/preflight
# Requires independent budget watchdog ARMED and complete data manifest.
bash run_training.sh
```

`run_training.sh` fixes batch64, FP16, 15 epochs, mild augmentation, conservative learning rate, per-epoch validation and checkpoints. It caps training at 7.5 hours or the earlier absolute authorized cutoff (2026-10-17 14:03 UTC). The external guard handles pod shutdown separately. The launcher does not itself stop billing. If interrupted, the latest complete epoch is retained. Checkpoints/logs/manifests must be mirrored off ephemeral storage by the coordinator's guard workflow.

The GPU smoke uses five synthetic batches only to validate finite loss/backprop, a fresh model checkpoint reload, static ONNX validity and CPU ONNX Runtime parity. Smoke weights are **not** the candidate model. Export restores the requested checkpoint after smoke updates. A successful smoke is not successful training.

Evaluate baseline and best fine-tuned candidate on tuning data:

```bash
.venv/bin/python evaluate.py --root coco --checkpoint yolox_nano.pth --output artifacts/baseline-tune
.venv/bin/python evaluate.py --root coco --checkpoint artifacts/broad80_nano/best_ckpt.pth --output artifacts/candidate-tune
# Freeze the checkpoint and threshold based only on tuning. Then run final test once.
.venv/bin/python evaluate.py --root coco --checkpoint CHOSEN.pth --split test_final \
  --frozen-threshold THRESHOLD --output artifacts/final-test
```

If fine-tuning underperforms baseline, preserve the original as preferred rather than pretending training improved quality. Final-test precision below 93.5% remains a failed target, even if tuning reached it. Evaluation is micro precision/recall over annotated COCO objects, crowd/ignored matches excluded, max100 detections per class/image as in COCOeval. Results do not establish performance on unlabelled hazards or this app's real camera domain.

## Local verification

```bash
python3 -m unittest discover -s training/tests -v
bash -n training/run_training.sh
```

Do not commit datasets, checkpoints, model binaries or credentials. Preserve original app code and model artifacts.
