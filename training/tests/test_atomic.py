import importlib.util
import pathlib
import tempfile
import unittest
PATH=pathlib.Path(__file__).parents[1]/'atomic_checkpoint.py'
class AtomicTests(unittest.TestCase):
    def test_public_file_changes_only_after_complete_write(self):
        self.assertTrue(PATH.exists(),'atomic publisher missing')
        spec=importlib.util.spec_from_file_location('atomic',PATH)
        mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
        with tempfile.TemporaryDirectory() as directory:
            target=pathlib.Path(directory)/'model.pth';target.write_bytes(b'old')
            def failed(path):
                pathlib.Path(path).write_bytes(b'partial')
                raise RuntimeError('write failed')
            with self.assertRaises(RuntimeError):mod.atomic_publish(target,failed)
            self.assertEqual(target.read_bytes(),b'old')
            mod.atomic_publish(target,lambda p:pathlib.Path(p).write_bytes(b'new'))
            self.assertEqual(target.read_bytes(),b'new')
            self.assertFalse(pathlib.Path(str(target)+'.part').exists())
