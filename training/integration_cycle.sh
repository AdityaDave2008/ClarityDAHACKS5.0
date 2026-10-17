#!/usr/bin/env bash
# Compatibility acceptance only. These tiny-run weights are never a final candidate.
set -euo pipefail
cd /workspace/broad80
export PYTHONPATH="$PWD/YOLOX"
export PATH="$PWD/.venv/bin:$PATH"
.venv/bin/python - <<'PY'
import json,pathlib
from prepare_coco import subset
root=pathlib.Path('coco/annotations')
for source,name,count in [('train_subset','integration_train',32),('val_tune','integration_val',8)]:
    doc=json.load(open(root/(source+'.json')))
    (root/(name+'.json')).write_text(json.dumps(subset(doc,[i['id'] for i in doc['images'][:count]])))
PY
timeout 180 .venv/bin/python train_entry.py -f broad80_exp.py -d 1 -b 8 --fp16 -c yolox_nano.pth \
  max_epoch 1 no_aug_epochs 0 warmup_epochs 0 data_num_workers 2 \
  train_ann integration_train.json val_ann integration_val.json \
  output_dir /workspace/broad80/artifacts/integration-smoke print_interval 1 > integration-cycle.log 2>&1
test -s artifacts/integration-smoke/broad80_nano/best_ckpt.pth
.venv/bin/python - <<'PY'
import torch
checkpoint=torch.load('artifacts/integration-smoke/broad80_nano/best_ckpt.pth',map_location='cpu',weights_only=False)
assert checkpoint['start_epoch']==1
assert checkpoint['best_ap'] > 0
print('Actual trainer train/evaluate/best-checkpoint integration cycle passed')
PY
