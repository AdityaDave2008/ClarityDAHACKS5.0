#!/usr/bin/env bash
# Run only after the independent pod budget guard is armed.
set -euo pipefail
cd /workspace/broad80
export PYTHONPATH="$PWD/YOLOX"
export OMP_NUM_THREADS=4
export OPENBLAS_NUM_THREADS=4
PY="$PWD/.venv/bin/python"
"$PY" - <<'PY'
import json, os, time
health=json.load(open('/workspace/budget-guard/health.json'))
assert health['phase']=='ARMED', 'Budget watchdog is not armed'
assert 0 <= time.time()-health['timestamp'] < 60, 'Budget watchdog heartbeat stale'
assert health['pod_id']=='jgmvyjlozpj1pl', 'Wrong budget watchdog pod'
assert health['deadline']=='2026-10-17T16:03:00+00:00', 'Unexpected watchdog deadline'
os.kill(int(health['pid']),0)
PY
test -f coco/leakage-audit.json
test -f coco/image-sha256.jsonl
test -f artifacts/preflight/preflight.json
# Absolute cutoff plus GNU timeout are independent of the external budget watchdog.
NOW=$(date -u +%s)
CUTOFF=$(date -u -d '2026-10-17 14:03:00' +%s)
SECONDS_LEFT=$(( CUTOFF - NOW ))
if (( SECONDS_LEFT <= 600 )); then echo 'Insufficient budget time'; exit 1; fi
if (( SECONDS_LEFT > 27000 )); then SECONDS_LEFT=27000; fi
printf '%s\n' "$(date -u +%FT%TZ) training start, max ${SECONDS_LEFT}s" | tee run-status.log
timeout --signal=TERM --kill-after=30 "$SECONDS_LEFT" "$PY" train_entry.py \
  -f broad80_exp.py -d 1 -b 64 --fp16 -c yolox_nano.pth 2>&1 | tee train.log
# YOLOX logger catches some exceptions. Require a real final checkpoint as well.
test -s artifacts/broad80_nano/latest_ckpt.pth
"$PY" - <<'PY'
import torch
p='artifacts/broad80_nano/latest_ckpt.pth'
c=torch.load(p,map_location='cpu',weights_only=False)
assert c['start_epoch'] >= 15, f"Incomplete run, epoch {c['start_epoch']}"
print('Verified actual completed epochs:',c['start_epoch'])
PY
printf '%s\n' "$(date -u +%FT%TZ) training complete" | tee -a run-status.log
