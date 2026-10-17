#!/usr/bin/env bash
# Wait for the already-running training PID, evaluate both candidates on tuning only,
# then freeze one model/threshold and evaluate final-test once. Never deploy the app.
set -euo pipefail
cd /workspace/broad80
export PYTHONPATH="$PWD/YOLOX"
export OMP_NUM_THREADS=4
PY="$PWD/.venv/bin/python"
timeout 27900 "$PY" - <<'PY'
import pathlib,time
pid=int(pathlib.Path('training.pid').read_text())
while True:
    try:
        state=pathlib.Path(f'/proc/{pid}/stat').read_text().rsplit(')',1)[1].split()[0]
    except FileNotFoundError:
        break
    if state=='Z': break
    time.sleep(10)
PY
"$PY" - <<'PY'
import torch,json,pathlib
c=torch.load('artifacts/broad80_nano/latest_ckpt.pth',map_location='cpu',weights_only=False)
assert c['start_epoch'] >= 1, 'No real-data completed epoch available'
pathlib.Path('artifacts/training-completion.json').write_text(json.dumps({'completed_epochs':c['start_epoch'],
    'planned_epochs':15,'complete':c['start_epoch']>=15,'partial_recovery':c['start_epoch']<15},indent=2))
PY
for WHICH in baseline candidate; do
  if [[ "$WHICH" == baseline ]]; then CHECKPOINT=yolox_nano.pth; else CHECKPOINT=artifacts/broad80_nano/best_ckpt.pth; fi
  if [[ ! -s "$CHECKPOINT" ]]; then CHECKPOINT=artifacts/broad80_nano/latest_ckpt.pth; fi
  if [[ "$WHICH" == baseline && -s artifacts/baseline-tune/metrics.json ]]; then continue; fi
  timeout 900 "$PY" evaluate.py --root coco --checkpoint "$CHECKPOINT" --output "artifacts/${WHICH}-tune" > "${WHICH}-eval.log" 2>&1
done
"$PY" - <<'PY'
import json,shutil,pathlib
base=json.load(open('artifacts/baseline-tune/metrics.json'))
candidate=json.load(open('artifacts/candidate-tune/metrics.json'))
chosen=candidate if candidate['mAP50_95'] > base['mAP50_95'] else base
out=pathlib.Path('artifacts/selected');out.mkdir(exist_ok=True)
shutil.copyfile(chosen['checkpoint'],out/'model.pth')
selection={'selected_source':chosen['checkpoint'],'reason':'Higher tuning mAP50:95. Baseline wins ties.',
           'baseline_mAP50_95':base['mAP50_95'],'candidate_mAP50_95':candidate['mAP50_95'],
           'frozen_threshold':chosen['operating_point_IoU50']['threshold'],
           'target_precision_met_on_tuning':chosen['operating_point_IoU50']['target_met']}
(out/'selection.json').write_text(json.dumps(selection,indent=2))
print(json.dumps(selection))
PY
THRESHOLD=$("$PY" -c "import json; print(json.load(open('artifacts/selected/selection.json'))['frozen_threshold'])")
timeout 900 "$PY" evaluate.py --root coco --checkpoint artifacts/selected/model.pth --split test_final \
  --frozen-threshold "$THRESHOLD" --output artifacts/final-test > final-test.log 2>&1
timeout 180 "$PY" smoke_export.py --checkpoint artifacts/selected/model.pth --output artifacts/selected > selected-export.log 2>&1
mv artifacts/selected/pretrained-static.onnx artifacts/selected/model-static.onnx
printf '%s\n' "$(date -u +%FT%TZ) evaluation/export complete, awaiting verified off-pod mirror and stop" | tee -a run-status.log
