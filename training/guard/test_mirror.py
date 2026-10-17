import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('mirror', Path(__file__).with_name('mirror.py'))
mirror = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(mirror)
except FileNotFoundError:
    mirror = None

class MirrorTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(mirror, 'mirror implementation missing')

    def test_remote_index_source_compiles(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        def run(args, **kwargs):
            compile(kwargs['input'], '<remote-index>', 'exec')
            return SimpleNamespace(stdout=b'{}')
        with patch.object(mirror.subprocess, 'run', run):
            self.assertEqual(mirror.remote_index(), {})

    def test_reject_unsafe_paths(self):
        for name in ('../secret', '/etc/passwd', 'coco/images/x.jpg', 'artifacts/../../secret', 'x.env'):
            self.assertFalse(mirror.allowed(name))
        for name in ('artifacts/best.pth', 'train.log', 'coco/manifest.json', 'train.py'):
            self.assertTrue(mirror.allowed(name))

    def test_verified_publish_retains_previous(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            a = root / 'part'; a.write_bytes(b'abc')
            meta = {'size': 3, 'sha256': hashlib.sha256(b'abc').hexdigest()}
            blob = mirror.accept_blob(a, root, meta)
            first = mirror.publish(root, {'artifacts/a.pth': meta})
            self.assertEqual((first / 'artifacts/a.pth').read_bytes(), b'abc')
            mirror.publish(root, {})
            self.assertTrue(first.exists())
            self.assertEqual(blob.read_bytes(), b'abc')
            self.assertEqual(json.loads((first / 'manifest.json').read_text())['files']['artifacts/a.pth']['source_sha256'], meta['sha256'])

    def test_tamper_never_published(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); part = root / 'part'; part.write_bytes(b'bad')
            with self.assertRaises(ValueError):
                mirror.accept_blob(part, root, {'size': 3, 'sha256': hashlib.sha256(b'abc').hexdigest()})
            self.assertFalse((root / 'latest.json').exists())
            self.assertTrue(part.exists())

    def test_changed_weight_rejected_but_identical_accepted(self):
        a = {'size': 3, 'sha256': 'abc'}
        b = {'size': 4, 'sha256': 'def'}
        self.assertFalse(mirror.stable(a, b))
        self.assertTrue(mirror.stable(a, dict(a)))
        self.assertFalse(mirror.stable(a, None))

    def test_remote_index_no_symlink_or_temporary(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); (root / 'artifacts').mkdir()
            (root / 'artifacts/a.pth').write_bytes(b'abc')
            (root / 'artifacts/a.tmp').write_bytes(b'x')
            (root / 'artifacts/link.pth').symlink_to('/etc/passwd')
            records = mirror.local_index(root)
            self.assertEqual(set(records), {'artifacts/a.pth'})
            self.assertEqual(records['artifacts/a.pth']['size'], 3)

if __name__ == '__main__': unittest.main()
