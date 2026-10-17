"""Measure the shipped candidate's precision/recall across thresholds on real COCO val2017.

Downloads nothing: uses images already fetched into images/ plus local annotations.
Matching is greedy IoU>=0.5 per class, mirroring the app's class-aware behavior.
"""
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

HERE = Path(__file__).parent
COCO = ["person","bicycle","car","motorcycle","airplane","bus","train","truck","boat","traffic light","fire hydrant","stop sign","parking meter","bench","bird","cat","dog","horse","sheep","cow","elephant","bear","zebra","giraffe","backpack","umbrella","handbag","tie","suitcase","frisbee","skis","snowboard","sports ball","kite","baseball bat","baseball glove","skateboard","surfboard","tennis racket","bottle","wine glass","cup","fork","knife","spoon","bowl","banana","apple","sandwich","orange","broccoli","carrot","hot dog","pizza","donut","cake","chair","couch","potted plant","bed","dining table","toilet","tv","laptop","mouse","remote","keyboard","cell phone","microwave","oven","toaster","sink","refrigerator","book","clock","vase","scissors","teddy bear","hair drier","toothbrush"]
OLD_WHITELIST = {"person","bicycle","car","motorcycle","bus","truck","bench","cat","dog","backpack","handbag","suitcase","bottle","cup","chair","potted plant"}


def preprocess(image):
    w, h = image.size
    ratio = min(416 / w, 416 / h)
    rw, rh = int(w * ratio), int(h * ratio)
    resized = np.asarray(image.resize((rw, rh), Image.BILINEAR), dtype=np.uint8)
    padded = np.full((416, 416, 3), 114, dtype=np.uint8)
    padded[:rh, :rw] = resized[:, :, ::-1]
    return padded.transpose(2, 0, 1)[None].astype(np.float32), ratio


def iou(a, b):
    x = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    y = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = x * y
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


def decode(raw, ratio, floor):
    rows = raw.reshape(-1, 85)
    cls = rows[:, 5:].argmax(axis=1)
    scores = rows[:, 4] * rows[:, 5:].max(axis=1)
    keep = scores >= floor
    items = []
    for row, c, s in zip(rows[keep], cls[keep], scores[keep]):
        cx, cy, bw, bh = row[:4] / ratio
        items.append((COCO[int(c)], float(s), [float(cx - bw / 2), float(cy - bh / 2), float(bw), float(bh)]))
    items.sort(key=lambda i: -i[1])
    kept = []
    for item in items:
        if any(k[0] == item[0] and iou(k[2], item[2]) > 0.65 for k in kept):
            continue
        kept.append(item)
    return kept


def main():
    model = sys.argv[1]
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 200
    ann = json.load(open(HERE / "annotations/instances_val2017.json"))
    cat = {c["id"]: c["name"] for c in ann["categories"]}
    by_image = {}
    for a in ann["annotations"]:
        if a.get("iscrowd"):
            continue
        by_image.setdefault(a["image_id"], []).append((cat[a["category_id"]], a["bbox"]))
    images = [i for i in ann["images"] if i["id"] in by_image][:limit]

    cache = HERE / "val-cache"
    cache.mkdir(exist_ok=True)
    session = ort.InferenceSession(model, providers=["CPUExecutionProvider"])

    floor = 0.05
    per_image = []
    for n, info in enumerate(images, 1):
        path = cache / info["file_name"]
        if not path.exists():
            try:
                urllib.request.urlretrieve(info["coco_url"], path)
            except Exception:
                continue
        try:
            image = Image.open(path).convert("RGB")
        except Exception:
            continue
        tensor, ratio = preprocess(image)
        raw = session.run(None, {"images": tensor})[0][0]
        per_image.append((decode(raw, ratio, floor), by_image[info["id"]]))
        if n % 25 == 0:
            print(f"JCODE_PROGRESS {json.dumps({'current': n, 'total': len(images), 'unit': 'images'})}", flush=True)

    print(f"\nEvaluated {len(per_image)} images, {sum(len(g) for _, g in per_image)} ground-truth objects\n")
    header = f"{'thresh':>8} {'scope':>10} {'TP':>6} {'FP':>6} {'prec':>7} {'recall':>7} {'det/img':>8}"
    print(header)
    print("-" * len(header))
    for threshold in [0.7875, 0.70, 0.60, 0.50, 0.45, 0.40, 0.35, 0.30, 0.25]:
        for scope in ("all80", "old16"):
            tp = fp = 0
            positives = 0
            detections = 0
            for preds, truth in per_image:
                allowed = (lambda l: True) if scope == "all80" else (lambda l: l in OLD_WHITELIST)
                gt = [g for g in truth if allowed(g[0])]
                positives += len(gt)
                used = set()
                picked = [p for p in preds if p[1] >= threshold and allowed(p[0])]
                detections += len(picked)
                for label, _score, box in picked:
                    best, best_iou = None, 0.5
                    for i, (glabel, gbox) in enumerate(gt):
                        if i in used or glabel != label:
                            continue
                        value = iou(box, gbox)
                        if value >= best_iou:
                            best, best_iou = i, value
                    if best is None:
                        fp += 1
                    else:
                        used.add(best)
                        tp += 1
            precision = tp / (tp + fp) if tp + fp else float("nan")
            recall = tp / positives if positives else float("nan")
            print(f"{threshold:>8.4f} {scope:>10} {tp:>6} {fp:>6} {precision:>7.3f} {recall:>7.3f} {detections/max(1,len(per_image)):>8.2f}")
        print()


if __name__ == "__main__":
    main()
