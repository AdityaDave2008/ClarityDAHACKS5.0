#!/usr/bin/env python3
"""Fixed-pod, fixed-deadline safeguard. Preflight never mutates cloud state."""
import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import signal
import time
import urllib.parse
import urllib.request

POD_ID = 'jgmvyjlozpj1pl'
DEADLINE_ISO = '2026-10-17T16:03:00+00:00'
TRAIN_CUTOFF_ISO = '2026-10-17T14:03:00+00:00'
DEADLINE = dt.datetime.fromisoformat(DEADLINE_ISO).timestamp()
ARM_TOKEN = 'STOP-' + POD_ID + '-2026-10-17T16:03:00Z'
QUERY = 'query { pod(input: {podId: "' + POD_ID + '"}) { id desiredStatus } }'
MUTATION = 'mutation { podStop(input: {podId: "' + POD_ID + '"}) { id desiredStatus } }'
STATE_DIR = Path('/workspace/budget-guard')


def credentials(raw=None):
    if raw is None:
        raw = Path('/proc/1/environ').read_bytes()
    env = dict(part.split(b'=', 1) for part in raw.split(b'\0') if b'=' in part)
    # Providers have used both names. Reject any conflicting supplied identity.
    ids = [env[k].decode() for k in (b'RUNPOD_POD_ID', b'POD_ID') if k in env]
    if not ids or any(value != POD_ID for value in ids):
        raise ValueError('POD_IDENTITY_MISMATCH')
    key = env.get(b'RUNPOD_API_KEY', b'').decode()
    if not key:
        raise ValueError('MISSING_CREDENTIAL')
    return key


def validate_pod(pod):
    if not isinstance(pod, dict) or pod.get('id') != POD_ID:
        raise ValueError('POD_IDENTITY_MISMATCH')
    if pod.get('desiredStatus') not in ('RUNNING', 'EXITED'):
        raise ValueError('UNEXPECTED_POD_STATUS')
    return pod


def _timeout(_sig, _frame):
    raise TimeoutError('API_TIMEOUT')


def api(key, query, opener=urllib.request.urlopen):
    # SIGALRM bounds DNS, TLS, body reading and slow-drip responses as well as sockets.
    old = signal.signal(signal.SIGALRM, _timeout)
    signal.setitimer(signal.ITIMER_REAL, 10)
    try:
        url = 'https://api.runpod.io/graphql?api_key=' + urllib.parse.quote(key, safe='')
        req = urllib.request.Request(url, json.dumps({'query': query}).encode(), {'Content-Type': 'application/json'})
        with opener(req, timeout=10) as response:
            payload = json.loads(response.read(65537))
        field = 'podStop' if query == MUTATION else 'pod'
        if payload.get('errors'):
            raise ValueError('API_REJECTED')
        return validate_pod(payload['data'][field])
    except Exception:
        # Never expose exception text: HTTP exceptions may contain the credential URL.
        raise RuntimeError('API_REQUEST_FAILED') from None
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, old)


class State:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)

    def event(self, phase, **metadata):
        record = {'timestamp': time.time(), 'pid': os.getpid(), 'pod_id': POD_ID,
                  'deadline': DEADLINE_ISO, 'train_cutoff': TRAIN_CUTOFF_ISO,
                  'phase': phase, 'actual_stop_observed': False, **metadata}
        try:
            with (self.directory / 'events.jsonl').open('a') as f:
                f.write(json.dumps(record) + '\n')
                f.flush()
                os.fsync(f.fileno())
            temp = self.directory / ('health.' + str(os.getpid()) + '.tmp')
            temp.write_text(json.dumps(record) + '\n')
            os.replace(temp, self.directory / 'health.json')
        except OSError:
            # Disk-full/backup failures must never prevent the cloud stop request.
            print(json.dumps({'phase': phase, 'health_write_failed': True}), flush=True)


def due(wall, monotonic_now, monotonic_deadline):
    return wall >= DEADLINE or monotonic_now >= monotonic_deadline


def stop_with_retries(stop, state, monotonic=time.monotonic, sleep=time.sleep):
    end = monotonic() + 300
    attempts = 0
    while monotonic() < end and attempts < 16:
        attempts += 1
        state.event('STOP_ATTEMPT', attempt=attempts)
        try:
            pod = validate_pod(stop())
            if pod['desiredStatus'] == 'EXITED':
                state.event('STOP_REQUEST_ACCEPTED', attempt=attempts, desired_status='EXITED')
                return True
        except Exception:
            pass
        state.event('STOP_RETRY_PENDING', attempt=attempts)
        sleep(min(20, max(0, end - monotonic())))
    state.event('STOP_FAILED_MANUAL_ACTION_REQUIRED', attempts=attempts,
                warning='GPU billing may continue. External operator intervention required.')
    return False


def run(key, state):
    # Nonblocking exclusive lifetime lock prevents duplicate watchers.
    with (state.directory / 'watchdog.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        remaining = max(0, DEADLINE - time.time())
        mono_deadline = time.monotonic() + remaining
        state.event('ARMED', credential_read_valid=True)
        while not due(time.time(), time.monotonic(), mono_deadline):
            state.event('ARMED', credential_read_valid=True,
                        seconds_remaining=max(0, min(DEADLINE - time.time(), mono_deadline - time.monotonic())))
            time.sleep(max(0, min(15, DEADLINE - time.time(), mono_deadline - time.monotonic())))
        # No checkpoint/backup/network-read prerequisite here. Only own fixed pod mutation.
        return 0 if stop_with_retries(lambda: api(key, MUTATION), state) else 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['preflight', 'arm', 'status'])
    parser.add_argument('--confirm', default='')
    args = parser.parse_args()
    if args.command == 'status':
        data = json.loads((STATE_DIR / 'health.json').read_text())
        data['heartbeat_age_seconds'] = time.time() - data['timestamp']
        try:
            os.kill(data['pid'], 0)
            data['process_alive'] = True
        except OSError:
            data['process_alive'] = False
        print(json.dumps(data))
        return 0
    if args.command == 'arm' and (args.confirm != ARM_TOKEN or time.time() >= DEADLINE):
        print(json.dumps({'phase': 'ARM_REFUSED', 'reason': 'Exact confirmation and future deadline required'}))
        return 2
    key = credentials()
    pod = api(key, QUERY)
    if args.command == 'preflight':
        print(json.dumps({'pod_id': POD_ID, 'desired_status': pod['desiredStatus'],
                          'credential_read_valid': True, 'stop_permission_tested': False,
                          'deadline': DEADLINE_ISO, 'armed': False}))
        return 0
    if pod['desiredStatus'] != 'RUNNING':
        raise ValueError('POD_NOT_RUNNING')
    return run(key, State(STATE_DIR))


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({'phase': 'GUARD_ERROR', 'error_type': type(exc).__name__,
                          'warning': 'Guard not confirmed active. Inspect metadata and intervene.'}))
        raise SystemExit(2) from None
