# Fixed-pod overnight guard and local backups

Scope: **only `jgmvyjlozpj1pl`**, SSH `root@63.141.33.148:22109` using the existing `~/.ssh/id_ed25519`.
No resource creation, termination/delete, or other pods. Stdlib Python 3.9+ on Linux/macOS.

## Deadlines and cost assumptions

- Approximate pod launch: **2026-10-17 06:03:00 UTC**.
- Training worker must independently enforce primary cutoff **2026-10-17 14:03:00 UTC** (8 hours from launch). The guard records this cutoff but does not kill training processes.
- Guard first requests STOP at **2026-10-17 16:03:00 UTC** (10 hours from launch). Scheduling granularity is up to 15 seconds, API wall timeout 10 seconds.
- Rate verified by coordinator: GPU $0.270/hour + container disk $0.014/hour = $0.284/hour. Ten hours is approximately **$2.84**, excluding anything not represented in that rate. Total authorized spend remains **$20 including storage**, not permission to extend this deadline.
- STOP retry window is 300 seconds, maximum 16 attempts, each request hard-bounded by SIGALRM to 10 seconds. An in-flight request can end up to 10 seconds after that window. Failure records `STOP_FAILED_MANUAL_ACTION_REQUIRED` and exits nonzero. **This does not guarantee a spend cap if the provider API or credentials fail. External operator action is required.**
- Local mirror exits at **2026-10-17 16:13:00 UTC**, allowing final attempts after the stop deadline.

**This pod has 100GB container disk and NO persistent volume. STOP loses its files.** Backups never gate the deadline: the guard requests STOP even if the Mac is asleep, offline, disk-full, or backups failed. Anything not already mirrored can be lost.

## Official API evidence and credentials

Official RunPod documentation, retrieved 2026-10-17:
https://docs.runpod.io/sdks/graphql/manage-pods

```graphql
query { pod(input: {podId: "jgmvyjlozpj1pl"}) { id desiredStatus } }
mutation { podStop(input: {podId: "jgmvyjlozpj1pl"}) { id desiredStatus } }
```

The provider documents `desiredStatus: EXITED` as the mutation result. This is an accepted desired-state request, **not proof that GPU billing stopped**. Observe provider status independently afterward.

The guard reads `RUNPOD_API_KEY` plus `RUNPOD_POD_ID` or `POD_ID` from `/proc/1/environ`. Missing/conflicting identities reject operation. The key is kept only in process memory, sent to the official HTTPS GraphQL URL, never passed in command arguments, printed, saved, or committed. Error details/URLs/responses are not logged. Live read-only preflight succeeded. **STOP mutation permission remains untested because testing it would stop this running pod.**

## Current operational state

Root reviewed code and authorized arming. Guard installed at `/workspace/budget-guard/pod_guard.py`, armed 2026-10-17 06:09:11 UTC with PID **2301**. First observed heartbeat age 2.83 seconds and process alive. This is historical verification, not a promise of continued liveness.

```sh
ssh -o BatchMode=yes -o ConnectTimeout=10 -p 22109 -i ~/.ssh/id_ed25519 \
  root@63.141.33.148 'python3 /workspace/budget-guard/pod_guard.py status'
```

Expect `phase: ARMED`, `process_alive: true`, and heartbeat younger than 45 seconds. `credential_read_valid` records the successful startup read, not a repeated credential validation. Use `preflight` again for a fresh read-only credential check. Health and append-only event log are `/workspace/budget-guard/health.json` and `events.jsonl`. Console output appends to `console.log`.

Arming requires the exact token below. **Do not repeat on an already armed pod.** Exclusive lifetime flock prevents a second watcher. No cron, restart unit, or startup supervisor is installed. A container reboot or killed watchdog therefore requires external intervention. Dual wall/monotonic deadlines resist backwards wall-clock changes while the watchdog lives.

```sh
# Only after explicit root review/approval, with future fixed deadline:
nohup python3 /workspace/budget-guard/pod_guard.py arm \
  --confirm STOP-jgmvyjlozpj1pl-2026-10-17T16:03:00Z \
  >> /workspace/budget-guard/console.log 2>&1 </dev/null &
```

## Local mirror

