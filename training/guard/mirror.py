#!/usr/bin/env python3
"""Read-only SSH mirroring to immutable local snapshots. No credentials copied."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shlex
import subprocess
import tempfile
import time
import uuid

POD_ID = 'jgmvyjlozpj1pl'
REMOTE = Path('/workspace/broad80')
END = dt.datetime.fromisoformat('2026-10-17T16:13:00+00:00').timestamp()
SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=10',
       '-o', 'ServerAliveCountMax=2', '-p', '22109', '-i', str(Path.home() / '.ssh/id_ed25519'), 'root@63.141.33.148']


def allowed(name):
    p = PurePosixPath(name)
    if p.is_absolute() or '..' in p.parts or not p.parts or any(x.startswith('.') for x in p.parts):
        return False
    if p.suffix in ('.tmp', '.part', '.lock', '.env'):
        return False
    return (p.parts[0] == 'artifacts' and len(p.parts) > 1 or
            len(p.parts) == 1 and p.suffix in ('.log', '.py') or
            name in ('coco/manifest.json', 'coco/image-sha256.jsonl', 'yolox_nano.pth'))


def digest(path, size=None):
    h = hashlib.sha256()
    total = 0
    with Path(path).open('rb') as f:
        while True:
            chunk = f.read(min(1024 * 1024, size - total) if size is not None else 1024 * 1024)
            if not chunk:
                break
            h.update(chunk); total += len(chunk)
    return {'size': total, 'sha256': h.hexdigest()}


def local_index(root):
    records = {}
    # Never walk dataset image trees. Artifacts must not contain credential files.
    paths = list(root.glob('*.log')) + list(root.glob('*.py'))
    paths += [root / 'yolox_nano.pth', root / 'coco/manifest.json', root / 'coco/image-sha256.jsonl']
    if (root / 'artifacts').is_dir() and not (root / 'artifacts').is_symlink():
        paths += list((root / 'artifacts').rglob('*'))
    for path in paths:
        name = path.relative_to(root).as_posix()
        if not allowed(name) or not path.is_file() or any(x.is_symlink() for x in [path, *path.parents] if x != root):
            continue
        before = path.stat()
        meta = digest(path, before.st_size)
        after = path.stat()
        # Logs can append: bounded-prefix hash allows useful log snapshots during training.
        is_log = path.suffix == '.log'
        if meta['size'] != before.st_size or before.st_ino != after.st_ino:
            continue
        if not is_log and (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            continue
        records[name] = {**meta, 'source_mtime_ns': before.st_mtime_ns, 'prefix': is_log}
    return records


def stable(before, after):
    return bool(after) and all(before[k] == after[k] for k in ('size', 'sha256'))


def atomic_json(path, data):
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    with temp.open('w') as f:
        json.dump(data, f, indent=2); f.write('\n'); f.flush(); os.fsync(f.fileno())
    os.replace(temp, path)


def accept_blob(part, root, meta):
    if not stable(meta, digest(part)):
        raise ValueError('TRANSFER_HASH_OR_SIZE_MISMATCH')
    blobs = root / 'blobs'; blobs.mkdir(exist_ok=True)
    dest = blobs / meta['sha256']
    if dest.exists():
        if not stable(meta, digest(dest)):
            raise ValueError('EXISTING_BLOB_CORRUPTION')
        part.unlink()  # Only this watcher's temporary duplicate, never source or published data.
    else:
        os.replace(part, dest)
    return dest


def publish(root, records):
    snapshots = root / 'snapshots'; snapshots.mkdir(exist_ok=True)
    name = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
    temp = snapshots / ('.' + name + '.tmp'); temp.mkdir()
    manifest = {}
    for rel, meta in records.items():
        if not allowed(rel):
            raise ValueError('UNSAFE_PATH')
        dest = temp / rel; dest.parent.mkdir(parents=True, exist_ok=True)
        os.link(root / 'blobs' / meta['sha256'], dest)
        manifest[rel] = {**meta, 'source_size': meta['size'], 'mirrored_size': meta['size'],
                         'source_sha256': meta['sha256'], 'mirrored_sha256': meta['sha256']}
    atomic_json(temp / 'manifest.json', {'pod_id': POD_ID, 'files': manifest, 'timestamp': time.time()})
    final = snapshots / name; os.replace(temp, final)
    atomic_json(root / 'latest.json', {'snapshot': str(final), 'file_count': len(manifest), 'timestamp': time.time()})
    return final


def remote_index():
    # Send only source code to SSH stdin, never install on or write to the pod.
    source = Path(__file__).read_text().split("\nif __name__ == '__main__':")[0]
    command = source + '\nprint(json.dumps(local_index(REMOTE)))\n'
    result = subprocess.run(SSH + ['python3 -'], input=command.encode(), stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, timeout=60, check=True)
    return json.loads(result.stdout)


def fetch(name, size, part):
    if not allowed(name):
        raise ValueError('UNSAFE_PATH')
    # Prefix reads make log snapshots finite even when training continually appends.
    code = ('from pathlib import Path; import sys; p=Path(' + repr(str(REMOTE / name)) + '); '
            'assert not p.is_symlink(); f=p.open("rb"); remaining=' + str(size) + '\n'
            'while remaining:\n b=f.read(min(1048576, remaining))\n if not b: break\n sys.stdout.buffer.write(b)\n remaining-=len(b)\n')
    with part.open('wb') as out:
        subprocess.run(SSH + ['python3 -c ' + shlex.quote(code)], stdout=out, stderr=subprocess.DEVNULL,
                       check=True, timeout=120)
        out.flush(); os.fsync(out.fileno())


def event(root, phase, **metadata):
    record = {'timestamp': time.time(), 'phase': phase, 'pid': os.getpid(), 'pod_id': POD_ID, **metadata}
    with (root / 'events.jsonl').open('a') as f:
        f.write(json.dumps(record) + '\n')
    atomic_json(root / 'health.json', record)
    print(json.dumps(record), flush=True)


def sweep(root):
    before = remote_index()
    downloaded = {}
    start = time.monotonic()
    for name, meta in before.items():
        if time.monotonic() - start >= 300 or time.time() >= END:
            break
        blob = root / 'blobs' / meta['sha256']
        if not blob.exists():
            fd, path = tempfile.mkstemp(prefix='download-', suffix='.part', dir=root)
            os.close(fd); part = Path(path)
            try:
                fetch(name, meta['size'], part)
                accept_blob(part, root, meta)
            except Exception as exc:
                event(root, 'FILE_RETRY_NEXT_SWEEP', path=name, error_type=type(exc).__name__)
                continue
        elif not stable(meta, digest(blob)):
            event(root, 'BLOB_CORRUPTION', path=name)
            continue
        downloaded[name] = meta
    after = remote_index()
    records = {name: meta for name, meta in downloaded.items()
               if meta.get('prefix') or stable(meta, after.get(name))}
    snapshot = publish(root, records)
    # Guard health is metadata-only. Missing/stale is visible but never delays cloud safeguard.
    try:
        result = subprocess.run(SSH + ['python3 /workspace/budget-guard/pod_guard.py status'],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=20, check=True)
        guard = json.loads(result.stdout)
        atomic_json(root / 'guard-health.json', guard)
    except Exception:
        guard = {'phase': 'UNAVAILABLE'}
    event(root, 'MIRROR_OK', snapshot=str(snapshot), files=len(records),
          skipped=len(before) - len(records), guard_phase=guard.get('phase'),
          guard_alive=guard.get('process_alive'), guard_heartbeat_age=guard.get('heartbeat_age_seconds'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dest', type=Path, required=True)
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args(); root = args.dest.expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    import fcntl
    lock = (root / 'watcher.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    previous = time.time()
    while time.time() < END:
        now = time.time()
        if now - previous > 180:
            event(root, 'MAC_UNAVAILABLE_OR_SLOW_SWEEP_GAP', gap_seconds=now - previous)
        previous = now
        event(root, 'MIRROR_SWEEP_START')
        try:
            sweep(root)
        except Exception as exc:
            event(root, 'MIRROR_FAILED_RETRY_IN_60S', error_type=type(exc).__name__)
            if args.once:
                return 2
        if args.once:
            return 0
        time.sleep(min(60, max(0, END - time.time())))
    event(root, 'WATCHER_DEADLINE_REACHED', warning='No further automatic backups. Guard stop must be externally verified.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
