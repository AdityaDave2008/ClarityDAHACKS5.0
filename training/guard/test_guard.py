import importlib.util
import json
import pathlib
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('pod_guard', pathlib.Path(__file__).with_name('pod_guard.py'))
guard = importlib.util.module_from_spec(SPEC) if SPEC else None
if SPEC and SPEC.loader:
    try:
        SPEC.loader.exec_module(guard)
    except FileNotFoundError:
        guard = None


class GuardTests(unittest.TestCase):
    def require(self):
        self.assertIsNotNone(guard, 'guard implementation missing')

    def test_unconfirmed_arm_refused_before_credentials(self):
        self.require()
        from unittest.mock import patch
        with patch('sys.argv', ['pod_guard.py', 'arm']), patch.object(guard, 'credentials') as cred:
            self.assertEqual(guard.main(), 2)
            cred.assert_not_called()

    def test_log_write_failure_does_not_prevent_stop(self):
        self.require()
        with tempfile.TemporaryDirectory() as d:
            state = guard.State(pathlib.Path(d))
            (pathlib.Path(d) / 'events.jsonl').mkdir()
            self.assertTrue(guard.stop_with_retries(lambda: {'id': guard.POD_ID, 'desiredStatus': 'EXITED'}, state))

    def test_fake_clock_watchdog_stops_at_monotonic_deadline(self):
        self.require()
        from unittest.mock import patch
        clock = [0.0]
        def sleep(seconds): clock[0] += seconds
        with tempfile.TemporaryDirectory() as d:
            with patch.object(guard.time, 'time', lambda: guard.DEADLINE - 30 - clock[0]), patch.object(guard.time, 'monotonic', lambda: clock[0]), patch.object(guard.time, 'sleep', sleep), patch.object(guard, 'api', return_value={'id': guard.POD_ID, 'desiredStatus': 'EXITED'}) as api:
                self.assertEqual(guard.run('fake-only', guard.State(pathlib.Path(d))), 0)
                self.assertEqual(clock[0], 30)
                api.assert_called_once_with('fake-only', guard.MUTATION)

    def test_api_hard_timeout_interrupts_stalled_opener(self):
        self.require()
        import time
        def stalled(req, timeout):
            time.sleep(30)
        start = time.monotonic()
        with self.assertRaisesRegex(RuntimeError, '^API_REQUEST_FAILED$'):
            guard.api('fake-only', guard.QUERY, opener=stalled)
        self.assertLess(time.monotonic() - start, 12)

    def test_wrong_identity_rejected(self):
        self.require()
        with self.assertRaises(ValueError):
            guard.credentials(b'RUNPOD_API_KEY=secret\0RUNPOD_POD_ID=wrong\0')
        with self.assertRaises(ValueError):
            guard.validate_pod({'id': 'wrong', 'desiredStatus': 'EXITED'})
        self.assertEqual(guard.credentials(('RUNPOD_API_KEY=secret\0RUNPOD_POD_ID=' + guard.POD_ID + '\0').encode()), 'secret')

    def test_fixed_deadline_and_primary_cutoff(self):
        self.require()
        self.assertEqual(guard.DEADLINE_ISO, '2026-10-17T16:03:00+00:00')
        self.assertEqual(guard.TRAIN_CUTOFF_ISO, '2026-10-17T14:03:00+00:00')
        self.assertFalse(guard.due(guard.DEADLINE - 1, 1, 100))
        self.assertTrue(guard.due(guard.DEADLINE, 1, 100))
        self.assertTrue(guard.due(guard.DEADLINE - 1000, 100, 100))

    def test_retry_bounded_and_append_only(self):
        self.require()
        now = [0.0]
        def sleep(n): now[0] += n
        def failing():
            now[0] += 10
            raise TimeoutError('secret URL MUST NOT leak')
        with tempfile.TemporaryDirectory() as d:
            state = guard.State(pathlib.Path(d))
            state.event('prior')
            self.assertFalse(guard.stop_with_retries(failing, state, monotonic=lambda: now[0], sleep=sleep))
            logs = (pathlib.Path(d) / 'events.jsonl').read_text()
            self.assertIn('prior', logs)
            self.assertNotIn('secret', logs)
            self.assertLessEqual(now[0], 310)
            self.assertEqual(json.loads((pathlib.Path(d) / 'health.json').read_text())['phase'], 'STOP_FAILED_MANUAL_ACTION_REQUIRED')

    def test_stop_ack_not_claimed_actual_observation(self):
        self.require()
        with tempfile.TemporaryDirectory() as d:
            state = guard.State(pathlib.Path(d))
            self.assertTrue(guard.stop_with_retries(lambda: {'id': guard.POD_ID, 'desiredStatus': 'EXITED'}, state))
            health = json.loads((pathlib.Path(d) / 'health.json').read_text())
            self.assertEqual(health['phase'], 'STOP_REQUEST_ACCEPTED')
            self.assertFalse(health['actual_stop_observed'])

    def test_running_response_retries(self):
        self.require()
        now = [0.0]
        with tempfile.TemporaryDirectory() as d:
            def sleep(n): now[0] += n
            self.assertFalse(guard.stop_with_retries(lambda: {'id': guard.POD_ID, 'desiredStatus': 'RUNNING'}, guard.State(pathlib.Path(d)), monotonic=lambda: now[0], sleep=sleep))
            self.assertLessEqual(now[0], 300)

    def test_api_uses_timeout_and_redacts_errors(self):
        self.require()
        calls = []
        def opener(req, timeout):
            calls.append((req, timeout))
            raise OSError('secret-key-with-url')
        with self.assertRaisesRegex(RuntimeError, '^API_REQUEST_FAILED$'):
            guard.api('hidden-secret', 'query', opener=opener)
        self.assertEqual(calls[0][1], 10)

    def test_stop_refuses_wrong_response_identity(self):
        self.require()
        with tempfile.TemporaryDirectory() as d:
            clock = [0]
            def sleep(n): clock[0] += n
            self.assertFalse(guard.stop_with_retries(lambda: {'id': 'wrong', 'desiredStatus': 'EXITED'}, guard.State(pathlib.Path(d)), monotonic=lambda: clock[0], sleep=sleep))

if __name__ == '__main__':
    unittest.main()
