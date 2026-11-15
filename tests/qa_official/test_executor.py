import json
import os
import re
from pathlib import Path
import sys
import tempfile
import hashlib
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/qa_official'))
from common import digest, validate_source, REPO
import verify_apk


class ConfigurationTests(unittest.TestCase):
    def test_digest_format(self):
        self.assertEqual(digest(':'.join(['AB'] * 32)), 'ab' * 32)
        for value in ('abc', 'g' * 64, 'a' * 63):
            with self.assertRaises(RuntimeError):
                digest(value)

    def test_only_successful_signed_build_from_own_repo(self):
        run = {'repository': {'full_name': REPO}, 'path': '.github/workflows/build-apk.yml',
               'status': 'completed', 'conclusion': 'success', 'id': 100}
        artifact = {'name': 'atrio-catolico-release-assinado', 'expired': False, 'workflow_run': {'id': 100}}
        validate_source(run, artifact)
        for key, value in [('repository', {'full_name': 'someone/fork'}), ('path', 'other.yml'),
                           ('conclusion', 'failure'), ('status', 'in_progress')]:
            with self.assertRaises(RuntimeError):
                validate_source({**run, key: value}, artifact)
        for key, value in [('name', 'debug'), ('expired', True), ('workflow_run', {'id': 99})]:
            with self.assertRaises(RuntimeError):
                validate_source(run, {**artifact, key: value})


class WorkflowTests(unittest.TestCase):
    def test_manual_workflow_only_verifies_apk_integrity(self):
        root = Path(__file__).resolve().parents[2]
        workflow = (root / '.github/workflows/qa-official-apk.yml').read_text()
        self.assertIn('\non:\n  workflow_dispatch:\n', workflow)
        self.assertIn('          path: qa-official-results/apk.json', workflow)
        inputs = workflow.split('    inputs:\n', 1)[1].split('\npermissions:', 1)[0]
        self.assertEqual(re.findall(r'^ {6}([a-z_0-9]+):$', inputs, re.MULTILINE),
                         ['apk_run_id', 'apk_sha256'])
        for removed in ('mode:', 'session_id:', 'ATRIO_QA_BOTS_JSON', 'scripts/qa_official/run.py',
                        'run-device.sh', 'android-emulator-runner', 'pull_request:', 'schedule:', 'push:'):
            with self.subTest(removed=removed):
                self.assertNotIn(removed, workflow)
        for name in ('run.py', 'run-device.sh', 'link_logins.py'):
            self.assertFalse((root / 'scripts/qa_official' / name).exists())

    def test_verifier_rejects_automatic_fork_and_rerun_before_network(self):
        valid = {'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_REPOSITORY': REPO,
                 'GITHUB_RUN_ATTEMPT': '1'}
        for key, value in [('GITHUB_EVENT_NAME', 'pull_request'),
                           ('GITHUB_REPOSITORY', 'a/fork'), ('GITHUB_RUN_ATTEMPT', '2')]:
            with self.subTest(key=key), patch.dict(os.environ, {**valid, key: value}, clear=True), \
                 patch('verify_apk.request') as request:
                with self.assertRaises(RuntimeError):
                    verify_apk.verify()
                request.assert_not_called()


class ApkTests(unittest.TestCase):
    def verify(self, override=None):
        override = override or {}
        run = {'repository': {'full_name': REPO}, 'path': '.github/workflows/build-apk.yml',
               'status': 'completed', 'conclusion': 'success', 'id': 100, 'head_sha': 'f' * 40}
        artifact = {'name': 'atrio-catolico-release-assinado', 'expired': False, 'workflow_run': {'id': 100}}
        env = {'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_REPOSITORY': REPO,
               'GITHUB_RUN_ATTEMPT': '1', 'APK_RUN_ID': '100',
               'GH_TOKEN': 'fixture', 'APK_SHA256': hashlib.sha256(b'fixture').hexdigest(),
               'ATRIO_RELEASE_CERT_SHA256': 'a' * 64, 'ANDROID_HOME': '/sdk'}
        def command(*args):
            if 'verify' in args:
                return 'Signer #1 certificate SHA-256 digest: ' + override.get('cert', 'a' * 64)
            if 'application-id' in args:
                return override.get('package', 'br.com.atriocatolico')
            if 'debuggable' in args:
                return override.get('debug', 'false')
            if 'version-name' in args:
                return '0.19.0'
            if 'project_id' in args:
                return override.get('project', 'atrio-catolico')
            return 'fixture-api-key'
        previous = os.getcwd()
        try:
            with tempfile.TemporaryDirectory() as temp:
                os.chdir(temp)
                Path('official-apk').mkdir()
                Path('official-apk/app-release.apk').write_bytes(override.get('bytes', b'fixture'))
                with patch.dict(os.environ, env, clear=True), \
                     patch('verify_apk.request', side_effect=[run, {'artifacts': [artifact]}]) as request, \
                     patch('verify_apk.command', side_effect=command):
                    verify_apk.verify()
                    url = f'https://api.github.com/repos/{REPO}/actions/runs/100'
                    self.assertEqual([call.args[0] for call in request.call_args_list], [url, url + '/artifacts'])
                    evidence = json.loads(Path('qa-official-results/apk.json').read_text())
                    self.assertEqual(set(evidence), {'build_run_id', 'source_sha', 'apk_sha256',
                                                     'certificate_sha256', 'package', 'project', 'version'})
        finally:
            os.chdir(previous)

    def test_signed_release_verified_without_installing(self):
        self.verify()

    def test_reject_wrong_binary_certificate_package_debug_and_project(self):
        for change in ({'bytes': b'changed'}, {'cert': 'b' * 64}, {'package': 'other.app'},
                       {'debug': 'true'}, {'project': 'demo-atrio-v11'}):
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                self.verify(change)


if __name__ == '__main__':
    unittest.main()