```sh
python3 training/guard/mirror.py \
  --dest "$HOME/.jcode/scratch/runpod-jgmvyjlozpj1pl" --once
# Omit --once for continual watcher. Exclusive destination lock prevents duplicates.
```

### Detached launcher and current watcher

The tool-managed background task `4570687jod` was forcibly timed out after 600 seconds despite a longer requested timeout. It is **not active**. At 2026-10-17 06:21:02 UTC the watcher was restarted detached as PID **86697**, still bounded by the script's fixed 16:13 UTC end. A new successful sweep at 06:21:26 UTC captured 43 files, with all hashes independently verified. These PIDs and observations are historical: check current health before relying on them.

Use a detached OS process instead of a tool-managed long-lived task:

```sh
python3 - <<'PY_LAUNCH'
import pathlib, subprocess, sys
root = pathlib.Path.home() / '.jcode/scratch/runpod-jgmvyjlozpj1pl'
root.mkdir(parents=True, exist_ok=True)
with (root / 'detached-console.log').open('ab', buffering=0) as log:
    process = subprocess.Popen(
        [sys.executable, str(pathlib.Path('training/guard/mirror.py').resolve()), '--dest', str(root)],
        stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
print(process.pid)
PY_LAUNCH
```

Do not launch a duplicate while the current watcher is healthy. The destination lock rejects duplicates. Read `health.json` for its actual PID and timestamp, `latest.json` for snapshot freshness, and the append-only `detached-console.log` for errors. Root separately restarted bounded detached caffeinate as PID **87149** through 16:13 UTC. Caffeinate does not prevent lid-close sleep.

Source allowlist agreed with the training worker:
- `/workspace/broad80/artifacts/**` (checkpoints, ONNX, preflight results)
- `/workspace/broad80/*.log` and `*.py`
- `/workspace/broad80/coco/manifest.json` and `image-sha256.jsonl`
- `/workspace/broad80/yolox_nano.pth` (official initial checkpoint)

No dataset image tree is copied. Symlinks, traversal, hidden names, `.tmp`, `.part`, `.lock`, `.env` are excluded. Training must atomically rename completed checkpoints or keep them unchanged long enough for before/after full-hash verification. Active logs use a finite prefix whose remote hash and local hash match. Changed weights are withheld until the next sweep.

Every sweep obtains remote size/SHA256, downloads into local temporary files, verifies local size/SHA256, confirms checkpoint hashes again remotely, then atomically publishes an immutable snapshot directory and `latest.json`. Each snapshot manifest records source and mirrored sizes/hashes. Content-addressed blobs are hardlinked into snapshots to avoid storing unchanged checkpoints repeatedly. Do not edit files inside snapshots: hardlinks share storage. No remote file or prior snapshot is deleted. Failed temporary downloads can remain for inspection.

Local paths under destination:
- `latest.json`: latest published snapshot directory and timestamp
- `snapshots/<UTC>-<unique>/manifest.json`: per-file integrity metadata
- `health.json` and append-only `events.jsonl`: watcher state
- `guard-health.json`: latest remote guard status copied without secrets
- `blobs/<sha256>`: verified content objects

A snapshot can be partial when a file changed during transfer. Older complete snapshots are retained. Cadence is **60 seconds after each sweep**, not a strict 60-second RPO. Per-SSH operations are bounded to 60s indexing, 120s file transfer, and 20s guard read, with a 300s transfer-loop budget. Network/large-file delays lengthen sweeps. Check `latest.json` freshness, `skipped`, and errors. A failure never clears earlier logs or snapshots.

The Mac must remain awake, powered, connected and with free storage. Root owns bounded `caffeinate` and follow-up scheduling. The watcher detects a >180s wall-time gap **after resuming**, but cannot monitor or back up while the Mac is powered off/asleep. No claim of uninterrupted coverage is possible.

## Validation

```sh
python3 -m unittest discover -s training/guard -p 'test_*.py'
```

Tests cover wrong pod rejection, exact deadlines, backwards-clock fallback decision, redacted bounded API errors, bounded retry exhaustion, append-only event history, mutation acknowledgement vs actual stop, safe source paths, corrupt transfer rejection, retained snapshots, source/mirror hashes, temporary/symlink exclusions, and remote payload compilation. Live read-only API and real SSH backup checks supplement mocks. No test issues a live STOP mutation.
