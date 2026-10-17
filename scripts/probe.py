"""Run the shipped v2 candidate on real images and report what it would surface.

Mirrors the app's exact preprocessing contract (BGR, [0,255], 416x416 top-left
pad 114) and the app's decode (objectness * class prob, class-aware NMS 0.65).
"""
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

COCO = ["person","bicycle","car","motorcycle","airplane","bus","train","truck","boat","traffic light","fire hydrant","stop sign","parking meter","bench","bird","cat","dog","horse","sheep","cow","elephant","bear","zebra","giraffe","backpack","umbrella","handbag","tie","suitcase","frisbee","skis","snowboard","sports ball","kite","baseball bat","baseball glove","skateboard","surfboard","tennis racket","bottle","wine glass","cup","fork","knife","spoon","bowl","banana","apple","sandwich","orange","broccoli","carrot","hot dog","pizza","donut","cake","chair","couch","potted plant","bed","dining table","toilet","tv","laptop","mouse","remote","keyboard","cell phone","microwave","oven","toaster","sink","refrigerator","book","clock","vase","scissors","teddy bear","hair drier","toothbrush"]

APP_WHITELIST = {"person","bicycle","car","motorcycle","bus","truck","bench","cat","dog","backpack","handbag","suitcase","bottle","cup","chair","potted plant"}
APP_THRESHOLD = 0.7874982953071594


def preprocess(path):
    image = Image.open(path).convert("RGB")
    rgb = np.asarray(image, dtype=np.uint8)
    h, w = rgb.shape[:2]
    ratio = min(416 / w, 416 / h)
    rw, rh = int(w * ratio), int(h * ratio)
    resized = np.asarray(image.resize((rw, rh), Image.BILINEAR), dtype=np.uint8)
    padded = np.full((416, 416, 3), 114, dtype=np.uint8)
    padded[:rh, :rw] = resized[:, :, ::-1]  # BGR
    return padded.transpose(2, 0, 1)[None].astype(np.float32), ratio, w, h


def iou(a, b):
    x = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    y = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = x * y
    return inter / (a[2] * a[3] + b[2] * b[3] - inter)


def decode(values, ratio, threshold):
    rows = values.reshape(-1, 85)
    cls = rows[:, 5:].argmax(axis=1)
    scores = rows[:, 4] * rows[:, 5:].max(axis=1)
    keep = scores >= threshold
    items = []
    for row, c, s in zip(rows[keep], cls[keep], scores[keep]):
        cx, cy, bw, bh = row[:4] / ratio
        items.append({"label": COCO[int(c)], "score": float(s), "bbox": [float(cx - bw / 2), float(cy - bh / 2), float(bw), float(bh)]})
    items.sort(key=lambda i: -i["score"])
    kept = []
    for item in items:
        if any(k["label"] == item["label"] and iou(k["bbox"], item["bbox"]) > 0.65 for k in kept):
            continue
        kept.append(item)
    return kept


def main():
    model = sys.argv[1]
    session = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
    thresholds = [APP_THRESHOLD, 0.6, 0.45, 0.35, 0.25]
    report = {}
    for path in sys.argv[2:]:
        tensor, ratio, w, h = preprocess(path)
        raw = session.run(None, {"images": tensor})[0][0]
        entry = {}
        for t in thresholds:
            decoded = decode(raw, ratio, t)
            entry[f"{t:.4f}"] = {
                "all": [f"{d['label']}:{d['score']:.2f}" for d in decoded],
                "app_visible": [f"{d['label']}:{d['score']:.2f}" for d in decoded if d["label"] in APP_WHITELIST],
            }
        report[Path(path).name] = entry
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
